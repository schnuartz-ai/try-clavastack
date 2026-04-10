#!/usr/bin/env python3
"""
Multi-Pool Allocator API for 3 simulator types, each with auto-scaling (min 2, max 5).
"""

import json
import os
import re
import subprocess
import random
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from datetime import datetime, timedelta

POOLS = {
    "diy": {
        "label": "Specter DIY",
        "instances": [
            {"id": f"diy{n}", "num": str(n), "ws_port": 6079+n} for n in range(1, 6)
        ],
    },
    "play": {
        "label": "Specter Playground",
        "instances": [
            {"id": f"play{n}", "num": str(n), "ws_port": 6089+n} for n in range(1, 6)
        ],
    },
    "schnuartz": {
        "label": "Specter Schnuartz",
        "instances": [
            {"id": f"schnuartz{n}", "num": str(n), "ws_port": 6099+n} for n in range(1, 6)
        ],
    },
}

MIN_INSTANCES = 2
MAX_INSTANCES = 5

STATE_FILE = "/opt/try-clavastack/pool/state.json"
RESTART_SCRIPT = "/opt/try-clavastack/pool/restart-simulator.sh"
SESSION_TIMEOUT = 600
CLEANUP_INTERVAL = 30
SCALE_DOWN_IDLE = 300

lock = threading.Lock()
sessions = {}           # sessionId -> {pool, instance_id, created_at, last_heartbeat, expires_at}
running = set()         # set of instance IDs currently running
idle_since = {}         # instance_id -> timestamp when became idle


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


def start_instance(inst_id):
    if inst_id in running:
        return True
    try:
        subprocess.run(["systemctl", "start", f"try-{inst_id}"], timeout=30, capture_output=True)
        running.add(inst_id)
        idle_since[inst_id] = time.time()
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
        print(f"Stopped {inst_id}")
    except Exception as e:
        print(f"Failed to stop {inst_id}: {e}")


def restart_instance_proc(inst_id):
    try:
        subprocess.run([RESTART_SCRIPT, inst_id, "restart"], timeout=60, capture_output=True)
        running.add(inst_id)
        idle_since[inst_id] = time.time()
    except Exception as e:
        print(f"Failed to restart {inst_id}: {e}")


def pool_instances(pool_name):
    return POOLS[pool_name]["instances"]


def pool_running(pool_name):
    return [i for i in pool_instances(pool_name) if i["id"] in running]


def pool_occupied(pool_name):
    return {s["instance_id"] for s in sessions.values() if s.get("pool") == pool_name}


def ensure_min_for_pool(pool_name):
    count = len(pool_running(pool_name))
    for inst in pool_instances(pool_name):
        if count >= MIN_INSTANCES:
            break
        if inst["id"] not in running:
            start_instance(inst["id"])
            count += 1


def ensure_all_mins():
    for pool_name in POOLS:
        ensure_min_for_pool(pool_name)


def cleanup_and_scale():
    while True:
        time.sleep(CLEANUP_INTERVAL)
        now = datetime.utcnow()
        now_ts = time.time()
        expired = []

        with lock:
            for sid, info in list(sessions.items()):
                try:
                    if now > datetime.fromisoformat(info["expires_at"]):
                        expired.append((sid, info["instance_id"]))
                        del sessions[sid]
                except (KeyError, ValueError):
                    expired.append((sid, info.get("instance_id", "")))
                    del sessions[sid]
            if expired:
                save_state()

        for sid, inst_id in expired:
            print(f"Session {sid} expired, resetting {inst_id}")
            threading.Thread(target=restart_instance_proc, args=(inst_id,), daemon=True).start()

        # Scale down idle extra instances per pool
        for pool_name in POOLS:
            occupied = pool_occupied(pool_name)
            pool_run = pool_running(pool_name)

            for inst in pool_run:
                iid = inst["id"]
                if iid in occupied:
                    idle_since.pop(iid, None)
                elif iid not in idle_since:
                    idle_since[iid] = now_ts

            if len(pool_run) > MIN_INSTANCES:
                candidates = sorted(
                    [i for i in pool_run if i["id"] not in occupied],
                    key=lambda x: int(x["num"]),
                    reverse=True
                )
                for inst in candidates:
                    if len([i for i in pool_instances(pool_name) if i["id"] in running]) <= MIN_INSTANCES:
                        break
                    idle_t = idle_since.get(inst["id"], now_ts)
                    if now_ts - idle_t > SCALE_DOWN_IDLE:
                        print(f"Scaling down: stopping idle {inst['id']}")
                        threading.Thread(target=stop_instance, args=(inst["id"],), daemon=True).start()


