import { BotState } from "./bot-state";
import type { Env, TelegramUpdate } from "./types";

export { BotState };

function missingSecrets(env: Env): string[] {
  return [
    ["TELEGRAM_BOT_TOKEN", env.TELEGRAM_BOT_TOKEN],
    ["TELEGRAM_WEBHOOK_SECRET", env.TELEGRAM_WEBHOOK_SECRET],
    ["AVALAI_API_KEY", env.AVALAI_API_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      const missing = missingSecrets(env);
      return Response.json({
        service: "telegram-content-bot",
        status: missing.length === 0 ? "ready" : "configuration-required",
        missing_secrets: missing,
      });
    }

    if (request.method !== "POST" || url.pathname !== "/telegram/webhook") {
      return new Response("Not found", { status: 404 });
    }

    if (
      !env.TELEGRAM_WEBHOOK_SECRET ||
      request.headers.get("x-telegram-bot-api-secret-token") !==
        env.TELEGRAM_WEBHOOK_SECRET
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (!env.TELEGRAM_BOT_TOKEN || !env.AVALAI_API_KEY) {
      return new Response("Worker secrets are not configured", { status: 503 });
    }

    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
      if (!Number.isInteger(update.update_id)) throw new Error("Invalid update");
    } catch {
      return new Response("Invalid Telegram update", { status: 400 });
    }

    const id = env.BOT_STATE.idFromName("telegram-content-bot-singleton");
    const stub = env.BOT_STATE.get(id);
    return stub.fetch("https://bot-state.internal/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    });
  },
} satisfies ExportedHandler<Env>;
