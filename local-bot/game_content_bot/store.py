from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path


class DraftStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS drafts (
                        chat_id INTEGER NOT NULL,
                        message_id INTEGER NOT NULL,
                        draft TEXT NOT NULL,
                        source TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (chat_id, message_id)
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS usage_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )

    def save(self, chat_id: int, message_id: int, draft: str, source: str) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT OR REPLACE INTO drafts (chat_id, message_id, draft, source)
                    VALUES (?, ?, ?, ?)
                    """,
                    (chat_id, message_id, draft, source),
                )

    def get(self, chat_id: int, message_id: int) -> tuple[str, str] | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT draft, source FROM drafts WHERE chat_id = ? AND message_id = ?",
                (chat_id, message_id),
            ).fetchone()
        if row is None:
            return None
        return str(row[0]), str(row[1])

    def record_generation(self) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("INSERT INTO usage_events DEFAULT VALUES")

    def count_generations_since(self, since: datetime) -> int:
        timestamp = since.strftime("%Y-%m-%d %H:%M:%S")
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT COUNT(*) FROM usage_events WHERE created_at >= ?",
                (timestamp,),
            ).fetchone()
        return int(row[0]) if row else 0

