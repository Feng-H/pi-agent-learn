#!/usr/bin/env python3
"""Inspect the state DB: records, TTL windows, size."""
import sqlite3
import datetime
import os

db = "/home/ubuntu/cliproxyapi/responses_state.db"
conn = sqlite3.connect(db)
rows = conn.execute(
    "SELECT response_id, created_at, expires_at, length(history_json) "
    "FROM conversation_history ORDER BY created_at"
).fetchall()

fmt = lambda ts: datetime.datetime.fromtimestamp(ts).strftime("%m-%d %H:%M")
print(f"{'response_id':<46} {'created':<14} {'expires':<14} {'bytes'}")
for rid, ca, ea, ln in rows:
    print(f"{rid:<46} {fmt(ca):<14} {fmt(ea):<14} {ln}")

n, total = conn.execute(
    "SELECT COUNT(*), SUM(length(history_json)) FROM conversation_history"
).fetchone()
print(f"\n共 {n} 条记录, 历史总字节: {total}, db文件: {os.path.getsize(db)} bytes")
print(f"TTL 设置: 24h, 每 10 分钟自动清理过期记录并 incremental_vacuum")
conn.close()
