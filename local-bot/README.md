# Local Game Content Bot

A locally hosted Telegram assistant for a small game-development team. Mention
the bot or use `/createpost` from any group topic; it produces separate drafts
for Telegram, X, and Instagram in a dedicated content topic. Publishing remains
manual.

## What it does

- Runs on your laptop using Telegram long polling—no domain or cloud server.
- Accepts text, Telegram photos, and image documents.
- Uses `PROJECT_BRIEF.md` on every request to keep facts and tone consistent.
- Sends drafts to a configured Content Assistant topic.
- Revises a draft when you reply to the bot in natural language.
- Saves drafts marked with `/final` as future style examples.
- Stores draft history locally in SQLite so revisions survive restarts.

It does not publish to social networks, read old Telegram history, or silently
turn ordinary group conversations into public content.

## Setup

Requirements: Python 3.10 or newer, a Telegram bot token, and an AvalAI API key.

1. Create a Telegram bot with `@BotFather`.
2. Add it to your forum-enabled Telegram group.
3. Create a topic named **Content Assistant**.
4. Create a virtual environment and install dependencies:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

5. Copy `.env.example` to `.env` and set at least:

   ```dotenv
   TELEGRAM_BOT_TOKEN=...
   AVALAI_API_KEY=...
   OPENAI_MODEL=gpt-6-luna
   OPENAI_BASE_URL=https://api.avalai.ir/v1
   AI_API_MODE=responses
   ```

6. Edit `PROJECT_BRIEF.md` with confirmed information about the game.
7. Start the bot:

   ```powershell
   python run_bot.py
   ```

8. Run `/where` once in the group and once inside the Content Assistant topic.
   Put the returned values into `.env` as `ALLOWED_CHAT_ID` and
   `CONTENT_TOPIC_ID`, then restart the bot.

`ALLOWED_CHAT_ID` may initially be blank so `/where` works during setup. Set it
afterward so the bot cannot operate in another group if accidentally added.

## Telegram permissions

Admin access is not required when you invoke the bot with `/createpost` or an
`@mention`. If you want a bare `#createpost` hashtag to trigger it without a
mention, Telegram must send ordinary messages to the bot; make it an admin with
minimal permissions or adjust its privacy setting with BotFather.

The bot never needs permission to delete messages, manage users, or publish to
your social accounts.

### Networks where Telegram is blocked

If a system-wide VPN is active, no additional configuration is usually needed.
Otherwise, set the local HTTP or SOCKS5 address exposed by your proxy application:

```dotenv
TELEGRAM_PROXY_URL=socks5://127.0.0.1:1080
```

HTTP proxy example: `http://127.0.0.1:7890`. The bot applies this proxy to both
ordinary Bot API requests and long polling. Leave the value empty for a direct
connection.

## Usage

From any project topic:

```text
/createpost
```

The bot asks for the content first. Send the update as a text message. It then
asks for one optional image; send the image or tap **No media**. While the AI is
working, the bot shows a temporary loading message and removes it after the
draft package is delivered. Use `/cancel` at either question to stop.

You can also prefill the first step with
`/createpost We finished the first inventory prototype.`

You can also mention the bot in a photo caption, or reply to an existing asset
or update and mention it. Temporary style tags such as `#playful`, `#short`, and
`#devlog` are passed to the model as directions. They do not alter the permanent
project brief.

To revise, reply to a generated draft:

```text
Make the Instagram caption less promotional and mention that the UI is temporary.
```

Reply to a generated draft with `/final` to append it to `APPROVED_POSTS.md`.
Future drafts use approved posts as style references.

## AvalAI configuration

The default configuration follows the AvalAI quickstart:

- OpenAI-compatible Python SDK
- Base URL `https://api.avalai.ir/v1`
- Responses API
- `gpt-6-luna`, a low-cost text-and-image model suitable for draft generation
  and understanding attached game assets

Create an API key in the AvalAI developer dashboard and store it only as
`AVALAI_API_KEY` in `.env`. Never place the key in source code or Telegram.

## Other AI providers

Another OpenAI-compatible endpoint can be configured with `OPENAI_BASE_URL` and
`OPENAI_API_KEY`. If a provider supports Chat Completions but not Responses, set:

```dotenv
AI_API_MODE=chat_completions
```

The selected model must support image input to analyze attached assets. Provider
compatibility varies; a service offering models through a website but no API
cannot be connected to this bot.

## Usage and cost safeguards

The default configuration limits successful AI generations to 30 per UTC day
and 300 per UTC month. A revision is a new AI request and counts as one
generation. Each response is capped at 900 output tokens, image analysis uses
low detail, and only the latest 12,000 characters of approved examples are sent.

Use `/usage` in Telegram to see the counters. These local limits prevent normal
bot usage from accidentally consuming the full AvalAI balance; AvalAI's own
account and model rate limits still apply independently.

## Current MVP limits

- It processes the trigger message plus one replied-to message.
- It accepts at most one image from each of those messages.
- Telegram albums are not collected as a single batch yet.
- It cannot retrieve messages sent before the bot joined the group.
- The laptop must remain awake with the program running.

## Tests

The unit tests do not call Telegram or an AI API:

```powershell
python -m unittest discover -s tests -v
```

