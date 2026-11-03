from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _optional_int(name: str) -> int | None:
    value = os.getenv(name, "").strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    telegram_proxy_url: str | None
    openai_api_key: str
    openai_model: str
    openai_base_url: str | None
    ai_api_mode: str
    ai_max_output_tokens: int
    ai_image_detail: str
    ai_max_retries: int
    daily_generation_limit: int
    monthly_generation_limit: int
    approved_posts_max_chars: int
    allowed_chat_id: int | None
    content_topic_id: int | None
    project_brief_path: Path
    approved_posts_path: Path
    database_path: Path
    trigger_hashtags: tuple[str, ...]
    max_image_bytes: int

    @classmethod
    def load(cls) -> "Settings":
        load_dotenv()

        telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        # AvalAI's documentation names this AVALAI_API_KEY. OPENAI_API_KEY is
        # retained as a fallback for direct OpenAI and other compatible APIs.
        api_key = (
            os.getenv("AVALAI_API_KEY", "").strip()
            or os.getenv("OPENAI_API_KEY", "").strip()
        )
        if not telegram_token:
            raise ValueError("TELEGRAM_BOT_TOKEN is required")
        if not api_key:
            raise ValueError("AVALAI_API_KEY (or OPENAI_API_KEY) is required")

        api_mode = os.getenv("AI_API_MODE", "responses").strip().lower()
        if api_mode not in {"responses", "chat_completions"}:
            raise ValueError("AI_API_MODE must be 'responses' or 'chat_completions'")

        image_detail = os.getenv("AI_IMAGE_DETAIL", "low").strip().lower()
        if image_detail not in {"low", "auto", "high"}:
            raise ValueError("AI_IMAGE_DETAIL must be 'low', 'auto', or 'high'")

        def positive_int(name: str, default: str) -> int:
            try:
                value = int(os.getenv(name, default))
            except ValueError as exc:
                raise ValueError(f"{name} must be an integer") from exc
            if value <= 0:
                raise ValueError(f"{name} must be greater than zero")
            return value

        raw_hashtags = os.getenv("CONTENT_TRIGGER_HASHTAGS", "#createpost")
        hashtags = tuple(
            item.strip().lower()
            for item in raw_hashtags.split(",")
            if item.strip()
        )

        try:
            max_image_bytes = int(os.getenv("MAX_IMAGE_BYTES", "10485760"))
        except ValueError as exc:
            raise ValueError("MAX_IMAGE_BYTES must be an integer") from exc

        base_url = os.getenv("OPENAI_BASE_URL", "").strip() or None

        return cls(
            telegram_bot_token=telegram_token,
            telegram_proxy_url=os.getenv("TELEGRAM_PROXY_URL", "").strip() or None,
            openai_api_key=api_key,
            openai_model=os.getenv("OPENAI_MODEL", "gpt-6-luna").strip(),
            openai_base_url=base_url,
            ai_api_mode=api_mode,
            ai_max_output_tokens=positive_int("AI_MAX_OUTPUT_TOKENS", "900"),
            ai_image_detail=image_detail,
            ai_max_retries=positive_int("AI_MAX_RETRIES", "3"),
            daily_generation_limit=positive_int("DAILY_GENERATION_LIMIT", "30"),
            monthly_generation_limit=positive_int(
                "MONTHLY_GENERATION_LIMIT", "300"
            ),
            approved_posts_max_chars=positive_int(
                "APPROVED_POSTS_MAX_CHARS", "12000"
            ),
            allowed_chat_id=_optional_int("ALLOWED_CHAT_ID"),
            content_topic_id=_optional_int("CONTENT_TOPIC_ID"),
            project_brief_path=Path(
                os.getenv("PROJECT_BRIEF_PATH", "PROJECT_BRIEF.md")
            ),
            approved_posts_path=Path(
                os.getenv("APPROVED_POSTS_PATH", "APPROVED_POSTS.md")
            ),
            database_path=Path(
                os.getenv("BOT_DATABASE_PATH", "bot_state.sqlite3")
            ),
            trigger_hashtags=hashtags,
            max_image_bytes=max_image_bytes,
        )

