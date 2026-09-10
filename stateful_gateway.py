#!/usr/bin/env python3
"""
Stateful Responses Gateway for CLIProxyAPI.
- Transparently proxies all requests to backend (port 8318).
- For /v1/responses, enables state retention via SQLite with automatic expiration and pruning.
"""

import asyncio
import json
import os
import re
import sqlite3
import time
from aiohttp import web, ClientSession, ClientTimeout

BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8318")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8317"))
DB_PATH = os.environ.get("DB_PATH", "/home/ubuntu/cliproxyapi/responses_state.db")
STATE_TTL_SECONDS = int(os.environ.get("STATE_TTL_SECONDS", "86400"))  # 24 hours
CLEANUP_INTERVAL = 600  # 10 minutes


def init_db(db_path: str):
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path)
    with conn:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA auto_vacuum = INCREMENTAL;")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversation_history (
                response_id TEXT PRIMARY KEY,
                history_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_expires_at ON conversation_history(expires_at);")
    conn.close()


def get_history(db_path: str, response_id: str):
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        now = int(time.time())
        cur.execute("SELECT history_json FROM conversation_history WHERE response_id = ? AND expires_at > ?", (response_id, now))
        row = cur.fetchone()
        if row:
            return json.loads(row[0])
        return None
    finally:
        conn.close()


def save_history(db_path: str, response_id: str, history_items: list, ttl: int = STATE_TTL_SECONDS):
    conn = sqlite3.connect(db_path)
    try:
        now = int(time.time())
        expires_at = now + ttl
        with conn:
            conn.execute("""
                INSERT OR REPLACE INTO conversation_history (response_id, history_json, created_at, expires_at)
                VALUES (?, ?, ?, ?);
            """, (response_id, json.dumps(history_items, ensure_ascii=False), now, expires_at))
    finally:
        conn.close()


def cleanup_expired(db_path: str):
    conn = sqlite3.connect(db_path)
    try:
        now = int(time.time())
        with conn:
            cur = conn.execute("DELETE FROM conversation_history WHERE expires_at <= ?", (now,))
            deleted = cur.rowcount
            conn.execute("PRAGMA incremental_vacuum;")
            return deleted
    finally:
        conn.close()


async def cleanup_loop(db_path: str):
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL)
            deleted = cleanup_expired(db_path)
            if deleted > 0:
                print(f"[AutoCleanup] Pruned {deleted} expired response states from SQLite.")
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[AutoCleanup Error] {e}")


