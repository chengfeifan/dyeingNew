from __future__ import annotations
import json
import os
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional, Tuple, List

# 简单的文件型用户存储，方便在容器卷中持久化
STORE_DIR = Path(os.environ.get("HISTORY_DIR", Path.cwd() / "spectra_history"))
USER_STORE = Path(os.environ.get("USER_STORE", STORE_DIR / "users.json"))
SESSION_TTL_MINUTES = int(os.environ.get("SESSION_TTL_MINUTES", "60"))

DEFAULT_USERS = [
    {"username": "admin", "password": "admin123", "role": "admin"},
    {"username": "operator", "password": "operator123", "role": "user"},
]

SESSIONS: Dict[str, dict] = {}


def _now() -> datetime:
    return datetime.utcnow()


def _persist_users(users: Dict[str, dict]) -> None:
    USER_STORE.parent.mkdir(parents=True, exist_ok=True)
    with open(USER_STORE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def _load_users() -> Dict[str, dict]:
    if not USER_STORE.exists():
        seed_users = {u["username"]: {**u, "last_login": ""} for u in DEFAULT_USERS}
        _persist_users(seed_users)
        return seed_users
    with open(USER_STORE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_last_login(username: str, ts: datetime) -> None:
    users = _load_users()
    if username in users:
        users[username]["last_login"] = ts.strftime("%Y-%m-%d %H:%M:%S")
        _persist_users(users)


def list_users() -> List[dict]:
    users = _load_users()
    return [
        {
            "username": u["username"],
            "role": u.get("role", "user"),
            "last_login": u.get("last_login", ""),
        }
        for u in users.values()
    ]


def create_user(username: str, password: str, role: str = "user") -> dict:
    users = _load_users()
    if username in users:
        raise ValueError("用户已存在")
    users[username] = {
        "username": username,
        "password": password,
        "role": role,
        "last_login": "",
    }
    _persist_users(users)
    return {"username": username, "role": role, "last_login": ""}


def update_user(username: str, *, password: Optional[str] = None, role: Optional[str] = None) -> dict:
    users = _load_users()
    if username not in users:
        raise ValueError("用户不存在")
    if password:
        users[username]["password"] = password
    if role:
        users[username]["role"] = role
    _persist_users(users)
    u = users[username]
    return {"username": u["username"], "role": u.get("role", "user"), "last_login": u.get("last_login", "")}


def delete_user(username: str) -> None:
    users = _load_users()
    if username not in users:
        return
    users.pop(username, None)
    _persist_users(users)


def validate_credentials(username: str, password: str) -> Optional[dict]:
    users = _load_users()
    u = users.get(username)
    if not u:
        return None
    if u.get("password") != password:
        return None
    return {"username": u["username"], "role": u.get("role", "user"), "last_login": u.get("last_login", "")}


def _cleanup_sessions() -> None:
    now = _now()
    expired = [token for token, s in SESSIONS.items() if s["expires_at"] <= now]
    for t in expired:
        SESSIONS.pop(t, None)


def create_session(user: dict) -> Tuple[str, dict]:
    _cleanup_sessions()
    token = secrets.token_urlsafe(32)
    now = _now()
    session = {
        "username": user["username"],
        "role": user.get("role", "user"),
        "last_login": user.get("last_login", ""),
        "last_activity": now,
        "expires_at": now + timedelta(minutes=SESSION_TTL_MINUTES),
    }
    SESSIONS[token] = session
    _save_last_login(user["username"], now)
    return token, {
        "username": session["username"],
        "role": session["role"],
        "lastLogin": session["last_login"] or now.strftime("%Y-%m-%d %H:%M:%S"),
    }


def get_session(token: str) -> Optional[dict]:
    if not token:
        return None
    _cleanup_sessions()
    sess = SESSIONS.get(token)
    if not sess:
        return None
    if sess["expires_at"] <= _now():
        SESSIONS.pop(token, None)
        return None
    return sess


def touch_session(token: str) -> Optional[dict]:
    sess = get_session(token)
    if not sess:
        return None
    now = _now()
    sess["last_activity"] = now
    sess["expires_at"] = now + timedelta(minutes=SESSION_TTL_MINUTES)
    return sess


def drop_session(token: str) -> None:
    SESSIONS.pop(token, None)

