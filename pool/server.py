#!/usr/bin/env python3
"""
Multi-Pool Allocator API for 3 simulator types, each with auto-scaling (min 2, max 5).
"""

import base64
import json
import logging
import os
import re
import socket
import subprocess
import random
import threading
import time
import urllib.parse
from collections import defaultdict
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from datetime import datetime, timedelta

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
    level=logging.INFO,
)
logger = logging.getLogger("allocator")

_heartbeat_counts: dict = defaultdict(int)

def log_event(event, **kw):
    parts = [f"event={event}"]
    for k, v in kw.items():
        if v: parts.append(f"{k}={v}")
    logger.info(" ".join(parts))

POOLS = {
    "diy": {
        "label": "Specter DIY", "min": 3, "max": 10,
        "instances": [
            {"id": f"diy{n}", "num": str(n), "ws_port": 6079+n} for n in range(1, 6)
        ],
    },
    "play": {
        "label": "Specter Playground", "min": 2,
        "instances": [
            {"id": f"play{n}", "num": str(n), "ws_port": 6089+n} for n in range(1, 6)
        ],
    },
    "schnuartz": {
        "label": "Specter Schnuartz", "min": 2,
        "instances": [
            {"id": f"schnuartz{n}", "num": str(n), "ws_port": 6099+n} for n in range(1, 6)
        ],
    },
}

MIN_INSTANCES = 2
MAX_INSTANCES = 5

STATE_FILE = "/opt/try-clavastack/pool/state.json"
RESTART_SCRIPT = "/opt/try-clavastack/pool/restart-simulator.sh"

# --- Hardware bridge: virtual microSD card + QR scanner TCP bridge ---
# These give the browser narrow, session-scoped access to the REAL Specter
# Unix simulator's own hardware interfaces (fs/sd directory, QR "UART" TCP
# socket) instead of faking hardware behaviour in JavaScript. Every request
# is bound to an allocated session -> instance mapping; nothing here accepts
# an arbitrary filesystem path, host, or port from the browser.
POOL_BASE_DIR = "/opt/try-clavastack/pool"
RUN_BASE_DIR = "/run/try-clavastack"

SD_FILENAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
SD_ALLOWED_UPLOAD_EXT = (".psbt", ".txt", ".json")
SD_MAX_FILE_BYTES = 512 * 1024          # generous for PSBTs/descriptors, still bounded
SD_MAX_FILES = 25                       # matches the real SD card being a small, not infinite, disk
QR_MAX_PAYLOAD_BYTES = 32 * 1024        # single (non-animated) QR frame payload

# Per-session "is the virtual card physically inserted" state. This is a
# *client-facing* affordance only: the Unix simulator's SDCard.is_present
# always returns True (there's no real insert/eject signal in the unix
# platform code), so we gate OUR OWN upload/delete endpoints on it, and are
# explicit in the UI that the real firmware cannot itself observe "ejected".
sd_inserted = {}   # sessionId -> bool
sd_lock = threading.Lock()
SESSION_TIMEOUT = 600          # 10 min inactivity timeout (no heartbeat = session dies)
CLEANUP_INTERVAL = 30
SCALE_DOWN_IDLE = 300
IDLE_RESET_INTERVAL = 600     # Reset idle instances every 10 min to keep them fresh
HEALTH_CHECK_INTERVAL = 60    # Check process health every 60s

lock = threading.Lock()
sessions = {}           # sessionId -> {pool, instance_id, created_at, last_heartbeat, expires_at}
running = set()         # set of instance IDs currently running
idle_since = {}         # instance_id -> timestamp when became idle
last_reset = {}         # instance_id -> timestamp of last reset


def load_state():
    global sessions
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r') as f:
                sessions = json.load(f).get('sessions', {})
    except Exception:
        sessions = {}


def save_state():
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump({"sessions": sessions}, f, indent=2)
    except Exception:
        pass


def is_instance_healthy(inst_id):
    """Check if the actual processes (micropython, websockify) for an instance are alive."""
    pid_file = f"/run/try-clavastack/{inst_id}/micropython.pid"
    ws_pid_file = f"/run/try-clavastack/{inst_id}/websockify.pid"
    try:
        # Check micropython process
        if not os.path.exists(pid_file):
            return False
        pid = int(open(pid_file).read().strip())
        if not os.path.exists(f"/proc/{pid}"):
            return False
        # Check websockify process
        if not os.path.exists(ws_pid_file):
            return False
        ws_pid = int(open(ws_pid_file).read().strip())
        if not os.path.exists(f"/proc/{ws_pid}"):
            return False
        return True
    except Exception:
        return False


