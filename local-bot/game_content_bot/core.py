from __future__ import annotations

import re
from pathlib import Path


PLATFORM_MARKERS = ("[TELEGRAM]", "[X]", "[INSTAGRAM]", "[MEDIA NOTES]")


def message_text(message: object | None) -> str:
    if message is None:
        return ""
    text = getattr(message, "text", None) or getattr(message, "caption", None)
    return (text or "").strip()


def contains_trigger(
    text: str,
    bot_username: str,
    hashtags: tuple[str, ...],
) -> bool:
    lowered = text.lower()
    username = bot_username.lower().lstrip("@")
    command_pattern = rf"(?:^|\s)/createpost(?:@{re.escape(username)})?(?:\s|$)"
    if re.search(command_pattern, lowered):
        return True
    if f"@{username}" in lowered:
        return True
    return any(tag and tag in lowered.split() for tag in hashtags)


def strip_trigger(text: str, bot_username: str, hashtags: tuple[str, ...]) -> str:
    username = bot_username.lstrip("@")
    cleaned = re.sub(
        rf"(?:^|\s)/createpost(?:@{re.escape(username)})?(?=\s|$)",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        rf"@{re.escape(username)}\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    for hashtag in hashtags:
        cleaned = re.sub(
            rf"(?<!\S){re.escape(hashtag)}(?!\S)",
            " ",
            cleaned,
            flags=re.IGNORECASE,
        )
    return re.sub(r"[ \t]+", " ", cleaned).strip()


def build_source_text(current_text: str, replied_text: str) -> str:
    parts: list[str] = []
    if replied_text:
        parts.append(f"Referenced message:\n{replied_text}")
    if current_text:
        parts.append(f"Current instruction or update:\n{current_text}")
    return "\n\n".join(parts).strip()


def read_text(path: Path, fallback: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return fallback


def validate_draft_shape(draft: str) -> bool:
    return all(marker in draft for marker in PLATFORM_MARKERS[:3])


def split_telegram_text(text: str, limit: int = 3900) -> list[str]:
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    remaining = text.strip()
    while len(remaining) > limit:
        split_at = remaining.rfind("\n\n", 0, limit)
        if split_at < limit // 2:
            split_at = remaining.rfind("\n", 0, limit)
        if split_at < limit // 2:
            split_at = remaining.rfind(" ", 0, limit)
        if split_at <= 0:
            split_at = limit
        chunks.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks

