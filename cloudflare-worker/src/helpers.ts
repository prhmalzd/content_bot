import type { MediaReference, TelegramMessage } from "./types";

export function messageText(message?: TelegramMessage): string {
  return (message?.text ?? message?.caption ?? "").trim();
}

export function optionalInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function flowKey(chatId: number, userId: number): string {
  return `flow:${chatId}:${userId}`;
}

export function draftKey(chatId: number, messageId: number): string {
  return `draft:${chatId}:${messageId}`;
}

export function sameTopic(message: TelegramMessage, threadId?: number): boolean {
  return message.message_thread_id === threadId;
}

export function extractMedia(message?: TelegramMessage): MediaReference | undefined {
  if (!message) return undefined;
  const photo = message.photo?.at(-1);
  if (photo) {
    return {
      fileId: photo.file_id,
      mimeType: "image/jpeg",
      size: photo.file_size,
    };
  }
  const document = message.document;
  if (document?.mime_type?.startsWith("image/")) {
    return {
      fileId: document.file_id,
      mimeType: document.mime_type,
      size: document.file_size,
    };
  }
  return undefined;
}

export function buildSource(current: string, replied: string): string {
  const parts: string[] = [];
  if (replied) parts.push(`Referenced message:\n${replied}`);
  if (current) parts.push(`Current instruction or update:\n${current}`);
  return parts.join("\n\n").trim();
}

export function stripCreateCommand(text: string): string {
  return text
    .replace(/^\/createpost(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i, "")
    .trim();
}

export function commandName(text: string): string | undefined {
  const match = text.match(/^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/);
  return match?.[1]?.toLowerCase();
}

export function hasQuickTrigger(
  text: string,
  botUsername: string,
  hashtag: string,
): boolean {
  const lowered = text.toLowerCase();
  const username = botUsername.trim().toLowerCase().replace(/^@/, "");
  if (username && lowered.includes(`@${username}`)) return true;
  return Boolean(hashtag) && lowered.split(/\s+/).includes(hashtag.toLowerCase());
}

export function stripQuickTrigger(
  text: string,
  botUsername: string,
  hashtag: string,
): string {
  let result = text;
  const username = botUsername.trim().replace(/^@/, "");
  if (username) {
    result = result.replace(new RegExp(`@${escapeRegExp(username)}\\b`, "gi"), " ");
  }
  if (hashtag) {
    result = result.replace(
      new RegExp(`(^|\\s)${escapeRegExp(hashtag)}(?=\\s|$)`, "gi"),
      " ",
    );
  }
  return result.replace(/[ \t]+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitTelegramText(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n\n", limit);
    if (splitAt < limit / 2) splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit / 2) splitAt = remaining.lastIndexOf(" ", limit);
    if (splitAt <= 0) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function requiredDraftSections(text: string): boolean {
  return ["[TELEGRAM]", "[X]", "[INSTAGRAM]"].every((marker) =>
    text.includes(marker),
  );
}