def start_instance(inst_id):
    if inst_id in running:
        return True
    try:
        subprocess.run(["systemctl", "restart", f"try-{inst_id}"], timeout=30, capture_output=True)
        running.add(inst_id)
        idle_since[inst_id] = time.time()
        last_reset[inst_id] = time.time()
        print(f"Started {inst_id}")
        return True
    except Exception as e:
        print(f"Failed to start {inst_id}: {e}")
        return False


def stop_instance(inst_id):
    if inst_id not in running:
        return
    try:
        subprocess.run(["systemctl", "stop", f"try-{inst_id}"], timeout=30, capture_output=True)
        running.discard(inst_id)
        idle_since.pop(inst_id, None)
        last_reset.pop(inst_id, None)
        print(f"Stopped {inst_id}")
    except Exception as e:
        print(f"Failed to stop {inst_id}: {e}")


def restart_instance_proc(inst_id):
    try:
        subprocess.run(["systemctl", "restart", f"try-{inst_id}"], timeout=60, capture_output=True)
        running.add(inst_id)
        idle_since[inst_id] = time.time()
        last_reset[inst_id] = time.time()
        print(f"Restarted {inst_id}")
    except Exception as e:
        print(f"Failed to restart {inst_id}: {e}")


def pool_instances(pool_name):
    return POOLS[pool_name]["instances"]


def pool_running(pool_name):
    return [i for i in pool_instances(pool_name) if i["id"] in running]


def pool_occupied(pool_name):
    return {s["instance_id"] for s in sessions.values() if s.get("pool") == pool_name}


def ensure_min_for_pool(pool_name):
    pool_min = POOLS[pool_name].get("min", MIN_INSTANCES)
    count = len(pool_running(pool_name))
    if count >= pool_min:
        return
    for inst in pool_instances(pool_name):
        if inst["id"] not in running:
            start_instance(inst["id"])
            count += 1
            if count >= pool_min:
                break

def ensure_all_mins():
    for pool_name in POOLS:
        ensure_min_for_pool(pool_name)


def cleanup_and_scale():
    """Main background loop: expire sessions, health-check, reset idle instances, scale down."""
    health_check_counter = 0

    while True:
        time.sleep(CLEANUP_INTERVAL)
        now = datetime.utcnow()
        now_ts = time.time()
        expired = []
        health_check_counter += CLEANUP_INTERVAL

        # --- 1. Expire sessions (inactivity only — active users are never kicked) ---
        with lock:
            for sid, info in list(sessions.items()):
                try:
                    expires_at = datetime.fromisoformat(info["expires_at"])
                    if now > expires_at:
                        expired.append((sid, info["instance_id"]))
                        del sessions[sid]
                except (KeyError, ValueError):
                    expired.append((sid, info.get("instance_id", "")))
                    del sessions[sid]
            if expired:
                save_state()

        for sid, inst_id in expired:
            log_event("expired", instance=inst_id, session=sid[:16], reason="no_heartbeat")
            _heartbeat_counts.pop(sid, None)
            with sd_lock:
                sd_inserted.pop(sid, None)
            threading.Thread(target=restart_instance_proc, args=(inst_id,), daemon=True).start()

        # --- 2. Health check: verify running instances actually have live processes ---
        if health_check_counter >= HEALTH_CHECK_INTERVAL:
            health_check_counter = 0
            unhealthy = []
            with lock:
                occupied_all = {s["instance_id"] for s in sessions.values()}
            for inst_id in list(running):
                if not is_instance_healthy(inst_id):
                    unhealthy.append(inst_id)

            for inst_id in unhealthy:
                # If occupied, the user's session is broken - restart immediately
                if inst_id in occupied_all:
                    print(f"HEALTH: {inst_id} is occupied but unhealthy, restarting")
                    threading.Thread(target=restart_instance_proc, args=(inst_id,), daemon=True).start()
                else:
                    print(f"HEALTH: {inst_id} is idle but unhealthy, restarting")
                    threading.Thread(target=restart_instance_proc, args=(inst_id,), daemon=True).start()

        # --- 3. Reset idle instances periodically to keep them fresh ---
        with lock:
            occupied_all = {s["instance_id"] for s in sessions.values()}
        for inst_id in list(running):
            if inst_id in occupied_all:
                # In use - don't touch, clear idle tracking
                idle_since.pop(inst_id, None)
                continue
            # Track idle start
            if inst_id not in idle_since:
                idle_since[inst_id] = now_ts
            # Reset if idle for too long (keeps simulator in fresh state)
            lr = last_reset.get(inst_id, 0)
            if now_ts - lr > IDLE_RESET_INTERVAL and now_ts - idle_since.get(inst_id, now_ts) > IDLE_RESET_INTERVAL:
                print(f"IDLE RESET: resetting idle {inst_id} to fresh state")
                threading.Thread(target=restart_instance_proc, args=(inst_id,), daemon=True).start()

        # --- 4. Scale down extra instances per pool ---
        for pool_name in POOLS:
            occupied = pool_occupied(pool_name)
            pool_run = pool_running(pool_name)
            pool_min = POOLS[pool_name].get("min", MIN_INSTANCES)

            if len(pool_run) > pool_min:
                candidates = sorted(
                    [i for i in pool_run if i["id"] not in occupied],
                    key=lambda x: int(x["num"]),
                    reverse=True
                )
                for inst in candidates:
                    if len([i for i in pool_instances(pool_name) if i["id"] in running]) <= pool_min:
                        break
                    idle_t = idle_since.get(inst["id"], now_ts)
                    if now_ts - idle_t > SCALE_DOWN_IDLE:
                        print(f"Scaling down: stopping idle {inst['id']}")
                        threading.Thread(target=stop_instance, args=(inst["id"],), daemon=True).start()

        # --- 5. Ensure minimums are still met (in case health checks removed instances) ---
        ensure_all_mins()


