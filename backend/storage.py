from __future__ import annotations
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# 数据落盘位置支持环境变量覆盖，便于容器挂载
HISTORY_DIR = Path(os.environ.get("HISTORY_DIR", Path.cwd() / "spectra_history"))
DB_PATH = HISTORY_DIR / "history.db"
HISTORY_DIR.mkdir(parents=True, exist_ok=True)

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _init_db() -> None:
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS history (
                name TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                meta TEXT NOT NULL,
                data TEXT NOT NULL
            )
        """)

def _load_json_file(path: Path) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def _import_legacy_json_history() -> None:
    """
    Import existing JSON history files into sqlite once so that
    previously saved数据不会丢失。
    """
    with _get_conn() as conn:
        for p in HISTORY_DIR.glob("*.json"):
            existing = conn.execute(
                "SELECT 1 FROM history WHERE name = ?", (p.stem,)
            ).fetchone()
            if existing:
                continue
            obj = _load_json_file(p)
            if not obj:
                continue
            meta = obj.get("meta", {}) or {}
            data = obj.get("data", {}) or {}
            meta.setdefault("name", p.stem)
            meta.setdefault("timestamp", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            conn.execute(
                """
                INSERT INTO history (name, timestamp, meta, data)
                VALUES (?, ?, ?, ?)
                """,
                (
                    p.stem,
                    meta.get("timestamp", ""),
                    json.dumps(meta, ensure_ascii=False),
                    json.dumps(data, ensure_ascii=False),
                ),
            )

def save_json(name: str, data: Dict, meta: Dict) -> Dict[str, str]:
    meta2 = dict(meta or {})
    meta2.setdefault("name", name)
    meta2.setdefault("timestamp", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    with _get_conn() as conn:
        conn.execute(
            """
            INSERT INTO history (name, timestamp, meta, data)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                timestamp = excluded.timestamp,
                meta = excluded.meta,
                data = excluded.data
            """,
            (
                name,
                meta2["timestamp"],
                json.dumps(meta2, ensure_ascii=False),
                json.dumps(data, ensure_ascii=False),
            ),
        )
    return {"name": name, "timestamp": meta2["timestamp"]}

def list_history() -> List[dict]:
    items: List[dict] = []
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT name, timestamp, meta FROM history ORDER BY timestamp DESC"
        ).fetchall()
        for row in rows:
            meta = json.loads(row["meta"])
            items.append(
                {
                    "name": row["name"],
                    "file": f"{row['name']}.sqlite",
                    "filename": f"{row['name']}.sqlite",
                    "timestamp": row["timestamp"],
                    "meta": meta,
                }
            )

    # 兼容仍未导入的 JSON 文件
    existing_names = {item["name"] for item in items}
    for p in sorted(HISTORY_DIR.glob("*.json")):
        if p.stem in existing_names:
            continue
        obj = _load_json_file(p)
        if obj:
            meta = obj.get("meta", {})
            items.append({
                "name": meta.get("name") or p.stem,
                "file": p.name,
                "filename": p.name,
                "timestamp": meta.get("timestamp", ""),
                "meta": meta,
            })
        else:
            items.append({"name": p.stem, "file": p.name, "filename": p.name, "timestamp": "", "meta": {}})
    return items

def _load_from_db(name: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT meta, data FROM history WHERE name = ?", (name,)
        ).fetchone()
        if not row:
            return None
        return {
            "meta": json.loads(row["meta"]),
            "data": json.loads(row["data"])
        }


def rename_history(old_name: str, new_name: str) -> Dict[str, str]:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT meta, data FROM history WHERE name = ?", (old_name,)
        ).fetchone()
        if not row:
            raise FileNotFoundError(old_name)
        meta = json.loads(row["meta"])
        data = json.loads(row["data"])
        meta["name"] = new_name
        meta["timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            """
            UPDATE history
            SET name = ?, timestamp = ?, meta = ?, data = ?
            WHERE name = ?
            """,
            (
                new_name,
                meta["timestamp"],
                json.dumps(meta, ensure_ascii=False),
                json.dumps(data, ensure_ascii=False),
                old_name,
            ),
        )

    # legacy JSON file rename if still存在
    legacy_old = HISTORY_DIR / f"{old_name}.json"
    legacy_new = HISTORY_DIR / f"{new_name}.json"
    if legacy_old.exists():
        legacy_old.rename(legacy_new)

    return {"name": new_name, "filename": f"{new_name}.sqlite", "timestamp": meta["timestamp"]}

def load_json(name_or_file: str) -> dict:
    p = Path(name_or_file)
    name_key = p.stem

    db_obj = _load_from_db(name_key)
    if db_obj:
        return db_obj

    if not p.suffix:
        p = HISTORY_DIR / f"{name_or_file}.json"
    elif not p.is_absolute():
        p = HISTORY_DIR / p.name
    if not p.exists():
        raise FileNotFoundError(p)
    obj = _load_json_file(p)
    if obj is None:
        raise FileNotFoundError(p)
    return obj

_init_db()
_import_legacy_json_history()