def allocate_session(pool_name):
    if pool_name not in POOLS:
        return {"status": "error", "message": f"Unknown pool: {pool_name}"}

    with lock:
        occupied = pool_occupied(pool_name)
        free_inst = None
        for inst in pool_instances(pool_name):
            if inst["id"] in running and inst["id"] not in occupied:
                free_inst = inst
                break

    # Scale up if needed
    if not free_inst:
        pool_run_count = len(pool_running(pool_name))
        if pool_run_count < MAX_INSTANCES:
            for inst in pool_instances(pool_name):
                if inst["id"] not in running:
                    free_inst = inst
                    break
            if free_inst:
                if not start_instance(free_inst["id"]):
                    return {"status": "error", "message": f"Failed to start {free_inst['id']}"}
                time.sleep(4)

    if not free_inst:
        return {"status": "full"}

    with lock:
        session_id = f"sess_{pool_name}_{int(time.time())}_{random.randint(1000,9999)}"
        now = datetime.utcnow()
        sessions[session_id] = {
            "pool": pool_name,
            "instance_id": free_inst["id"],
            "created_at": now.isoformat(),
            "last_heartbeat": now.isoformat(),
            "expires_at": (now + timedelta(seconds=SESSION_TIMEOUT)).isoformat()
        }
        save_state()
        idle_since.pop(free_inst["id"], None)

        return {
            "status": "ok",
            "sessionId": session_id,
            "pool": pool_name,
            "instanceId": free_inst["id"],
            "wsPath": f"/{pool_name}/sim/{free_inst['num']}/ws",
            "restartPath": f"/{pool_name}/sim/{free_inst['num']}/restart",
            "expiresIn": SESSION_TIMEOUT
        }


def heartbeat_session(session_id):
    with lock:
        if session_id not in sessions:
            return {"status": "not_found"}
        now = datetime.utcnow()
        sessions[session_id]["last_heartbeat"] = now.isoformat()
        sessions[session_id]["expires_at"] = (now + timedelta(seconds=SESSION_TIMEOUT)).isoformat()
        save_state()
        return {"status": "ok"}


def release_session(session_id):
    with lock:
        if session_id not in sessions:
            return {"status": "not_found"}
        inst_id = sessions[session_id]["instance_id"]
        del sessions[session_id]
        save_state()
    threading.Thread(target=restart_instance_proc, args=(inst_id,), daemon=True).start()
    return {"status": "ok"}


def restart_by_pool_num(pool_name, num):
    inst_id = f"{pool_name}{num}"
    with lock:
        to_remove = [sid for sid, info in sessions.items() if info["instance_id"] == inst_id]
        for sid in to_remove:
            del sessions[sid]
        if to_remove:
            save_state()
    try:
        subprocess.run([RESTART_SCRIPT, inst_id, "restart"], timeout=60, capture_output=True)
        running.add(inst_id)
        idle_since[inst_id] = time.time()
        return {"status": "ok", "instanceId": inst_id}
    except Exception as e:
        return {"status": "error", "message": str(e)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[{datetime.utcnow().isoformat()}] {fmt % args}")

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

    def do_POST(self):
        cl = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(cl).decode() if cl > 0 else '{}'
        try:
            data = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            data = {}

        # POST /api/allocate  body: {"pool": "diy"|"play"|"schnuartz"}
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

        # POST /<pool>/sim/<num>/restart
        else:
            m = re.match(r'^/(diy|play|schnuartz)/sim/([1-5])/restart$', self.path)
            if m:
                self.send_json(restart_by_pool_num(m.group(1), m.group(2)))
            else:
                self.send_json({"error": "Not found"}, 404)

    def do_GET(self):
        if self.path == '/api/status':
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
    server.serve_forever()


if __name__ == '__main__':
    main()
