from __future__ import annotations
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

HISTORY_DIR = Path.cwd() / "spectra_history"
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
            "SELECT name, timestamp FROM history ORDER BY timestamp DESC"
        ).fetchall()
        for row in rows:
            items.append({
                "name": row["name"],
                "file": f"{row['name']}.sqlite",
                "timestamp": row["timestamp"]
            })

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
                "timestamp": meta.get("timestamp", "")
            })
        else:
            items.append({"name": p.stem, "file": p.name, "timestamp": ""})
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
