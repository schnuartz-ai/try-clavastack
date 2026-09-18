#!/usr/bin/env python3
"""
Multi-Pool Allocator API for 3 simulator types, each with auto-scaling (min 2, max 5).
"""

import json
import base64
import logging
import os
import re
import subprocess
import random
import threading
import time
from urllib.parse import urlparse
from collections import defaultdict
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from datetime import datetime, timedelta

try:
    from ab_builds import get_job, pointer_for_job, submit as submit_ab_build
except ImportError:  # keep the legacy allocator usable in older checkouts
    get_job = pointer_for_job = submit_ab_build = None

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
FEEDBACK_FILE = "/opt/try-clavastack/pool/feedback.json"
FEEDBACK_MEDIA_DIR = "/opt/try-clavastack/pool/feedback-media"
FEEDBACK_LIMIT = 200
FEEDBACK_MAX_IMAGE_BYTES = 2 * 1024 * 1024
FEEDBACK_VARIANTS = {
    "diy": {"label": "Specter DIY · Device 1", "repository": "schnuartz-ai/specter-diy"},
    "play": {"label": "K9ert Playground · Device 2", "repository": "k9ert/specter-playground"},
    "schnuartz": {"label": "Schnuartz Playground · Device 3", "repository": "Schnuartz/specter-playground"},
}
RESTART_SCRIPT = "/opt/try-clavastack/pool/restart-simulator.sh"
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
feedback_lock = threading.Lock()
feedback_items = []
FEEDBACK_IMAGE_TYPES = {
    'image/png': ('png', b'\x89PNG\r\n\x1a\n'),
    'image/jpeg': ('jpg', b'\xff\xd8\xff'),
    'image/gif': ('gif', b'GIF8'),
    'image/webp': ('webp', b'RIFF'),
}


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


def load_feedback():
    global feedback_items
    try:
        with open(FEEDBACK_FILE, 'r') as f:
            data = json.load(f)
        items = data.get('comments', []) if isinstance(data, dict) else data if isinstance(data, list) else []
        if not isinstance(items, list):
            items = []
        valid = []
        for item in items:
            if not isinstance(item, dict):
                continue
            item_type = item.get('type', 'comment')
            variant = item.get('variant')
            if item_type not in {'comment', 'poll'} or variant not in FEEDBACK_VARIANTS:
                continue
            try:
                likes = max(0, int(item.get('likes', 0)))
                dislikes = max(0, int(item.get('dislikes', 0)))
            except (TypeError, ValueError):
                likes = dislikes = 0
            image_url = item.get('imageUrl') or item.get('screenshotUrl')
            normalized = {
                'id': str(item.get('id', '')),
                'createdAt': str(item.get('createdAt', '')),
                'variant': variant,
                'type': item_type,
                'label': FEEDBACK_VARIANTS[variant]['label'],
                'repository': FEEDBACK_VARIANTS[variant]['repository'],
                'version': str(item.get('version', 'Unknown'))[:200],
                'browser': str(item.get('browser', 'Unknown'))[:200],
                'status': item.get('status') if item.get('status') in {'new', 'in_progress', 'resolved'} else 'new',
                'likes': likes,
                'dislikes': dislikes,
                'imageUrl': image_url if isinstance(image_url, str) else None,
            }
            if item_type == 'comment':
                comment = str(item.get('comment', '')).strip()
                if not comment or len(comment) > 5000:
                    continue
                normalized['comment'] = comment
            else:
                question = str(item.get('question', '')).strip()
                raw_options = item.get('options')
                options = []
                if isinstance(raw_options, list):
                    for raw_option in raw_options[:6]:
                        if isinstance(raw_option, dict):
                            option_text = str(raw_option.get('text', '')).strip()
                            option_votes = raw_option.get('votes', 0)
                        else:
                            option_text = str(raw_option).strip()
                            option_votes = 0
                        if not option_text or len(option_text) > 80 or any(option_text.casefold() == existing['text'].casefold() for existing in options):
                            continue
                        try:
                            option_votes = max(0, int(option_votes))
                        except (TypeError, ValueError):
                            option_votes = 0
                        options.append({'text': option_text, 'votes': option_votes})
                if not question or len(question) > 240 or len(options) < 2:
                    continue
                normalized['question'] = question
                normalized['options'] = options
            valid.append(normalized)
        feedback_items = valid[:FEEDBACK_LIMIT]
    except (OSError, ValueError, TypeError):
        feedback_items = []


def save_feedback():
    temp_file = f"{FEEDBACK_FILE}.tmp"
    try:
        with open(temp_file, 'w') as f:
            json.dump({'comments': feedback_items}, f, ensure_ascii=False, indent=2)
        os.replace(temp_file, FEEDBACK_FILE)
    except OSError:
        try:
            os.unlink(temp_file)
        except OSError:
            pass


def get_feedback():
    with feedback_lock:
        return {'status': 'ok', 'comments': list(feedback_items)}