def allocate_session(pool_name):
    if pool_name not in POOLS:
        return {"status": "error", "message": f"Unknown pool: {pool_name}"}

    scale_inst = None

    with lock:
        occupied = pool_occupied(pool_name)
        free_inst = None
        for inst in pool_instances(pool_name):
            if inst["id"] in running and inst["id"] not in occupied:
                # Prefer healthy instances
                if is_instance_healthy(inst["id"]):
                    free_inst = inst
                    break

        if free_inst:
            session_id = f"sess_{pool_name}_{int(time.time())}_{random.randint(1000,9999)}"
            now = datetime.utcnow()
            sessions[session_id] = {
                "pool": pool_name,
                "instance_id": free_inst['id'],
                "created_at": now.isoformat(),
                "last_heartbeat": now.isoformat(),
                "expires_at": (now + timedelta(seconds=SESSION_TIMEOUT)).isoformat()
            }
            save_state()
            idle_since.pop(free_inst['id'], None)
            log_event("allocated", pool=pool_name, instance=free_inst['id'], session=session_id[:16])
            return {
                "status": "ok",
                "sessionId": session_id,
                "pool": pool_name,
                "instanceId": free_inst['id'],
                "wsPath": f"/{pool_name}/sim/{free_inst['num']}/ws",
                "restartPath": f"/{pool_name}/sim/{free_inst['num']}/restart",
                "expiresIn": SESSION_TIMEOUT
            }

        # No free running instance — check if we can scale up
        pool_run_count = len(pool_running(pool_name))
        pool_max = POOLS[pool_name].get("max", MAX_INSTANCES)
        if pool_run_count < pool_max:
            for inst in pool_instances(pool_name):
                if inst["id"] not in running:
                    scale_inst = inst
                    break

    # Scale up outside lock (start_instance takes time)
    if scale_inst:
        if not start_instance(scale_inst['id']):
            return {"status": "error", "message": f"Failed to start {scale_inst['id']}"}
        time.sleep(4)

        with lock:
            occupied = pool_occupied(pool_name)
            if scale_inst['id'] not in occupied:
                session_id = f"sess_{pool_name}_{int(time.time())}_{random.randint(1000,9999)}"
                now = datetime.utcnow()
                sessions[session_id] = {
                    "pool": pool_name,
                    "instance_id": scale_inst['id'],
                    "created_at": now.isoformat(),
                    "last_heartbeat": now.isoformat(),
                    "expires_at": (now + timedelta(seconds=SESSION_TIMEOUT)).isoformat()
                }
                save_state()
                idle_since.pop(scale_inst['id'], None)
                log_event("allocated", pool=pool_name, instance=scale_inst['id'], session=session_id[:16], note="scaled_up")
                return {
                    "status": "ok",
                    "sessionId": session_id,
                    "pool": pool_name,
                    "instanceId": scale_inst['id'],
                    "wsPath": f"/{pool_name}/sim/{scale_inst['num']}/ws",
                    "restartPath": f"/{pool_name}/sim/{scale_inst['num']}/restart",
                    "expiresIn": SESSION_TIMEOUT
                }

    return {"status": "full"}


