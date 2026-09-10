#!/usr/bin/env python3
"""Verify expiration cleanup: insert a fake expired record, run cleanup, confirm removal."""
import sqlite3
import time
import importlib.util

db = "/home/ubuntu/cliproxyapi/responses_state.db"

conn = sqlite3.connect(db)
conn.execute(
    "INSERT OR REPLACE INTO conversation_history (response_id, history_json, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ("resp_FAKE_EXPIRED", '["fake"]', int(time.time()) - 100, int(time.time()) - 50),
)
conn.commit()
before = conn.execute("SELECT COUNT(*) FROM conversation_history").fetchone()[0]
conn.close()
print(f"插入假过期记录后: {before} 条")

spec = importlib.util.spec_from_file_location("gw", "/home/ubuntu/cliproxyapi/stateful_gateway.py")
gw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gw)

deleted = gw.cleanup_expired(db)
print(f"cleanup_expired() 删除了 {deleted} 条")

after = sqlite3.connect(db).execute("SELECT COUNT(*) FROM conversation_history").fetchone()[0]
print(f"清理后剩余: {after} 条")
assert deleted == 1 and after == before - 1, "cleanup verification FAILED"
print("✓ 过期清理机制验证通过")
