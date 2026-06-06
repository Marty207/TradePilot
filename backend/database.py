import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(os.getenv("DATABASE_PATH", Path(__file__).parent / "tradepilot.db"))

ANALYSES_PER_MONTH = int(os.getenv("ANALYSES_PER_MONTH", "200"))


def _month_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                plan TEXT NOT NULL DEFAULT 'free',
                stripe_customer_id TEXT,
                subscription_status TEXT NOT NULL DEFAULT 'inactive',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS usage (
                user_id INTEGER NOT NULL,
                month_key TEXT NOT NULL,
                analyses_count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, month_key),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            """
        )


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def get_user_by_email(email: str):
    with get_db() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE email = ?",
            (email.lower().strip(),),
        ).fetchone()


def get_user_by_id(user_id: int):
    with get_db() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def create_user(email: str, password_hash: str):
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO users (email, password_hash, created_at)
            VALUES (?, ?, ?)
            """,
            (email.lower().strip(), password_hash, now),
        )
        return cursor.lastrowid


def get_usage_count(user_id: int, month_key: str | None = None) -> int:
    key = month_key or _month_key()
    with get_db() as conn:
        row = conn.execute(
            "SELECT analyses_count FROM usage WHERE user_id = ? AND month_key = ?",
            (user_id, key),
        ).fetchone()
        return int(row["analyses_count"]) if row else 0


def increment_usage(user_id: int) -> int:
    key = _month_key()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO usage (user_id, month_key, analyses_count)
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, month_key)
            DO UPDATE SET analyses_count = analyses_count + 1
            """,
            (user_id, key),
        )
        row = conn.execute(
            "SELECT analyses_count FROM usage WHERE user_id = ? AND month_key = ?",
            (user_id, key),
        ).fetchone()
        return int(row["analyses_count"])


def analyses_limit_for_user(user: sqlite3.Row) -> int:
    if user["subscription_status"] == "active":
        return ANALYSES_PER_MONTH
    return 0


def user_access_payload(user: sqlite3.Row) -> dict:
    used = get_usage_count(user["id"])
    limit = analyses_limit_for_user(user)
    return {
        "id": user["id"],
        "email": user["email"],
        "plan": user["plan"],
        "subscription_status": user["subscription_status"],
        "analyses_used": used,
        "analyses_limit": limit,
        "analyses_remaining": max(0, limit - used),
        "can_analyze": used < limit,
    }


def set_stripe_customer(user_id: int, customer_id: str) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET stripe_customer_id = ? WHERE id = ?",
            (customer_id, user_id),
        )


def activate_pro_subscription(user_id: int) -> None:
    with get_db() as conn:
        conn.execute(
            """
            UPDATE users
            SET plan = 'pro', subscription_status = 'active'
            WHERE id = ?
            """,
            (user_id,),
        )


def deactivate_subscription(user_id: int) -> None:
    with get_db() as conn:
        conn.execute(
            """
            UPDATE users
            SET plan = 'free', subscription_status = 'inactive'
            WHERE id = ?
            """,
            (user_id,),
        )


def get_user_by_stripe_customer(customer_id: str):
    with get_db() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE stripe_customer_id = ?",
            (customer_id,),
        ).fetchone()
