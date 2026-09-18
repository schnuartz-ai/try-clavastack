"""Resolve and build public Specter revisions for the /ab browser page.

The allocator imports this module and exposes its small JSON API. Builds are
serialized in a background worker because Emscripten builds take minutes.
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import threading
try:
    import pwd
except ImportError:  # Windows development machines do not expose Unix users.
    pwd = None
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import quote, urlparse

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$", re.I)
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
KNOWN_REPOSITORIES = {
    "cryptoadvance/specter-diy",
    "schnuartz/specter-diy",
    "schnuartz-ai/specter-diy",
    "k9ert/specter-playground",
    "schnuartz-ai/specter-playground",
    "schnuartz/specter-playground",
    "schnuartz-ai/specter-playground-schnuartz",
}
AB_STORAGE = Path(os.environ.get("AB_BUILD_STORAGE", "/var/lib/try-clavastack/ab-builds"))
SOURCE_ROOT = Path(os.environ.get("AB_SOURCE_ROOT", "/opt/try-clavastack"))
WORK_ROOT = Path(os.environ.get("AB_WORK_ROOT", "/var/lib/try-clavastack/ab-work"))
BUILD_USER = os.environ.get("AB_BUILD_USER", "clavastack-ab")
jobs: dict[str, dict] = {}
jobs_by_key: dict[str, str] = {}
jobs_lock = threading.Lock()
build_queue: queue.Queue[str] = queue.Queue()


def _github(path: str) -> dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "try-clavastack-ab-builder",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"https://api.github.com{path}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError) as error:
        raise ValueError("GitHub could not resolve that link") from error


def _repo_info(repository: str) -> dict:
    return _github(f"/repos/{quote(repository, safe='/')}")


def _adapter(repository: str) -> str:
    lower = repository.lower()
    if lower in {item.lower() for item in KNOWN_REPOSITORIES}:
        return "diy" if "specter-diy" in lower else "mockui"
    if lower.endswith("/specter-diy") or lower.endswith("/specter-playground"):
        info = _repo_info(repository)
        parent = ((info.get("parent") or {}).get("full_name") or "").lower()
        if info.get("fork") and ("specter-diy" in parent or "specter-playground" in parent):
            return "diy" if lower.endswith("/specter-diy") else "mockui"
    if "specter-diy" in lower:
        raise ValueError("This Specter DIY repository is not a verified fork")
    if "specter-playground" in lower:
        raise ValueError("This Specter Playground repository is not a verified fork")
    raise ValueError("This repository is not an approved Specter source")


def resolve_url(raw_url: str) -> dict:
    if not isinstance(raw_url, str) or len(raw_url) > 500:
        raise ValueError("Enter a GitHub repository, branch, PR, or commit URL")
    parsed = urlparse(raw_url.strip())
    if parsed.scheme != "https" or parsed.netloc.lower() != "github.com" or parsed.query or parsed.fragment:
        raise ValueError("Only clean https://github.com URLs are supported")
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        raise ValueError("GitHub repository URL is incomplete")
    repository = f"{parts[0]}/{parts[1]}"
    kind = "latest"
    requested_ref = None
    if len(parts) >= 4 and parts[2] in {"pull", "pulls"}:
        kind = "pull"
        try:
            pull = _github(f"/repos/{quote(repository, safe='/')}/pulls/{int(parts[3])}")
        except ValueError:
            raise
        head = pull.get("head") or {}
        head_repo = (head.get("repo") or {}).get("full_name")
        commit = head.get("sha")
        if not head_repo or not COMMIT_RE.fullmatch(str(commit or "")):
            raise ValueError("That pull request has no buildable head revision")
        repository = head_repo
        source_url = raw_url.strip()
    elif len(parts) >= 4 and parts[2] == "commit":
        kind = "commit"
        commit = parts[3]
        if not COMMIT_RE.fullmatch(commit):
            raise ValueError("Commit URLs must contain a full 40-character SHA")
        source_url = raw_url.strip()
    elif len(parts) >= 4 and parts[2] == "tree":
        kind = "branch"
        requested_ref = "/".join(parts[3:])
        ref = _github(f"/repos/{quote(repository, safe='/')}/git/ref/heads/{quote(requested_ref, safe='/')}")
        commit = ((ref.get("object") or {}).get("sha"))
        source_url = raw_url.strip()
    elif len(parts) == 2:
        info = _repo_info(repository)
        requested_ref = str(info.get("default_branch") or "main")
        ref = _github(f"/repos/{quote(repository, safe='/')}/git/ref/heads/{quote(requested_ref, safe='/')}")
        commit = ((ref.get("object") or {}).get("sha"))
        source_url = raw_url.strip()
    else:
        raise ValueError("Use a repository, /tree/branch, /pull/number, or /commit/SHA URL")
    if not REPOSITORY_RE.fullmatch(repository) or not COMMIT_RE.fullmatch(str(commit or "")):
        raise ValueError("GitHub did not return a valid Specter revision")
    adapter = _adapter(repository)
    return {
        "repository": repository,
        "commit": str(commit).lower(),
        "adapter": adapter,
        "source_url": source_url,
        "kind": kind,
        "ref": requested_ref,
    }


def _safe_repo_path(repository: str) -> str:
    owner, name = repository.split("/", 1)
    return f"{owner}/{name}"


def _manifest_pointer(build_dir: Path, url_prefix: str) -> dict:
    info_path = build_dir / "build-info.json"
    info = json.loads(info_path.read_text(encoding="utf-8"))
    commit = str(info.get("commit", ""))
    version = str(info.get("artifact_set_sha256", ""))[:16]
    if not COMMIT_RE.fullmatch(commit) or not re.fullmatch(r"[a-f0-9]{16}", version):
        raise ValueError("Build manifest is invalid")
    for name in ("micropython.js", "micropython.wasm", "micropython.data"):
        if not (build_dir / name).is_file():
            raise ValueError("Build is missing a WebAssembly artifact")
    return {"build": f"{url_prefix.rstrip('/')}/", "version": version}


def _existing_build(spec: dict) -> dict | None:
    repository = spec["repository"]
    candidates = [
        Path("/var/www/try-clavastack-deploy/current/builds") / repository / spec["commit"],
        Path("/var/www/try-clavastack-deploy/current/builds") / f"{repository}-mockui" / spec["commit"],
        SOURCE_ROOT / "builds" / repository / spec["commit"],
        SOURCE_ROOT / "builds" / f"{repository}-mockui" / spec["commit"],
        AB_STORAGE / repository / spec["commit"],
    ]
    for candidate in candidates:
        if (candidate / "build-info.json").is_file():
            prefix = "/ab-builds/" + _safe_repo_path(repository) + "/" + spec["commit"]
            if str(candidate).startswith(str(AB_STORAGE)):
                return _manifest_pointer(candidate, prefix)
            # Existing static Playground builds have a -mockui directory.
            if str(candidate).startswith("/var/www/try-clavastack-deploy/current/"):
                current_root = Path("/var/www/try-clavastack-deploy/current")
                return _manifest_pointer(candidate, "/" + candidate.relative_to(current_root).as_posix())
    return None


def _public_job(job: dict) -> dict:
    result = {key: value for key, value in job.items() if key not in {"log", "source"}}
    return result


def submit(raw_url: str) -> dict:
    spec = resolve_url(raw_url)
    key = f"{spec['adapter']}:{spec['repository'].lower()}:{spec['commit']}"
    with jobs_lock:
        existing_id = jobs_by_key.get(key)
        if existing_id:
            return _public_job(jobs[existing_id])
        pointer = _existing_build(spec)
        job_id = uuid.uuid4().hex
        job = {
            "jobId": job_id,
            "status": "ready" if pointer else "queued",
            "message": "Build already available" if pointer else "Queued for an isolated build",
            "repository": spec["repository"],
            "commit": spec["commit"],
            "adapter": spec["adapter"],
            "sourceUrl": spec["source_url"],
            "pointer": pointer,
            "key": key,
        }
        jobs[job_id] = job
        jobs_by_key[key] = job_id
        if not pointer:
            build_queue.put(job_id)
        return _public_job(job)


def get_job(job_id: str) -> dict | None:
    with jobs_lock:
        return _public_job(jobs[job_id]) if job_id in jobs else None


def pointer_for_job(job_id: str) -> dict | None:
    with jobs_lock:
        job = jobs.get(job_id)
        return job.get("pointer") if job and job.get("status") == "ready" else None


def _worker() -> None:
    while True:
        job_id = build_queue.get()
        with jobs_lock:
            job = jobs.get(job_id)
            if not job:
                continue
            job["status"] = "building"
            job["message"] = "Building the requested revision…"
            spec = {key: job[key] for key in ("repository", "commit", "adapter")}
        try:
            env = os.environ.copy()
            env["AB_WORK_ROOT"] = str(WORK_ROOT / ".browser-work")
            env["AB_ARTIFACT_ROOT"] = str(WORK_ROOT / "builds")
            env["HOME"] = str(WORK_ROOT / ".builder-home")
            account = None
            if pwd is not None and os.name == "posix" and os.geteuid() == 0:
                account = pwd.getpwnam(BUILD_USER)
            WORK_ROOT.mkdir(parents=True, exist_ok=True)
            for directory in (WORK_ROOT / ".browser-work", WORK_ROOT / "builds", WORK_ROOT / ".builder-home"):
                directory.mkdir(parents=True, exist_ok=True)
                if account is not None:
                    # The allocator is root, but build-ab.sh runs as the
                    # unprivileged builder. Keep these roots writable for it.
                    os.chown(directory, account.pw_uid, account.pw_gid)
                    os.chmod(directory, 0o750)
            command = ["bash", str(SOURCE_ROOT / "browser/build-ab.sh"), spec["repository"], spec["commit"], spec["adapter"]]
            kwargs = {}
            if account is not None:
                kwargs["preexec_fn"] = lambda: (os.setgid(account.pw_gid), os.setuid(account.pw_uid))
            result = subprocess.run(command, cwd=SOURCE_ROOT, env=env, capture_output=True, text=True, timeout=90 * 60, **kwargs)
            if result.returncode:
                raise RuntimeError((result.stderr or result.stdout or "Build failed")[-2000:])
            source_dir = Path((result.stdout or "").strip().splitlines()[-1])
            if not source_dir.is_dir():
                raise RuntimeError("Builder did not produce an artifact directory")
            with jobs_lock:
                jobs[job_id]["status"] = "validating"
                jobs[job_id]["message"] = "Validating WebAssembly artifacts…"
            target = AB_STORAGE / _safe_repo_path(spec["repository"]) / spec["commit"]
            target.parent.mkdir(parents=True, exist_ok=True)
            staging = target.with_name(target.name + ".staging")
            if staging.exists():
                shutil.rmtree(staging)
            shutil.copytree(source_dir, staging)
            _manifest_pointer(staging, "/ab-builds/" + _safe_repo_path(spec["repository"]) + "/" + spec["commit"])
            if target.exists():
                shutil.rmtree(target)
            staging.rename(target)
            pointer = _manifest_pointer(target, "/ab-builds/" + _safe_repo_path(spec["repository"]) + "/" + spec["commit"])
            with jobs_lock:
                jobs[job_id].update(status="ready", message="Build ready", pointer=pointer)
        except Exception as error:  # keep the service alive for the next request
            with jobs_lock:
                jobs[job_id].update(status="failed", message="Build failed", error=str(error)[:2000])
        finally:
            build_queue.task_done()


threading.Thread(target=_worker, name="specter-ab-builder", daemon=True).start()