def heartbeat_session(session_id):
    with lock:
        if session_id not in sessions:
            return {"status": "not_found"}
        now = datetime.utcnow()
        sessions[session_id]["last_heartbeat"] = now.isoformat()
        sessions[session_id]["expires_at"] = (now + timedelta(seconds=SESSION_TIMEOUT)).isoformat()
        save_state()
        _heartbeat_counts[session_id] += 1
        if _heartbeat_counts[session_id] % 10 == 0:
            inst_id = sessions[session_id].get("instance_id", "?")
            log_event("heartbeat", instance=inst_id, session=session_id[:16], count=str(_heartbeat_counts[session_id]))
        return {"status": "ok"}


def release_session(session_id):
    with lock:
        if session_id not in sessions:
            return {"status": "not_found"}
        inst_id = sessions[session_id]["instance_id"]
        pool = sessions[session_id].get("pool", "?")
        del sessions[session_id]
        save_state()
    log_event("released", pool=pool, instance=inst_id, session=session_id[:16])
    _heartbeat_counts.pop(session_id, None)
    with sd_lock:
        sd_inserted.pop(session_id, None)
    threading.Thread(target=restart_instance_proc, args=(inst_id,), daemon=True).start()
    return {"status": "ok"}


def restart_by_pool_num(pool_name, num):
    inst_id = f"{pool_name}{num}"
    with lock:
        to_remove = [sid for sid, info in sessions.items() if info["instance_id"] == inst_id]
        for sid in to_remove:
            _heartbeat_counts.pop(sid, None)
            del sessions[sid]
        if to_remove:
            save_state()
    with sd_lock:
        for sid in to_remove:
            sd_inserted.pop(sid, None)
    log_event("restarted", pool=pool_name, instance=inst_id)
    try:
        subprocess.run(["systemctl", "restart", f"try-{inst_id}"], timeout=60, capture_output=True)
        running.add(inst_id)
        idle_since[inst_id] = time.time()
        last_reset[inst_id] = time.time()
        return {"status": "ok", "instanceId": inst_id}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def session_instance(session_id):
    """Resolve a browser-supplied sessionId to the (only) instance it may touch."""
    with lock:
        info = sessions.get(session_id)
        return info["instance_id"] if info else None


def instance_sd_dir(inst_id):
    """The real fs/sd directory for this instance, as reported by
    restart-simulator.sh (falls back to the conventional path if the state
    file is missing, e.g. right after a fresh deploy before first restart)."""
    try:
        with open(f"{RUN_BASE_DIR}/{inst_id}/sd_dir") as f:
            path = f.read().strip()
            if path:
                return path
    except Exception:
        pass
    return f"{POOL_BASE_DIR}/{inst_id}/fs/sd"


def instance_qr_port(inst_id):
    """The real TCP port the firmware's QR 'UART' is currently listening on
    (scraped from its own boot log by restart-simulator.sh, since it can
    auto-increment on a bind conflict)."""
    try:
        with open(f"{RUN_BASE_DIR}/{inst_id}/qr_port") as f:
            return int(f.read().strip())
    except Exception:
        return None


def sd_safe_path(inst_id, filename):
    """Resolve `filename` to a path strictly inside this instance's fs/sd
    directory, or None if it's missing/invalid/escapes the directory."""
    if not filename or not SD_FILENAME_RE.match(filename):
        return None
    base_dir = instance_sd_dir(inst_id)
    base_real = os.path.realpath(base_dir)
    candidate = os.path.realpath(os.path.join(base_dir, filename))
    if candidate != base_real and not candidate.startswith(base_real + os.sep):
        return None
    return candidate


def sd_list_files(inst_id):
    base_dir = instance_sd_dir(inst_id)
    out = []
    try:
        for name in sorted(os.listdir(base_dir)):
            full = os.path.join(base_dir, name)
            if not os.path.isfile(full):
                continue
            try:
                st = os.stat(full)
            except OSError:
                continue
            out.append({"name": name, "size": st.st_size, "mtime": int(st.st_mtime)})
    except OSError:
        pass
    return out


