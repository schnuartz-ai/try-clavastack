"""Allowlisted TLS transport for the browser's own Spectrum wallet backend.

No wallet or seed is stored here. Requests carry individual Electrum calls;
wallet descriptors and Spectrum's database stay in the browser.
"""

import json
import hashlib
import re
import socket
import ssl
import threading

SERVERS = {
    "electrum.blockstream.info": 50002,
    "electrum.emzy.de": 50002,
}
METHODS = {
    "server.version", "server.ping", "server.features",
    "blockchain.headers.subscribe", "blockchain.block.header", "blockchain.block.headers",
    "blockchain.scripthash.subscribe", "blockchain.scripthash.get_balance",
    "blockchain.scripthash.get_history", "blockchain.scripthash.listunspent",
    "blockchain.transaction.get", "blockchain.transaction.broadcast",
    "blockchain.estimatefee", "blockchain.relayfee", "mempool.get_fee_histogram",
}
_slots = threading.BoundedSemaphore(8)
_connections = {}
_locks = {host: threading.Lock() for host in SERVERS}


def query(body):
    if not isinstance(body, dict):
        raise ValueError("Expected a JSON object")
    host = body.get("host")
    method = body.get("method")
    params = body.get("params", [])
    if not isinstance(host, str) or host not in SERVERS or body.get("port") != SERVERS.get(host) or body.get("ssl") is not True:
        raise ValueError("Choose a supported Electrum TLS server on port 50002")
    if not isinstance(method, str) or method not in METHODS or not isinstance(params, list):
        raise ValueError("Unsupported Electrum request")
    hashes = body.get("scripthashes")
    parameter_batch = body.get("parameter_batch")
    if parameter_batch is not None and (hashes is not None or
            method not in {"blockchain.transaction.get", "blockchain.block.header",
                           "blockchain.scripthash.listunspent", "blockchain.scripthash.get_balance"} or
            not isinstance(parameter_batch, list) or not 1 <= len(parameter_batch) <= 100 or
            any(not isinstance(value, list) for value in parameter_batch)):
        raise ValueError("Invalid Electrum read batch")
    if hashes is not None and (method != "blockchain.scripthash.subscribe" or
            not isinstance(hashes, list) or not 1 <= len(hashes) <= 100 or
            any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value) for value in hashes)):
        raise ValueError("Invalid script status batch")
    # A shared relay must not retain thousands of per-wallet subscriptions.
    # Return the protocol's current status hash from a one-shot history query.
    script_status = method == "blockchain.scripthash.subscribe"
    if script_status:
        method = "blockchain.scripthash.get_history"
    if not _slots.acquire(blocking=False):
        raise RuntimeError("Electrum relay is busy. Please try again.")
    try:
        with _locks[host]:
            for attempt in range(2):
                try:
                    if parameter_batch is not None:
                        responses = _call_many(host, method, parameter_batch)
                        if any(response.get("error") for response in responses):
                            raise RuntimeError("Electrum could not read transaction data")
                        return {"result": [response.get("result") for response in responses], "error": None}
                    if hashes is not None:
                        responses = _call_many(host, method, [[value] for value in hashes])
                        if any(response.get("error") for response in responses):
                            raise RuntimeError("Electrum could not read script history")
                        histories = [response.get("result") or [] for response in responses]
                        results = [{"status": _status(history), "history": history} for history in histories] if body.get("include_history") else [_status(history) for history in histories]
                        return {"result": results, "error": None}
                    response = _call(host, method, params)
                    if script_status and not response.get("error"):
                        history = response.get("result") or []
                        response["result"] = _status(history)
                    return {"result": response.get("result"), "error": response.get("error")}
                except Exception:
                    old = _connections.pop(host, None)
                    if old:
                        old[1].close()
                        old[0].close()
                    if attempt or method == "blockchain.transaction.broadcast":
                        raise
    finally:
        _slots.release()


def _read(stream, request_id):
    while True:
        line = stream.readline(2_000_001)
        if not line or len(line) > 2_000_000:
            raise RuntimeError("Electrum returned an empty or oversized response")
        response = json.loads(line)
        if response.get("id") == request_id:
            return response


def _status(history):
    state = "".join(f"{tx['tx_hash']}:{tx['height']}:" for tx in history)
    return hashlib.sha256(state.encode()).hexdigest() if state else None


def _connection(host):
    if host not in _connections:
        raw = socket.create_connection((host, SERVERS[host]), timeout=12)
        try:
            connection = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        except Exception:
            raw.close()
            raise
        connection.settimeout(20)
        stream = connection.makefile("rb")
        _connections[host] = (connection, stream)
        connection.sendall(b'{"id":0,"method":"server.version","params":["ClavaStack Spectrum","1.4"]}\n')
        handshake = _read(stream, 0)
        if handshake.get("error"):
            raise RuntimeError("Electrum protocol negotiation failed")
    return _connections[host]


def _call(host, method, params):
    connection, stream = _connection(host)
    connection.sendall((json.dumps({"id": 1, "method": method, "params": params}) + "\n").encode())
    return _read(stream, 1)


def _call_many(host, method, params):
    connection, stream = _connection(host)
    payload = "".join(json.dumps({"id": index + 1, "method": method, "params": value}) + "\n"
                      for index, value in enumerate(params))
    connection.sendall(payload.encode())
    responses = {}
    while len(responses) < len(params):
        line = stream.readline(2_000_001)
        if not line or len(line) > 2_000_000:
            raise RuntimeError("Electrum returned an empty or oversized response")
        response = json.loads(line)
        request_id = response.get("id")
        if isinstance(request_id, int) and 1 <= request_id <= len(params):
            responses[request_id] = response
    return [responses[index + 1] for index in range(len(params))]
