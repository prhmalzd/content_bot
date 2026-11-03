# Cloudflare Worker version

Online version of the Telegram content assistant. Telegram sends updates to a
Worker webhook. A SQLite-backed Durable Object stores guided flows, drafts,
approved style examples, usage counters, and background generation jobs.

The Durable Object alarm performs slower AvalAI work after the webhook request
has been accepted. No laptop, VPN, D1 database ID, Queue, or persistent
container is required.

## Included behavior

- Guided `/createpost` content and optional-image flow.
- **No media** and **Cancel** inline buttons.
- Temporary loading message removed after generation.
- Drafts for Telegram, X, and Instagram.
- Natural-language draft revisions.
- `/final`, `/usage`, `/where`, `/brief`, `/cancel`, and `/help`.
- Optional chat restriction, output-topic routing, mentions, and hashtag trigger.
- Daily and monthly generation limits.
- Telegram update deduplication and a small persistent generation queue.

## Cloudflare build settings

Use these values when connecting the GitHub repository:

```text
Root directory:          cloudflare-worker
Build command:           npm run build
Deploy command:          npx wrangler deploy
Preview command:         npx wrangler preview
Enable preview builds:   Off
Cloudflare Access:       Off
Build variables:         (leave empty)
```

`wrangler.jsonc` currently names the Worker `telegram-content-bot`. The Worker
name in the Cloudflare dashboard must match. If your dashboard project uses a
different name, change the `name` field in `wrangler.jsonc` before pushing.

## Production secrets

After the first successful deployment, open **Worker > Settings > Variables &
Secrets** and add these as encrypted secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
AVALAI_API_KEY
```

Generate `TELEGRAM_WEBHOOK_SECRET` as a new random value containing only
letters, numbers, `_`, and `-`. It is separate from the Telegram bot token.
Never add any of these values to GitHub, `wrangler.jsonc`, build variables, a
screenshot, or a chat message.

The non-secret defaults live under `vars` in `wrangler.jsonc`. Before a later
push, you may set:

```text
BOT_USERNAME          bot username without @
ALLOWED_CHAT_ID       group ID, or blank during setup
CONTENT_TOPIC_ID      output topic ID, or blank to reply in the source topic
```

Keep `ALLOWED_CHAT_ID` blank initially. After registering the webhook, run
`/where` in Telegram, place the returned chat ID in `wrangler.jsonc`, and push
the change.

## Register the Telegram webhook

After the Worker is deployed and all three secrets are configured, register:

```text
Webhook URL: https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/telegram/webhook
Secret token: the exact TELEGRAM_WEBHOOK_SECRET value
Allowed updates: message, callback_query
```

Use Telegram's `setWebhook` Bot API method. Telegram must send the webhook
secret in the `X-Telegram-Bot-Api-Secret-Token` header; requests without the
matching value receive `401 Unauthorized`.

Opening the Worker's root URL returns a small health response. It reports
`ready` only after all required runtime secrets exist.

## Project brief

`src/PROJECT_BRIEF.md` is bundled into the Worker at deployment time. Edit and
push that file whenever the project's permanent facts or tone change.

Approved posts selected with `/final` are stored in the Durable Object and
survive Worker restarts and deployments.

## Local development

Dependencies are deliberately not committed:

```powershell
npm install
npm run check
npx wrangler dev
```

For local runtime testing, place secrets in `.dev.vars`. That file is ignored
by Git and must never be committed.
