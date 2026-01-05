from __future__ import annotations
import json
import sqlite3
import hashlib
import hmac
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

HISTORY_DIR = Path(os.getenv("HISTORY_DIR", Path.cwd() / "spectra_history"))
DB_PATH = HISTORY_DIR / "history.db"
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
PASSWORD_SALT = "spectra_salt_v1"
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "spectral123"

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _init_db() -> None:
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                meta TEXT NOT NULL,
                data TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                last_login TEXT DEFAULT ''
            )
        """)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(history)")}
        if "id" not in columns:
            conn.execute("ALTER TABLE history RENAME TO history_legacy")
            conn.execute("""
                CREATE TABLE history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    meta TEXT NOT NULL,
                    data TEXT NOT NULL
                )
            """)
            conn.execute(
                """
                INSERT INTO history (name, timestamp, meta, data)
                SELECT name, timestamp, meta, data FROM history_legacy
                """
            )
            conn.execute("DROP TABLE history_legacy")

def _load_json_file(path: Path) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def _hash_password(password: str) -> str:
    return hashlib.sha256(f"{PASSWORD_SALT}:{password}".encode("utf-8")).hexdigest()

def _verify_password(password: str, password_hash: str) -> bool:
    return hmac.compare_digest(_hash_password(password), password_hash)

def _ensure_default_admin() -> None:
    with _get_conn() as conn:
        existing = conn.execute(
            "SELECT username FROM users WHERE username = ?", (DEFAULT_ADMIN_USERNAME,)
        ).fetchone()
        if not existing:
            conn.execute(
                """
                INSERT INTO users (username, password_hash, role, last_login)
                VALUES (?, ?, ?, ?)
                """,
                (
                    DEFAULT_ADMIN_USERNAME,
                    _hash_password(DEFAULT_ADMIN_PASSWORD),
                    "admin",
                    "",
                ),
            )
        else:
            conn.execute(
                """
                UPDATE users SET password_hash = ? WHERE username = ?
                """,
                (_hash_password(DEFAULT_ADMIN_PASSWORD), DEFAULT_ADMIN_USERNAME),
            )

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
        cur = conn.execute(
            """
            INSERT INTO history (name, timestamp, meta, data)
            VALUES (?, ?, ?, ?)
            """,
            (
                name,
                meta2["timestamp"],
                json.dumps(meta2, ensure_ascii=False),
                json.dumps(data, ensure_ascii=False),
            ),
        )
    return {"name": name, "timestamp": meta2["timestamp"], "id": str(cur.lastrowid)}

def list_history() -> List[dict]:
    items: List[dict] = []
    db_names: set[str] = set()
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, timestamp, meta FROM history ORDER BY timestamp DESC"
        ).fetchall()
        for row in rows:
            meta = json.loads(row["meta"])
            db_names.add(row["name"])
            items.append({
                "name": str(row["id"]),
                "file": f"{row['id']}.sqlite",
                "timestamp": row["timestamp"],
                "meta": meta
            })

    # 兼容仍未导入的 JSON 文件
    for p in sorted(HISTORY_DIR.glob("*.json")):
        if p.stem in db_names:
            continue
        obj = _load_json_file(p)
        if obj:
            meta = obj.get("meta", {})
            items.append({
                "name": meta.get("name") or p.stem,
                "file": p.name,
                "timestamp": meta.get("timestamp", ""),
                "meta": meta
            })
        else:
            items.append({"name": p.stem, "file": p.name, "timestamp": "", "meta": {}})
    return items

def _load_from_db(identifier: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = _resolve_history_row(conn, identifier)
        if not row:
            return None
        return {
            "meta": json.loads(row["meta"]),
            "data": json.loads(row["data"])
        }

def _resolve_history_row(conn: sqlite3.Connection, identifier: str) -> Optional[sqlite3.Row]:
    if identifier.isdigit():
        row = conn.execute(
            "SELECT id, name, timestamp, meta, data FROM history WHERE id = ?",
            (int(identifier),),
        ).fetchone()
        if row:
            return row
    return conn.execute(
        """
        SELECT id, name, timestamp, meta, data
        FROM history
        WHERE name = ?
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (identifier,),
    ).fetchone()

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