def create_feedback(data):
    variant = data.get('variant') if isinstance(data, dict) else None
    if variant not in FEEDBACK_VARIANTS:
        return {'status': 'error', 'error': 'Choose a valid simulator.'}
    item_type = data.get('type', 'comment') if isinstance(data, dict) else 'comment'
    if item_type not in {'comment', 'poll'}:
        return {'status': 'error', 'error': 'Choose comment or poll.'}
    comment = str(data.get('comment', '')).strip() if isinstance(data, dict) else ''
    question = str(data.get('question', '')).strip() if isinstance(data, dict) else ''
    options = []
    if item_type == 'comment':
        if not comment:
            return {'status': 'error', 'error': 'Comment cannot be empty.'}
        if len(comment) > 5000:
            return {'status': 'error', 'error': 'Comment is limited to 5000 characters.'}
    else:
        if not question:
            return {'status': 'error', 'error': 'Poll question cannot be empty.'}
        if len(question) > 240:
            return {'status': 'error', 'error': 'Poll question is limited to 240 characters.'}
        raw_options = data.get('options') if isinstance(data, dict) else None
        if not isinstance(raw_options, list):
            return {'status': 'error', 'error': 'Add at least two poll options.'}
        for raw_option in raw_options[:6]:
            option = str(raw_option).strip()
            if not option:
                continue
            if len(option) > 80:
                return {'status': 'error', 'error': 'Poll options are limited to 80 characters.'}
            if any(option.casefold() == existing.casefold() for existing in options):
                return {'status': 'error', 'error': 'Poll options must be unique.'}
            options.append(option)
        if len(options) < 2:
            return {'status': 'error', 'error': 'Add at least two poll options.'}
    version = str(data.get('version', 'Unknown')).strip()[:200]
    browser = str(data.get('browser', 'Unknown')).strip()[:200]
    now = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
    item = {
        'id': f"feedback_{int(time.time() * 1000)}_{random.randint(1000, 9999)}",
        'createdAt': now,
        'variant': variant,
        'type': item_type,
        'label': FEEDBACK_VARIANTS[variant]['label'],
        'repository': FEEDBACK_VARIANTS[variant]['repository'],
        'version': version or 'Unknown',
        'browser': browser or 'Unknown',
        'status': 'new',
        'likes': 0,
        'dislikes': 0,
        'imageUrl': None,
    }
    if item_type == 'comment':
        item['comment'] = comment
    else:
        item['question'] = question
        item['options'] = [{'text': option, 'votes': 0} for option in options]
    screenshot = data.get('screenshot') if isinstance(data, dict) else None
    if screenshot:
        if not isinstance(screenshot, str) or ',' not in screenshot:
            return {'status': 'error', 'error': 'Screenshot data is invalid.'}
        header, encoded = screenshot.split(',', 1)
        mime = header[5:].split(';', 1)[0].lower() if header.startswith('data:') else ''
        image_type = FEEDBACK_IMAGE_TYPES.get(mime)
        if not image_type:
            return {'status': 'error', 'error': 'Screenshot must be PNG, JPEG, GIF or WebP.'}
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            return {'status': 'error', 'error': 'Screenshot data is invalid.'}
        if len(image_bytes) > FEEDBACK_MAX_IMAGE_BYTES or not image_bytes.startswith(image_type[1]):
            return {'status': 'error', 'error': 'Screenshot must be a valid image up to 2 MB.'}
        os.makedirs(FEEDBACK_MEDIA_DIR, mode=0o750, exist_ok=True)
        filename = f"{item['id']}.{image_type[0]}"
        with open(os.path.join(FEEDBACK_MEDIA_DIR, filename), 'wb') as image_file:
            image_file.write(image_bytes)
        item['imageUrl'] = f"/api/feedback/media/{filename}"
    with feedback_lock:
        feedback_items.insert(0, item)
        del feedback_items[FEEDBACK_LIMIT:]
        save_feedback()
        return {'status': 'ok', 'comment': item}


def update_feedback_status(data):
    comment_id = data.get('id') if isinstance(data, dict) else None
    status = data.get('status') if isinstance(data, dict) else None
    if status not in {'new', 'in_progress', 'resolved'}:
        return {'status': 'error', 'error': 'Choose a valid status.'}
    with feedback_lock:
        for item in feedback_items:
            if item.get('id') == comment_id:
                item['status'] = status
                save_feedback()
                return {'status': 'ok', 'comment': item}
    return {'status': 'error', 'error': 'Comment not found.'}


def update_feedback_reaction(data):
    comment_id = data.get('id') if isinstance(data, dict) else None
    reaction = data.get('reaction') if isinstance(data, dict) else None
    if reaction not in {'like', 'dislike'}:
        return {'status': 'error', 'error': 'Choose like or dislike.'}
    with feedback_lock:
        for item in feedback_items:
            if item.get('id') == comment_id:
                key = 'likes' if reaction == 'like' else 'dislikes'
                item[key] = max(0, int(item.get(key, 0))) + 1
                save_feedback()
                return {'status': 'ok', 'comment': item}
    return {'status': 'error', 'error': 'Comment not found.'}


