# Cloudflare Worker version

This directory is reserved for the online implementation using:

- a Telegram webhook instead of long polling;
- Cloudflare Queues for AvalAI generation jobs;
- Cloudflare D1 for flows, drafts, usage counters, and approved examples;
- Cloudflare Secrets for the Telegram token, webhook secret, and AvalAI key.

The Cloudflare implementation has not been generated yet. Connecting this
repository to Workers Builds before `wrangler.jsonc`, `package.json`, and the
Worker source exist will not deploy the bot.

Do not copy the laptop `.env` file into this directory.