def rename_history(old_name: str, new_name: str) -> Dict[str, str]:
    with _get_conn() as conn:
        row = _resolve_history_row(conn, old_name)
        if not row:
            raise FileNotFoundError(old_name)
        meta = json.loads(row["meta"])
        meta["name"] = new_name
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        meta["timestamp"] = ts
        conn.execute(
            """
            UPDATE history
            SET name = ?, meta = ?, timestamp = ?
            WHERE id = ?
            """,
            (
                new_name,
                json.dumps(meta, ensure_ascii=False),
                ts,
                row["id"],
            ),
        )
    legacy_file = HISTORY_DIR / f"{old_name}.json"
    if legacy_file.exists():
        legacy_file.rename(HISTORY_DIR / f"{new_name}.json")
    return {"name": new_name, "timestamp": ts}

def update_history_meta(name: str, updates: Dict[str, Any]) -> Dict[str, str]:
    with _get_conn() as conn:
        row = _resolve_history_row(conn, name)
        if not row:
            raise FileNotFoundError(name)
        meta = json.loads(row["meta"])
        meta.update({k: v for k, v in updates.items() if v is not None})
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "UPDATE history SET meta = ?, timestamp = ? WHERE id = ?",
            (
                json.dumps(meta, ensure_ascii=False),
                ts,
                row["id"],
            ),
        )
    return {"name": name, "timestamp": ts, "meta": meta}

def delete_history(name: str) -> None:
    with _get_conn() as conn:
        row = _resolve_history_row(conn, name)
        if not row:
            raise FileNotFoundError(name)
        conn.execute("DELETE FROM history WHERE id = ?", (row["id"],))
    legacy_file = HISTORY_DIR / f"{name}.json"
    if legacy_file.exists():
        legacy_file.unlink()

def _get_user(username: str) -> Optional[sqlite3.Row]:
    with _get_conn() as conn:
        return conn.execute(
            "SELECT username, password_hash, role, last_login FROM users WHERE username = ?",
            (username,),
        ).fetchone()

def authenticate_user(username: str, password: str) -> Dict[str, str]:
    row = _get_user(username)
    if not row or not _verify_password(password, row["password_hash"]):
        raise PermissionError("用户名或密码错误")
    last_login = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _get_conn() as conn:
        conn.execute(
            "UPDATE users SET last_login = ? WHERE username = ?",
            (last_login, username),
        )
    return {
        "username": row["username"],
        "role": row["role"],
        "last_login": last_login,
    }

def list_users() -> List[Dict[str, str]]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT username, role, last_login FROM users ORDER BY username"
        ).fetchall()
        return [
            {"username": r["username"], "role": r["role"], "last_login": r["last_login"]}
            for r in rows
        ]

def create_user(username: str, password: str, role: str = "user") -> Dict[str, str]:
    if not username or not password:
        raise ValueError("用户名和密码必填")
    with _get_conn() as conn:
        existing = conn.execute(
            "SELECT username FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            raise FileExistsError("用户已存在")
        conn.execute(
            """
            INSERT INTO users (username, password_hash, role, last_login)
            VALUES (?, ?, ?, ?)
            """,
            (username, _hash_password(password), role, ""),
        )
    return {"username": username, "role": role, "last_login": ""}

def delete_user(username: str) -> None:
    if username == DEFAULT_ADMIN_USERNAME:
        raise PermissionError("无法删除超级管理员")
    with _get_conn() as conn:
        conn.execute("DELETE FROM users WHERE username = ?", (username,))

_init_db()
_import_legacy_json_history()
_ensure_default_admin()