def vote_feedback(data):
    comment_id = data.get('id') if isinstance(data, dict) else None
    try:
        option_index = int(data.get('option')) if isinstance(data, dict) else -1
    except (TypeError, ValueError):
        option_index = -1
    with feedback_lock:
        for item in feedback_items:
            if item.get('id') != comment_id:
                continue
            options = item.get('options') if item.get('type') == 'poll' else None
            if not isinstance(options, list) or not 0 <= option_index < len(options):
                return {'status': 'error', 'error': 'Choose a valid poll option.'}
            options[option_index]['votes'] = max(0, int(options[option_index].get('votes', 0))) + 1
            save_feedback()
            return {'status': 'ok', 'comment': item}
    return {'status': 'error', 'error': 'Poll not found.'}


def send_feedback_media(handler, filename):
    match = re.fullmatch(r'(feedback_[A-Za-z0-9_-]+)\.(png|jpg|gif|webp)', filename)
    if not match:
        handler.send_response(404)
        handler.end_headers()
        return
    path = os.path.join(FEEDBACK_MEDIA_DIR, filename)
    if not os.path.isfile(path):
        handler.send_response(404)
        handler.end_headers()
        return
    content_type = {'png': 'image/png', 'jpg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp'}[match.group(2)]
    with open(path, 'rb') as image_file:
        content = image_file.read(FEEDBACK_MAX_IMAGE_BYTES + 1)
    handler.send_response(200)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Content-Length', str(len(content)))
    handler.send_header('Cache-Control', 'public, max-age=31536000, immutable')
    handler.end_headers()
    handler.wfile.write(content)


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
    log_event("restarted", pool=pool_name, instance=inst_id)
    try:
        subprocess.run(["systemctl", "restart", f"try-{inst_id}"], timeout=60, capture_output=True)
        running.add(inst_id)
        idle_since[inst_id] = time.time()
        last_reset[inst_id] = time.time()
        return {"status": "ok", "instanceId": inst_id}
    except Exception as e:
        return {"status": "error", "message": str(e)}


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

    def do_POST(self):
        cl = int(self.headers.get('Content-Length', 0))
        max_body = 4000000 if urlparse(self.path).path == '/api/feedback' else 12000
        if cl > max_body:
            self.send_json({'error': 'Request body too large'}, 413)
            return
        body = self.rfile.read(cl).decode() if cl > 0 else '{}'
        try:
            data = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            data = {}

        path = urlparse(self.path).path
        if path == '/api/feedback':
            result = create_feedback(data)
            self.send_json(result, 201 if result.get('status') == 'ok' else 400)

        elif path == '/api/feedback/status':
            result = update_feedback_status(data)
            self.send_json(result, 200 if result.get('status') == 'ok' else 400)

        elif path == '/api/feedback/reaction':
            result = update_feedback_reaction(data)
            self.send_json(result, 200 if result.get('status') == 'ok' else 400)

        elif path == '/api/feedback/vote':
            result = vote_feedback(data)
            self.send_json(result, 200 if result.get('status') == 'ok' else 400)

        elif path == '/api/allocate':
            pool = data.get('pool', 'diy')
            self.send_json(allocate_session(pool))

        elif path == '/api/heartbeat':
            sid = data.get('sessionId', '')
            if not sid:
                self.send_json({"error": "Missing sessionId"}, 400)
                return
            self.send_json(heartbeat_session(sid))

        elif path == '/api/release':
            sid = data.get('sessionId', '')
            if not sid:
                self.send_json({"error": "Missing sessionId"}, 400)
                return
            self.send_json(release_session(sid))

        elif path == '/api/ab/build':
            if submit_ab_build is None:
                self.send_json({'error': 'A/B build service is not installed'}, 503)
                return
            try:
                self.send_json(submit_ab_build(data.get('url', '')), 202)
            except ValueError as error:
                self.send_json({'error': str(error)}, 400)

        else:
            m = re.match(r'^/(diy|play|schnuartz)/sim/([1-5])/restart$', self.path)
            if m:
                self.send_json(restart_by_pool_num(m.group(1), m.group(2)))
            else:
                self.send_json({"error": "Not found"}, 404)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/feedback':
            self.send_json(get_feedback())
        elif path.startswith('/api/feedback/media/'):
            send_feedback_media(self, path.rsplit('/', 1)[-1])
        elif path == '/api/status':
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
        elif path.startswith('/api/ab/build/'):
            if get_job is None:
                self.send_json({'error': 'A/B build service is not installed'}, 503)
                return
            job = get_job(path.rsplit('/', 1)[-1])
            self.send_json(job or {'error': 'Unknown build job'}, 200 if job else 404)
        elif path.startswith('/api/ab/pointer/'):
            if pointer_for_job is None:
                self.send_json({'error': 'A/B build service is not installed'}, 503)
                return
            pointer = pointer_for_job(path.rsplit('/', 1)[-1])
            self.send_json(pointer or {'error': 'Build is not ready'}, 200 if pointer else 404)
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
    load_feedback()
    with lock:
        sessions.clear()
        save_state()

    detect_running()
    print(f"Detected {len(running)} running: {running}")

    ensure_all_mins()
    print(f"After ensure_min: {len(running)} running: {running}")
    print(f"Loaded shared feedback comments: {len(feedback_items)}")

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
