from __future__ import annotations

import logging

from telegram import Update

from game_content_bot.bot import create_application
from game_content_bot.config import Settings


def main() -> None:
    logging.basicConfig(
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        level=logging.INFO,
    )
    # httpx logs full request URLs at INFO level. Telegram embeds the bot token
    # in those URLs, so keep transport logs quiet to avoid leaking credentials.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    settings = Settings.load()
    application = create_application(settings)
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()