def normalize_input_to_items(raw_input):
    if isinstance(raw_input, str):
        return [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": raw_input}]}]
    elif isinstance(raw_input, list):
        items = []
        for it in raw_input:
            if isinstance(it, str):
                items.append({"type": "message", "role": "user", "content": [{"type": "input_text", "text": it}]})
            elif isinstance(it, dict):
                items.append(it)
        return items
    return []


def extract_output_items_from_response(resp_data: dict) -> list:
    output_items = []
    outputs = resp_data.get("output", [])
    for out in outputs:
        if isinstance(out, dict):
            out_type = out.get("type")
            # Convert assistant message / reasoning / tool_call
            if out_type == "message":
                output_items.append(out)
            elif out_type in ("function_call", "custom_tool_call"):
                output_items.append(out)
    return output_items


async def handle_responses(request: web.Request, db_path: str) -> web.StreamResponse:
    try:
        body_bytes = await request.read()
        payload = json.loads(body_bytes.decode("utf-8"))
    except Exception:
        # Fallback to direct forward if cannot parse JSON
        return await forward_default(request)

    prev_id = payload.get("previous_response_id")
    current_input_items = normalize_input_to_items(payload.get("input", []))

    full_input_items = []
    if prev_id:
        prior_history = get_history(db_path, prev_id)
        if prior_history:
            print(f"[*] Restored {len(prior_history)} history items for previous_response_id={prev_id}")
            full_input_items = list(prior_history) + current_input_items
        else:
            print(f"[!] Warning: previous_response_id={prev_id} not found in DB, using current input.")
            full_input_items = current_input_items
    else:
        full_input_items = current_input_items

    # Update payload for backend: provide full input items and omit previous_response_id
    payload["input"] = full_input_items
    payload.pop("previous_response_id", None)
    new_body = json.dumps(payload).encode("utf-8")

    # Forward headers (excluding hop-by-hop)
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}
    headers["content-length"] = str(len(new_body))

    is_stream = bool(payload.get("stream", False))
    target_url = f"{BACKEND_URL}{request.path_qs}"

    timeout = ClientTimeout(total=300)
    session: ClientSession = request.app["client_session"]

    async with session.post(target_url, headers=headers, data=new_body, timeout=timeout) as upstream_resp:
        client_resp = web.StreamResponse(status=upstream_resp.status, reason=upstream_resp.reason)
        for h_key, h_val in upstream_resp.headers.items():
            if h_key.lower() not in ("transfer-encoding", "content-encoding", "content-length"):
                client_resp.headers[h_key] = h_val

        await client_resp.prepare(request)

        if not is_stream:
            # Non-streaming response: read full body, parse JSON, save history
            resp_bytes = await upstream_resp.read()
            parsed = None
            try:
                parsed = json.loads(resp_bytes.decode("utf-8"))
            except Exception as e:
                print(f"[!] Failed to parse non-streaming response: {e}")

            if parsed is not None:
                # Echo previous_response_id back for OpenAI SDK compatibility
                if prev_id and "previous_response_id" not in parsed:
                    parsed["previous_response_id"] = prev_id
                resp_bytes = json.dumps(parsed, ensure_ascii=False).encode("utf-8")

                new_resp_id = parsed.get("id")
                if new_resp_id and parsed.get("status") == "completed":
                    new_outputs = extract_output_items_from_response(parsed)
                    updated_history = full_input_items + new_outputs
                    save_history(db_path, new_resp_id, updated_history)
                    print(f"[*] Stored state for response_id={new_resp_id} (total items: {len(updated_history)})")

            await client_resp.write(resp_bytes)
            await client_resp.write_eof()
            return client_resp

        # Streaming SSE response: forward per-event frames, rewriting response.completed
        sse_buf = b""
        new_resp_id = None
        output_items = []
        async for chunk in upstream_resp.content.iter_any():
            sse_buf += chunk
            # Emit only complete SSE frames (separated by a blank line)
            while b"\n\n" in sse_buf:
                raw_frame, sse_buf = sse_buf.split(b"\n\n", 1)
                frame_text = raw_frame.decode("utf-8", errors="ignore").replace("\r\n", "\n").rstrip("\n")
                if not frame_text:
                    continue
                out_lines = []
                for line in frame_text.split("\n"):
                    if not line.startswith("data:"):
                        out_lines.append(line)
                        continue
                    data_str = line[5:].strip()
                    ev = None
                    try:
                        ev = json.loads(data_str)
                    except Exception:
                        ev = None
                    if ev is None:
                        out_lines.append(line)
                        continue
                    ev_type = ev.get("type", "")
                    if ev_type == "response.completed":
                        resp_obj = ev.get("response") or {}
                        new_resp_id = resp_obj.get("id")
                        output_items = extract_output_items_from_response(resp_obj)
                        if prev_id and "previous_response_id" not in resp_obj:
                            resp_obj["previous_response_id"] = prev_id
                            ev["response"] = resp_obj
                    elif "id" in ev and ev.get("object") == "response" and not new_resp_id:
                        new_resp_id = ev.get("id")
                    out_lines.append("data: " + json.dumps(ev, ensure_ascii=False))
                await client_resp.write(("\n".join(out_lines) + "\n\n").encode("utf-8"))

        if sse_buf.strip():
            await client_resp.write(sse_buf)
        await client_resp.write_eof()

        if new_resp_id:
            updated_history = full_input_items + output_items
            save_history(db_path, new_resp_id, updated_history)
            print(f"[*] Stored streaming state for response_id={new_resp_id} (total items: {len(updated_history)})")

        return client_resp


async def forward_default(request: web.Request) -> web.StreamResponse:
    target_url = f"{BACKEND_URL}{request.path_qs}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}
    body = await request.read()
    if body:
        headers["content-length"] = str(len(body))

    session: ClientSession = request.app["client_session"]
    timeout = ClientTimeout(total=300)

    try:
        async with session.request(request.method, target_url, headers=headers, data=body, timeout=timeout) as upstream_resp:
            client_resp = web.StreamResponse(status=upstream_resp.status, reason=upstream_resp.reason)
            for h_key, h_val in upstream_resp.headers.items():
                if h_key.lower() not in ("transfer-encoding", "content-encoding", "content-length"):
                    client_resp.headers[h_key] = h_val
            await client_resp.prepare(request)
            async for chunk in upstream_resp.content.iter_any():
                await client_resp.write(chunk)
            await client_resp.write_eof()
            return client_resp
    except Exception as e:
        return web.Response(text=f"Gateway Error: {e}", status=502)


async def main_handler(request: web.Request) -> web.StreamResponse:
    if request.path == "/v1/responses" and request.method == "POST":
        return await handle_responses(request, request.app["db_path"])
    return await forward_default(request)


async def on_startup(app: web.Application):
    app["client_session"] = ClientSession()
    app["cleanup_task"] = asyncio.create_task(cleanup_loop(app["db_path"]))


async def on_cleanup(app: web.Application):
    await app["client_session"].close()
    app["cleanup_task"].cancel()


def make_app(db_path: str) -> web.Application:
    init_db(db_path)
    app = web.Application()
    app["db_path"] = db_path
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    app.router.add_route("*", "/{tail:.*}", main_handler)
    return app


if __name__ == "__main__":
    app = make_app(DB_PATH)
    print(f"🚀 Stateful Responses Gateway starting on 0.0.0.0:{LISTEN_PORT} -> {BACKEND_URL}")
    print(f"📦 SQLite State Database: {DB_PATH} (TTL={STATE_TTL_SECONDS}s, Cleanup={CLEANUP_INTERVAL}s)")
    web.run_app(app, host="0.0.0.0", port=LISTEN_PORT)
