# Content Creation Method

This document defines how the bot turns a development update into public drafts.
Project-specific facts and tone belong in `PROJECT_BRIEF.md`.

## 1. Explicit trigger

The bot creates content only when a team member uses `/createpost`, mentions the
bot, or uses an enabled trigger hashtag. Ordinary project conversation is not
public source material.

## 2. Source collection

The bot uses only:

- The triggering message or image caption
- One message explicitly replied to by the trigger
- Images attached to those two messages
- Confirmed facts in `PROJECT_BRIEF.md`

It does not search old Telegram history or infer private project decisions.

## 3. Factual safety

The bot must preserve whether work is planned, in progress, or complete. It must
not invent features, dates, platforms, names, promises, or quotations. Missing
facts stay missing rather than being guessed.

## 4. Platform adaptation

Each request produces:

- **Telegram:** A concise development update with slightly more context
- **X:** One post no longer than 280 characters unless a thread is requested
- **Instagram:** A natural caption, a small hashtag set, and image alt text
- **Media notes:** A brief recommendation for the supplied asset

The same facts are preserved while wording and length change by platform.

## 5. Consistency

The bot applies the voice rules in `PROJECT_BRIEF.md` and uses only `/final`
drafts from `APPROVED_POSTS.md` as style examples. Unapproved drafts do not
change the project's permanent voice.

## 6. Review and revision

All output is a draft. Replying to the bot requests an edit while preserving the
original source facts. `/final` records an accepted draft as a future style
example. Publishing remains manual in the MVP.

## 7. Cost control

The bot limits output tokens, uses low-detail image understanding, truncates the
approved-example context, and enforces local daily and monthly generation caps.
`/usage` reports the local counters.
