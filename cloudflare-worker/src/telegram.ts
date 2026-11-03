import type { TelegramMessage } from "./types";

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export class TelegramClient {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as TelegramEnvelope<T>;
    if (!response.ok || !data.ok || data.result === undefined) {
      throw new Error(`Telegram ${method} failed (${response.status}): ${data.description ?? "unknown error"}`);
    }
    return data.result;
  }

  sendMessage(
    chatId: number,
    text: string,
    threadId?: number,
    replyMarkup?: Record<string, unknown>,
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      message_thread_id: threadId,
      reply_markup: replyMarkup,
    });
  }

  editMessage(
    chatId: number,
    messageId: number,
    text: string,
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
    });
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.call<boolean>("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async downloadFile(
    fileId: string,
    maximumBytes: number,
  ): Promise<ArrayBuffer> {
    const file = await this.call<{ file_path?: string; file_size?: number }>("getFile", {
      file_id: fileId,
    });
    if (!file.file_path) throw new Error("Telegram did not return a file path");
    if (file.file_size && file.file_size > maximumBytes) {
      throw new Error("The supplied image exceeds the configured size limit");
    }
    const response = await fetch(
      `https://api.telegram.org/file/bot${this.token}/${file.file_path}`,
    );
    if (!response.ok) throw new Error(`Telegram file download failed (${response.status})`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maximumBytes) {
      throw new Error("The downloaded image exceeds the configured size limit");
    }
    return buffer;
  }
}
