from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from game_content_bot.core import (
    build_source_text,
    contains_trigger,
    split_telegram_text,
    strip_trigger,
    validate_draft_shape,
)
from game_content_bot.store import DraftStore


class TriggerTests(unittest.TestCase):
    def test_command_triggers(self) -> None:
        self.assertTrue(contains_trigger("/createpost hello", "GameBot", ()))
        self.assertTrue(contains_trigger("/createpost@GameBot hello", "GameBot", ()))

    def test_mention_triggers(self) -> None:
        self.assertTrue(contains_trigger("please help @GameBot", "GameBot", ()))

    def test_hashtag_triggers_case_insensitively(self) -> None:
        self.assertTrue(
            contains_trigger("Update #CreatePost", "GameBot", ("#createpost",))
        )

    def test_non_trigger_is_ignored(self) -> None:
        self.assertFalse(contains_trigger("ordinary chat", "GameBot", ("#createpost",)))

    def test_trigger_is_removed(self) -> None:
        cleaned = strip_trigger(
            "/createpost @GameBot Finished the inventory #createpost",
            "GameBot",
            ("#createpost",),
        )
        self.assertEqual(cleaned, "Finished the inventory")


class FormattingTests(unittest.TestCase):
    def test_source_combines_reply_and_current(self) -> None:
        source = build_source_text("make a post", "animation finished")
        self.assertIn("animation finished", source)
        self.assertIn("make a post", source)

    def test_required_sections(self) -> None:
        draft = "[TELEGRAM]\na\n[X]\nb\n[INSTAGRAM]\nc"
        self.assertTrue(validate_draft_shape(draft))
        self.assertFalse(validate_draft_shape("[TELEGRAM]\na"))

    def test_long_messages_are_split_without_data_loss(self) -> None:
        text = ("paragraph one\n\n" * 50).strip()
        chunks = split_telegram_text(text, limit=100)
        self.assertGreater(len(chunks), 1)
        self.assertEqual("\n\n".join(chunks).replace("\n\n\n\n", "\n\n"), text)
        self.assertTrue(all(len(chunk) <= 100 for chunk in chunks))


class UsageStoreTests(unittest.TestCase):
    def test_generation_events_are_counted(self) -> None:
        with TemporaryDirectory() as directory:
            store = DraftStore(Path(directory) / "state.sqlite3")
            before = datetime.now(timezone.utc).replace(microsecond=0)
            store.record_generation()
            self.assertEqual(store.count_generations_since(before), 1)


if __name__ == "__main__":
    unittest.main()

