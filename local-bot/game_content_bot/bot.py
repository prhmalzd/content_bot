from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Message, Update
from telegram.constants import ChatAction
from telegram.error import TelegramError
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from .ai import ContentAI, ImageInput
from .config import Settings
from .core import (
    build_source_text,
    contains_trigger,
    message_text,
    read_text,
    split_telegram_text,
    strip_trigger,
    validate_draft_shape,
)
from .store import DraftStore


LOGGER = logging.getLogger(__name__)

HELP_TEXT = """Game content assistant

Create a guided draft from any topic:
• /createpost — I ask for the content and then optional media
• /createpost followed by text — skip directly to the media question
• Mention me in a message or image caption
• Reply to an existing asset/update and mention me

Edit a draft:
• Reply to one of my generated messages with natural-language instructions

Other commands:
• /where — show the current chat and topic IDs
• /brief — confirm which local brief is loaded
• /usage — show local daily and monthly generation usage
• /final — reply to a draft to save it as an approved style example
• /cancel — cancel the active guided draft
• /help — show this message

Nothing is posted to social media automatically."""

FLOW_KEY = "createpost_flow"
AWAITING_CONTENT = "awaiting_content"
AWAITING_MEDIA = "awaiting_media"


class GameContentBot:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.store = DraftStore(settings.database_path)
        self.ai = ContentAI(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            base_url=settings.openai_base_url,
            api_mode=settings.ai_api_mode,
            max_output_tokens=settings.ai_max_output_tokens,
            image_detail=settings.ai_image_detail,
            max_retries=settings.ai_max_retries,
        )

    def build_application(self) -> Application:
        builder = ApplicationBuilder().token(self.settings.telegram_bot_token)
        if self.settings.telegram_proxy_url:
            builder = builder.proxy(
                self.settings.telegram_proxy_url
            ).get_updates_proxy(self.settings.telegram_proxy_url)
        application = builder.post_init(self._post_init).build()
        application.bot_data["service"] = self
        application.add_handler(CommandHandler("start", self.help_command))
        application.add_handler(CommandHandler("help", self.help_command))
        application.add_handler(CommandHandler("where", self.where_command))
        application.add_handler(CommandHandler("brief", self.brief_command))
        application.add_handler(CommandHandler("usage", self.usage_command))
        application.add_handler(CommandHandler("final", self.final_command))
        application.add_handler(CommandHandler("createpost", self.createpost_command))
        application.add_handler(CommandHandler("cancel", self.cancel_command))
        application.add_handler(
            CallbackQueryHandler(
                self.createpost_callback, pattern=r"^createpost:(no_media|cancel)$"
            )
        )
        application.add_handler(
            MessageHandler(
                filters.TEXT | filters.PHOTO | filters.Document.IMAGE,
                self.handle_message,
            )
        )
        application.add_error_handler(self.error_handler)
        return application

    async def _post_init(self, application: Application) -> None:
        me = await application.bot.get_me()
        LOGGER.info("Bot is running as @%s", me.username)

    def _chat_allowed(self, update: Update) -> bool:
        chat = update.effective_chat
        if chat is None:
            return False
        allowed = self.settings.allowed_chat_id
        return allowed is None or chat.id == allowed

    async def help_command(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        if not self._chat_allowed(update) or update.effective_message is None:
            return
        await update.effective_message.reply_text(HELP_TEXT)

    async def where_command(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        if update.effective_message is None or update.effective_chat is None:
            return
        topic_id = update.effective_message.message_thread_id
        await update.effective_message.reply_text(
            f"Chat ID: `{update.effective_chat.id}`\n"
            f"Topic ID: `{topic_id if topic_id is not None else 'none'}`",
            parse_mode="Markdown",
        )

    async def brief_command(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        if not self._chat_allowed(update) or update.effective_message is None:
            return
        brief = read_text(self.settings.project_brief_path)
        if not brief:
            await update.effective_message.reply_text(
                f"No brief found at {self.settings.project_brief_path}."
            )
            return
        await update.effective_message.reply_text(
            f"Loaded `{self.settings.project_brief_path}` ({len(brief)} characters). "
            "The file is read again for every draft.",
            parse_mode="Markdown",
        )

    def _usage_counts(self) -> tuple[int, int]:
        now = datetime.now(timezone.utc)
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = now.replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        return (
            self.store.count_generations_since(day_start),
            self.store.count_generations_since(month_start),
        )

    async def usage_command(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        if not self._chat_allowed(update) or update.effective_message is None:
            return
        daily, monthly = self._usage_counts()
        await update.effective_message.reply_text(
            "Local AI generation usage (UTC):\n"
            f"Today: {daily}/{self.settings.daily_generation_limit}\n"
            f"This month: {monthly}/{self.settings.monthly_generation_limit}\n"
            f"Maximum output: {self.settings.ai_max_output_tokens} tokens\n"
            f"Image detail: {self.settings.ai_image_detail}"
        )

    async def _check_usage_limit(self, message: Message) -> bool:
        daily, monthly = self._usage_counts()
        if daily >= self.settings.daily_generation_limit:
            await message.reply_text(
                "The local daily AI generation limit has been reached. Change "
                "DAILY_GENERATION_LIMIT in .env only if you intentionally want a "
                "higher budget."
            )
            return False
        if monthly >= self.settings.monthly_generation_limit:
            await message.reply_text(
                "The local monthly AI generation limit has been reached. Change "
                "MONTHLY_GENERATION_LIMIT in .env only if you intentionally want "
                "a higher budget."
            )
            return False
        return True

    async def final_command(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        message = update.effective_message
        chat = update.effective_chat
        if not self._chat_allowed(update) or message is None or chat is None:
            return
        if message.reply_to_message is None:
            await message.reply_text("Reply to one of my drafts with /final.")
            return
        stored = self.store.get(chat.id, message.reply_to_message.message_id)
        if stored is None:
            await message.reply_text("I could not find that draft in local history.")
            return
        draft, _ = stored
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.settings.approved_posts_path.open("a", encoding="utf-8") as file:
            file.write(f"\n\n## Approved {timestamp}\n\n{draft}\n")
        await message.reply_text(
            "Saved as an approved style example. Future drafts will use it."
        )

    async def createpost_command(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        message = update.effective_message
        chat = update.effective_chat
        if not self._chat_allowed(update) or message is None or chat is None:
            return
        if not await self._check_usage_limit(message):
            return

        current = strip_trigger(
            message_text(message),
            context.bot.username or "",
            self.settings.trigger_hashtags,
        )
        replied_text = message_text(message.reply_to_message)
        source = build_source_text(current, replied_text)
        context.user_data[FLOW_KEY] = {
            "chat_id": chat.id,
            "thread_id": message.message_thread_id,
            "state": AWAITING_MEDIA if source else AWAITING_CONTENT,
            "source": source,
        }

        if source:
            await self._ask_for_media(message)
        else:
            await message.reply_text(
                "What should the post be about? Send me the update or content as "
                "a text message.\n\nUse /cancel to stop."
            )

    async def cancel_command(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        message = update.effective_message
        if not self._chat_allowed(update) or message is None:
            return
        if context.user_data.pop(FLOW_KEY, None) is None:
            await message.reply_text("There is no active post creation flow.")
            return
        await message.reply_text("Post creation cancelled.")

    async def createpost_callback(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        query = update.callback_query
        if query is None:
            return
        await query.answer()
        message = query.message
        flow = context.user_data.get(FLOW_KEY)
        if (
            message is None
            or flow is None
            or flow.get("chat_id") != message.chat_id
            or flow.get("state") != AWAITING_MEDIA
        ):
            await query.edit_message_text(
                "This post request is no longer active. Start again with /createpost."
            )
            return

        if query.data == "createpost:cancel":
            context.user_data.pop(FLOW_KEY, None)
            await query.edit_message_text("Post creation cancelled.")
            return

        context.user_data.pop(FLOW_KEY, None)
        await query.edit_message_text("No media selected. Creating the drafts now…")
        await self._generate_draft(
            context=context,
            source_message=message,
            source=str(flow["source"]),
            images=[],
        )

    async def _ask_for_media(self, message: Message) -> None:
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("No media", callback_data="createpost:no_media")],
                [InlineKeyboardButton("Cancel", callback_data="createpost:cancel")],
            ]
        )
        await message.reply_text(
            "Now send one image for the post, or choose No media.",
            reply_markup=keyboard,
        )

    @staticmethod
    def _flow_matches(message: Message, flow: dict[str, object]) -> bool:
        return (
            flow.get("chat_id") == message.chat_id
            and flow.get("thread_id") == message.message_thread_id
        )

    async def handle_message(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        message = update.effective_message
        chat = update.effective_chat
        if not self._chat_allowed(update) or message is None or chat is None:
            return

        flow = context.user_data.get(FLOW_KEY)
        if flow is not None and self._flow_matches(message, flow):
            if flow.get("state") == AWAITING_CONTENT:
                content = message_text(message)
                if not content or message.photo or message.document:
                    await message.reply_text(
                        "Please send the content as text first, or use /cancel."
                    )
                    return
                flow["source"] = content
                flow["state"] = AWAITING_MEDIA
                await self._ask_for_media(message)
                return

            if flow.get("state") == AWAITING_MEDIA:
                if not message.photo and not (
                    message.document
                    and (message.document.mime_type or "").startswith("image/")
                ):
                    await message.reply_text(
                        "Please send one image, tap No media, or use /cancel."
                    )
                    return
                try:
                    image = await self._download_image(message)
                except Exception as exc:
                    LOGGER.exception("Image download failed")
                    await message.reply_text(
                        f"I could not read that image: {self._safe_error(exc)}"
                    )
                    return
                if image is None:
                    await message.reply_text("Please send a supported image file.")
                    return
                source = str(flow["source"])
                caption = message_text(message)
                if caption:
                    source += f"\n\nMedia caption:\n{caption}"
                context.user_data.pop(FLOW_KEY, None)
                await self._generate_draft(
                    context=context,
                    source_message=message,
                    source=source,
                    images=[image],
                )
                return

        bot_username = context.bot.username or ""
        raw_text = message_text(message)

        if contains_trigger(raw_text, bot_username, self.settings.trigger_hashtags):
            await self._create(update, context)
            return

        replied = message.reply_to_message
        if replied is not None and replied.from_user is not None:
            if replied.from_user.id == context.bot.id and raw_text:
                await self._revise(update, context)

    async def _create(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        message = update.effective_message
        chat = update.effective_chat
        assert message is not None and chat is not None

        if not await self._check_usage_limit(message):
            return

        current = strip_trigger(
            message_text(message),
            context.bot.username or "",
            self.settings.trigger_hashtags,
        )
        replied = message.reply_to_message
        source = build_source_text(current, message_text(replied))
        try:
            images = await self._collect_images(message, replied)
        except Exception as exc:
            LOGGER.exception("Image download failed")
            await message.reply_text(
                f"I could not read the attached image: {self._safe_error(exc)}"
            )
            return

        if not source and not images:
            await message.reply_text(
                "Please include an update, attach an image, or reply to an existing "
                "message when asking me to create a post."
            )
            return

        await self._generate_draft(
            context=context,
            source_message=message,
            source=source,
            images=images,
        )

    async def _generate_draft(
        self,
        context: ContextTypes.DEFAULT_TYPE,
        source_message: Message,
        source: str,
        images: list[ImageInput],
    ) -> None:
        if not await self._check_usage_limit(source_message):
            return

        project_brief = read_text(self.settings.project_brief_path)
        approved_posts = read_text(self.settings.approved_posts_path)[
            -self.settings.approved_posts_max_chars :
        ]
        if not project_brief:
            await source_message.reply_text(
                f"Project brief is missing: {self.settings.project_brief_path}"
            )
            return

        topic_id = source_message.message_thread_id
        loading: Message | None = None
        try:
            loading = await context.bot.send_message(
                chat_id=source_message.chat_id,
                message_thread_id=topic_id,
                text="⏳ Creating drafts for Telegram, X, and Instagram…",
            )
            draft = await self.ai.create_draft(
                source=source or "The supplied image is the only source material.",
                project_brief=project_brief,
                approved_posts=approved_posts,
                images=images,
            )

            if not validate_draft_shape(draft):
                LOGGER.warning(
                    "AI response did not include all required platform markers"
                )

            self.store.record_generation()
            await self._send_and_store(
                context=context,
                source_message=source_message,
                draft=draft,
                source=source,
            )
        except Exception as exc:  # Provider-specific exceptions vary.
            LOGGER.exception("Draft generation failed")
            await source_message.reply_text(
                f"I could not generate the draft: {self._safe_error(exc)}"
            )
        finally:
            if loading is not None:
                try:
                    await loading.delete()
                except TelegramError as exc:
                    LOGGER.warning(
                        "Could not remove loading message: %s",
                        exc.__class__.__name__,
                    )

    async def _revise(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        message = update.effective_message
        chat = update.effective_chat
        assert message is not None and chat is not None
        assert message.reply_to_message is not None

        if not await self._check_usage_limit(message):
            return

        stored = self.store.get(chat.id, message.reply_to_message.message_id)
        if stored is None:
            await message.reply_text(
                "I could not find the original draft. Create a new one with "
                "/createpost."
            )
            return

        draft, source = stored
        request = message_text(message)
        await self._send_typing(context, chat.id)
        try:
            revised = await self.ai.revise_draft(
                draft=draft,
                revision_request=request,
                source=source,
                project_brief=read_text(self.settings.project_brief_path),
                approved_posts=read_text(self.settings.approved_posts_path)[
                    -self.settings.approved_posts_max_chars :
                ],
            )
        except Exception as exc:
            LOGGER.exception("Draft revision failed")
            await message.reply_text(
                f"I could not revise the draft: {self._safe_error(exc)}"
            )
            return

        self.store.record_generation()

        await self._send_and_store(
            context=context,
            source_message=message,
            draft=revised,
            source=source,
        )

    async def _send_and_store(
        self,
        context: ContextTypes.DEFAULT_TYPE,
        source_message: Message,
        draft: str,
        source: str,
    ) -> None:
        chat_id = source_message.chat_id
        topic_id = self.settings.content_topic_id
        if topic_id is None:
            topic_id = source_message.message_thread_id

        for index, chunk in enumerate(split_telegram_text(draft)):
            prefix = "Draft package\n\n" if index == 0 else "Draft continued\n\n"
            sent = await context.bot.send_message(
                chat_id=chat_id,
                message_thread_id=topic_id,
                text=prefix + chunk,
            )
            self.store.save(chat_id, sent.message_id, draft, source)

    async def _collect_images(
        self, message: Message, replied: Message | None
    ) -> list[ImageInput]:
        images: list[ImageInput] = []
        for candidate in (replied, message):
            if candidate is None:
                continue
            image = await self._download_image(candidate)
            if image is not None:
                images.append(image)
        return images

    async def _download_image(self, message: Message) -> ImageInput | None:
        telegram_file = None
        mime_type = "image/jpeg"
        size = 0

        if message.photo:
            photo = message.photo[-1]
            size = photo.file_size or 0
            telegram_file = await photo.get_file()
        elif message.document and (message.document.mime_type or "").startswith("image/"):
            size = message.document.file_size or 0
            mime_type = message.document.mime_type or "image/jpeg"
            telegram_file = await message.document.get_file()

        if telegram_file is None:
            return None
        if size and size > self.settings.max_image_bytes:
            raise ValueError(
                f"Image is too large ({size} bytes); limit is "
                f"{self.settings.max_image_bytes} bytes"
            )

        data = bytes(await telegram_file.download_as_bytearray())
        if len(data) > self.settings.max_image_bytes:
            raise ValueError("Downloaded image exceeds MAX_IMAGE_BYTES")
        return ImageInput(data=data, mime_type=mime_type)

    @staticmethod
    async def _send_typing(
        context: ContextTypes.DEFAULT_TYPE, chat_id: int
    ) -> None:
        """Send the cosmetic typing action without blocking content generation."""
        try:
            await context.bot.send_chat_action(
                chat_id=chat_id, action=ChatAction.TYPING
            )
        except TelegramError as exc:
            LOGGER.warning("Could not send typing indicator: %s", exc.__class__.__name__)

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        text = re.sub(r"sk-[A-Za-z0-9_-]+", "[redacted-key]", str(exc))
        return text[:500] or exc.__class__.__name__

    async def error_handler(
        self, update: object, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        LOGGER.exception("Unhandled Telegram update error", exc_info=context.error)


def create_application(settings: Settings) -> Application:
    return GameContentBot(settings).build_application()