def qr_send_payload(inst_id, payload_bytes):
    """Deliver a QR payload to the REAL Specter simulator's QR scanner input
    by connecting to the same TCP socket a physical QR module would drive
    (see f469-disco/libs/unix/pyb.py / tcphost.py). The firmware parses it
    through its own normal QR code path - we never touch wallet state."""
    port = instance_qr_port(inst_id)
    if port is None:
        return False, "QR bridge is not available for this session yet (simulator still starting?)"
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=3) as s:
            s.sendall(payload_bytes + b"\r\n")
        return True, None
    except OSError as e:
        return False, f"Could not reach simulator QR input: {e}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logger.debug(fmt % args)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_json({})

    MAX_BODY_BYTES = 2 * 1024 * 1024  # generous headroom over SD_MAX_FILE_BYTES base64'd

    def do_POST(self):
        cl = int(self.headers.get('Content-Length', 0))
        if cl > self.MAX_BODY_BYTES:
            self.send_json({"error": "Request too large"}, 413)
            return
        body = self.rfile.read(cl).decode('utf-8', 'replace') if cl > 0 else '{}'
        try:
            data = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            data = {}

        hw = re.match(r'^/api/session/([^/]+)/(sd/insert|sd/eject|sd/upload|sd/delete|qr)$', self.path)

        if self.path == '/api/allocate':
            pool = data.get('pool', 'diy')
            self.send_json(allocate_session(pool))

        elif self.path == '/api/heartbeat':
            sid = data.get('sessionId', '')
            if not sid:
                self.send_json({"error": "Missing sessionId"}, 400)
                return
            self.send_json(heartbeat_session(sid))

        elif self.path == '/api/release':
            sid = data.get('sessionId', '')
            if not sid:
                self.send_json({"error": "Missing sessionId"}, 400)
                return
            self.send_json(release_session(sid))

        elif hw:
            self.handle_hw_action(hw.group(1), hw.group(2), data)

        else:
            m = re.match(r'^/(diy|play|schnuartz)/sim/([1-5])/restart$', self.path)
            if m:
                self.send_json(restart_by_pool_num(m.group(1), m.group(2)))
            else:
                self.send_json({"error": "Not found"}, 404)

    def handle_hw_action(self, session_id, action, data):
        """All /api/session/<id>/... hardware-bridge actions. Every one of
        these is strictly bound to the caller's OWN allocated session -
        there is no way to reach another visitor's instance from here."""
        inst_id = session_instance(session_id)
        if inst_id is None:
            self.send_json({"status": "not_found", "error": "Unknown or expired session"}, 404)
            return

        if action == 'sd/insert':
            with sd_lock:
                sd_inserted[session_id] = True
            self.send_json({"status": "ok", "inserted": True})

        elif action == 'sd/eject':
            with sd_lock:
                sd_inserted[session_id] = False
            self.send_json({"status": "ok", "inserted": False})

        elif action == 'sd/upload':
            with sd_lock:
                if not sd_inserted.get(session_id):
                    self.send_json({"status": "error", "message": "Card is ejected - insert it first"}, 409)
                    return
            filename = data.get('filename', '')
            b64 = data.get('data', '')
            if not filename or not any(filename.lower().endswith(ext) for ext in SD_ALLOWED_UPLOAD_EXT):
                self.send_json({"status": "error", "message": "Filename must end in .psbt, .txt or .json"}, 400)
                return
            path = sd_safe_path(inst_id, filename)
            if path is None:
                self.send_json({"status": "error", "message": "Invalid filename"}, 400)
                return
            try:
                raw = base64.b64decode(b64, validate=True)
            except Exception:
                self.send_json({"status": "error", "message": "data must be valid base64"}, 400)
                return
            if len(raw) > SD_MAX_FILE_BYTES:
                self.send_json({"status": "error", "message": "File too large"}, 413)
                return
            existing = sd_list_files(inst_id)
            if not os.path.exists(path) and len(existing) >= SD_MAX_FILES:
                self.send_json({"status": "error", "message": "SD card is full (test-session limit reached)"}, 400)
                return
            try:
                os.makedirs(instance_sd_dir(inst_id), exist_ok=True)
                with open(path, 'wb') as f:
                    f.write(raw)
            except OSError as e:
                self.send_json({"status": "error", "message": f"Write failed: {e}"}, 500)
                return
            log_event("sd_upload", instance=inst_id, session=session_id[:16], file=filename, bytes=str(len(raw)))
            self.send_json({"status": "ok", "files": sd_list_files(inst_id)})

        elif action == 'sd/delete':
            filename = data.get('filename', '')
            path = sd_safe_path(inst_id, filename)
            if path is None or not os.path.isfile(path):
                self.send_json({"status": "error", "message": "File not found"}, 404)
                return
            try:
                os.remove(path)
            except OSError as e:
                self.send_json({"status": "error", "message": f"Delete failed: {e}"}, 500)
                return
            log_event("sd_delete", instance=inst_id, session=session_id[:16], file=filename)
            self.send_json({"status": "ok", "files": sd_list_files(inst_id)})

        elif action == 'qr':
            payload = data.get('payload', '')
            if not isinstance(payload, str) or not payload:
                self.send_json({"status": "error", "message": "Missing payload"}, 400)
                return
            payload_bytes = payload.encode('utf-8')
            if len(payload_bytes) > QR_MAX_PAYLOAD_BYTES:
                self.send_json({"status": "error", "message": "QR payload too large"}, 413)
                return
            ok, err = qr_send_payload(inst_id, payload_bytes)
            # Never log QR payload contents - they may contain PSBTs, wallet
            # descriptors, or (accidentally) other sensitive data.
            log_event("qr_send", instance=inst_id, session=session_id[:16], ok=str(ok), bytes=str(len(payload_bytes)))
            if ok:
                self.send_json({"status": "ok"})
            else:
                self.send_json({"status": "error", "message": err}, 502)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        sd_get = re.match(r'^/api/session/([^/]+)/sd$', path)
        sd_dl = re.match(r'^/api/session/([^/]+)/sd/download$', path)

        if sd_get:
            session_id = sd_get.group(1)
            inst_id = session_instance(session_id)
            if inst_id is None:
                self.send_json({"status": "not_found", "error": "Unknown or expired session"}, 404)
                return
            with sd_lock:
                inserted = sd_inserted.get(session_id, False)
            self.send_json({"status": "ok", "inserted": inserted, "files": sd_list_files(inst_id)})
            return

        if sd_dl:
            session_id = sd_dl.group(1)
            inst_id = session_instance(session_id)
            if inst_id is None:
                self.send_json({"status": "not_found", "error": "Unknown or expired session"}, 404)
                return
            filename = (query.get('filename') or [''])[0]
            path = sd_safe_path(inst_id, filename)
            if path is None or not os.path.isfile(path):
                self.send_json({"status": "error", "message": "File not found"}, 404)
                return
            try:
                with open(path, 'rb') as f:
                    content = f.read()
            except OSError:
                self.send_json({"status": "error", "message": "Read failed"}, 500)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition', f'attachment; filename="{os.path.basename(filename)}"')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if path == '/api/status':
            with lock:
                result = {}
                for pname, pinfo in POOLS.items():
                    occ = pool_occupied(pname)
                    result[pname] = {
                        "label": pinfo["label"],
                        "instances": [
                            {
                                "id": i["id"],
                                "running": i["id"] in running,
                                "healthy": is_instance_healthy(i["id"]) if i["id"] in running else False,
                                "status": "occupied" if i["id"] in occ else ("free" if i["id"] in running else "stopped")
                            }
                            for i in pinfo["instances"]
                        ],
                        "runningCount": len(pool_running(pname)),
                        "activeSessions": len([s for s in sessions.values() if s.get("pool") == pname])
                    }
                self.send_json(result)
        else:
            self.send_json({"error": "Not found"}, 404)


