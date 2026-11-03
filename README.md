# Telegram Game Content Bot

Repository for the Telegram content assistant used by a small 2D game team.
It creates manual-copy drafts for Telegram, X, and Instagram using AvalAI.

## Repository layout

- `local-bot/` — the working Python laptop version that uses Telegram long polling.
- `cloudflare-worker/` — deployable online webhook version for Cloudflare
  Workers and a SQLite-backed Durable Object.

The Python version is preserved and can still be run locally. It cannot be
deployed directly as a Cloudflare Worker because it relies on a continuously
running process, local files, and local SQLite storage.

## Security

Real `.env` files, Cloudflare `.dev.vars`, virtual environments, SQLite files,
logs, and Wrangler state are ignored. Never commit Telegram or AvalAI keys.
Configure production credentials later through Cloudflare Secrets.

## Local version

See [`local-bot/README.md`](local-bot/README.md) for setup and usage.

## Cloudflare version

See [`cloudflare-worker/README.md`](cloudflare-worker/README.md). The online
implementation is independent from the laptop version.
