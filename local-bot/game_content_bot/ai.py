from __future__ import annotations

import base64
from dataclasses import dataclass

from openai import AsyncOpenAI


SYSTEM_RULES = """
You create truthful social-media drafts for a small independent game-development
team. The project brief is authoritative. Never invent a feature, completion
status, platform, character name, date, quote, or promise. If important context is
missing, write a cautious draft that does not fill the gap with an assumption.

Return exactly these sections:

[TELEGRAM]
A polished Telegram channel post.

[X]
One post of at most 280 characters, including hashtags. Do not make a thread
unless the user explicitly asks for one.

[INSTAGRAM]
A natural caption followed by a small set of relevant hashtags, then a line
starting with "Alt text:".

[MEDIA NOTES]
One short recommendation about which supplied image to use. If no image was
supplied, say that no media was supplied. Do not claim to have created an image.

Keep the entire response concise enough for Telegram. Do not include commentary
outside these sections.
""".strip()


@dataclass(frozen=True)
class ImageInput:
    data: bytes
    mime_type: str

    def data_url(self) -> str:
        encoded = base64.b64encode(self.data).decode("ascii")
        return f"data:{self.mime_type};base64,{encoded}"


class ContentAI:
    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str | None = None,
        api_mode: str = "responses",
        max_output_tokens: int = 900,
        image_detail: str = "low",
        max_retries: int = 3,
    ) -> None:
        kwargs: dict[str, str] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        self.client = AsyncOpenAI(**kwargs, max_retries=max_retries)
        self.model = model
        self.api_mode = api_mode
        self.max_output_tokens = max_output_tokens
        self.image_detail = image_detail

    @staticmethod
    def _instructions(project_brief: str, approved_posts: str) -> str:
        examples = approved_posts.strip() or "No approved examples yet."
        return (
            f"{SYSTEM_RULES}\n\n"
            f"PROJECT BRIEF\n{project_brief}\n\n"
            f"APPROVED STYLE EXAMPLES\n{examples}"
        )

    async def create_draft(
        self,
        source: str,
        project_brief: str,
        approved_posts: str,
        images: list[ImageInput],
    ) -> str:
        prompt = (
            "Create the three platform drafts from this team update. Preserve "
            f"uncertainty and development status exactly.\n\n{source}"
        )
        return await self._generate(
            prompt=prompt,
            instructions=self._instructions(project_brief, approved_posts),
            images=images,
        )

    async def revise_draft(
        self,
        draft: str,
        revision_request: str,
        source: str,
        project_brief: str,
        approved_posts: str,
    ) -> str:
        prompt = (
            "Revise the existing draft according to the request. Keep all four "
            "required section markers, preserve the source facts, and change only "
            "what was requested.\n\n"
            f"SOURCE\n{source}\n\n"
            f"EXISTING DRAFT\n{draft}\n\n"
            f"REVISION REQUEST\n{revision_request}"
        )
        return await self._generate(
            prompt=prompt,
            instructions=self._instructions(project_brief, approved_posts),
            images=[],
        )

    async def _generate(
        self,
        prompt: str,
        instructions: str,
        images: list[ImageInput],
    ) -> str:
        if self.api_mode == "chat_completions":
            content: list[dict[str, object]] = [{"type": "text", "text": prompt}]
            content.extend(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image.data_url(),
                        "detail": self.image_detail,
                    },
                }
                for image in images
            )
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "developer", "content": instructions},
                    {"role": "user", "content": content},
                ],
                max_completion_tokens=self.max_output_tokens,
            )
            result = response.choices[0].message.content or ""
        else:
            content = [{"type": "input_text", "text": prompt}]
            content.extend(
                {
                    "type": "input_image",
                    "image_url": image.data_url(),
                    "detail": self.image_detail,
                }
                for image in images
            )
            response = await self.client.responses.create(
                model=self.model,
                instructions=instructions,
                input=[{"role": "user", "content": content}],
                store=False,
                max_output_tokens=self.max_output_tokens,
            )
            result = response.output_text

        result = result.strip()
        if not result:
            raise RuntimeError("The AI provider returned an empty response")
        return result