def detect_running():
    for pname in POOLS:
        for inst in pool_instances(pname):
            pid_file = f"/run/try-clavastack/{inst['id']}/micropython.pid"
            try:
                if os.path.exists(pid_file):
                    pid = int(open(pid_file).read().strip())
                    if os.path.exists(f"/proc/{pid}"):
                        running.add(inst["id"])
                        idle_since[inst["id"]] = time.time()
                        last_reset[inst["id"]] = time.time()
                        print(f"Detected running: {inst['id']}")
            except Exception:
                pass


def main():
    load_state()
    with lock:
        sessions.clear()
        save_state()

    detect_running()
    print(f"Detected {len(running)} running: {running}")

    ensure_all_mins()
    print(f"After ensure_min: {len(running)} running: {running}")

    threading.Thread(target=cleanup_and_scale, daemon=True).start()

    port = 9001
    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer): pass
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f"Multi-Pool Allocator on http://127.0.0.1:{port}")
    print(f"Pools: {list(POOLS.keys())}, min={MIN_INSTANCES}, max={MAX_INSTANCES}")
    print(f"Session timeout: {SESSION_TIMEOUT}s (inactivity only, active users never kicked)")
    print(f"Idle reset interval: {IDLE_RESET_INTERVAL}s, health check: {HEALTH_CHECK_INTERVAL}s")
    server.serve_forever()


if __name__ == '__main__':
    main()
