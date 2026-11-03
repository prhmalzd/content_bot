export interface Env {
  BOT_STATE: DurableObjectNamespace;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  AVALAI_API_KEY: string;
  AVALAI_BASE_URL: string;
  AVALAI_MODEL: string;
  AI_MAX_OUTPUT_TOKENS: string;
  AI_IMAGE_DETAIL: string;
  DAILY_GENERATION_LIMIT: string;
  MONTHLY_GENERATION_LIMIT: string;
  APPROVED_POSTS_MAX_CHARS: string;
  MAX_IMAGE_BYTES: string;
  ALLOWED_CHAT_ID: string;
  CONTENT_TOPIC_ID: string;
  BOT_USERNAME: string;
  CONTENT_TRIGGER_HASHTAG: string;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  username?: string;
}

export interface TelegramPhoto {
  file_id: string;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_size?: number;
  mime_type?: string;
}

export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhoto[];
  document?: TelegramDocument;
  reply_to_message?: TelegramMessage;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface FlowState {
  chatId: number;
  threadId?: number;
  state: "content" | "media";
  source: string;
}

export interface MediaReference {
  fileId: string;
  mimeType: string;
  size?: number;
}

export interface DraftRecord {
  draft: string;
  source: string;
}

export interface GenerationJob {
  id: string;
  kind: "create" | "revise";
  chatId: number;
  threadId?: number;
  source: string;
  media?: MediaReference;
  loadingMessageId: number;
  draft?: string;
  revisionRequest?: string;
}
