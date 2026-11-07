import { DurableObject } from "cloudflare:workers";
import projectBrief from "./PROJECT_BRIEF.md";
import { generateDraft } from "./ai";
import { HELP_TEXT } from "./config";
import {
  buildSource,
  commandName,
  draftKey,
  extractMedia,
  flowKey,
  hasQuickTrigger,
  messageText,
  optionalInteger,
  positiveInteger,
  requiredDraftSections,
  sameTopic,
  splitTelegramText,
  stripCreateCommand,
  stripQuickTrigger,
} from "./helpers";
import { TelegramClient } from "./telegram";
import {
  cachedResearch,
  formatResearch,
  researchTopic,
  searchResearch,
} from "./research";
import type {
  DraftRecord,
  Env,
  FlowState,
  GenerationJob,
  MediaReference,
  ResearchCacheEntry,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from "./types";

const JOBS_KEY = "generation-jobs";
const USAGE_KEY = "generation-events";
const APPROVED_KEY = "approved-posts";
const SEEN_UPDATES_KEY = "seen-updates";
const RESEARCH_CACHE_KEY = "research-cache";
const RESEARCH_USAGE_KEY = "research-events";

export class BotState extends DurableObject<Env> {
  private readonly telegram: TelegramClient;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    try {
      const update = (await request.json()) as TelegramUpdate;
      await this.processUpdate(update);
      return Response.json({ ok: true });
    } catch (error) {
      console.error(
        "Telegram update failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      return Response.json({ ok: false }, { status: 500 });
    }
  }

  async alarm(): Promise<void> {
    const jobs = (await this.ctx.storage.get<GenerationJob[]>(JOBS_KEY)) ?? [];
    const job = jobs[0];
    if (!job) return;

    try {
      const approved = (await this.ctx.storage.get<string>(APPROVED_KEY)) ?? "";
      const research = await this.researchForSource(job.source);
      const draft = await generateDraft({
        env: this.env,
        telegram: this.telegram,
        projectBrief,
        approvedPosts: approved,
        source: job.source,
        researchContext: formatResearch(research),
        media: job.media,
        existingDraft: job.kind === "revise" ? job.draft : undefined,
        revisionRequest: job.revisionRequest,
      });
      if (!requiredDraftSections(draft)) {
        console.warn("AI response is missing one or more platform markers");
      }
      await this.recordGeneration();
      await this.sendAndStoreDraft(job, draft);
    } catch (error) {
      console.error(
        "Generation job failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      await this.safeSend(
        job.chatId,
        "I could not generate the drafts. Please try /createpost again in a moment.",
        job.threadId,
      );
    } finally {
      await this.safeDelete(job.chatId, job.loadingMessageId);
      const latest =
        (await this.ctx.storage.get<GenerationJob[]>(JOBS_KEY)) ?? [];
      const remaining = latest.filter((candidate) => candidate.id !== job.id);
      await this.ctx.storage.put(JOBS_KEY, remaining);
      if (remaining.length > 0) await this.ctx.storage.setAlarm(Date.now() + 10);
    }
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    const seen = (await this.ctx.storage.get<number[]>(SEEN_UPDATES_KEY)) ?? [];
    if (seen.includes(update.update_id)) return;

    const callback = update.callback_query;
    const message = update.message;
    const chatId = callback?.message?.chat.id ?? message?.chat.id;
    const allowedChat = optionalInteger(this.env.ALLOWED_CHAT_ID);
    if (chatId !== undefined && allowedChat !== undefined && chatId !== allowedChat) {
      return;
    }

    if (callback) await this.handleCallback(callback);
    else if (message) await this.handleMessage(message);

    seen.push(update.update_id);
    await this.ctx.storage.put(SEEN_UPDATES_KEY, seen.slice(-200));
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;
    const text = messageText(message);
    const command = commandName(text);

    if (command === "start" || command === "help") {
      await this.telegram.sendMessage(
        message.chat.id,
        HELP_TEXT,
        message.message_thread_id,
      );
      return;
    }
    if (command === "where") {
      await this.telegram.sendMessage(
        message.chat.id,
        `Chat ID: ${message.chat.id}\nTopic ID: ${message.message_thread_id ?? "none"}`,
        message.message_thread_id,
      );
      return;
    }
    if (command === "brief") {
      await this.telegram.sendMessage(
        message.chat.id,
        `The bundled project brief is loaded (${projectBrief.trim().length} characters).`,
        message.message_thread_id,
      );
      return;
    }
    if (command === "usage") {
      await this.sendUsage(message);
      return;
    }
    if (command === "cancel") {
      await this.cancelFlow(message, userId);
      return;
    }
    if (command === "final") {
      await this.approveDraft(message);
      return;
    }
    if (command === "createpost") {
      await this.startGuidedFlow(message, userId);
      return;
    }

    const key = flowKey(message.chat.id, userId);
    const flow = await this.ctx.storage.get<FlowState>(key);
    if (flow && sameTopic(message, flow.threadId)) {
      await this.continueGuidedFlow(message, key, flow);
      return;
    }

    if (
      hasQuickTrigger(
        text,
        this.env.BOT_USERNAME,
        this.env.CONTENT_TRIGGER_HASHTAG || "#createpost",
      )
    ) {
      await this.quickCreate(message);
      return;
    }

    const replied = message.reply_to_message;
    if (replied && text) {
      const record = await this.ctx.storage.get<DraftRecord>(
        draftKey(message.chat.id, replied.message_id),
      );
      if (record) await this.enqueueRevision(message, record, text);
    }
  }

  private async startGuidedFlow(
    message: TelegramMessage,
    userId: number,
  ): Promise<void> {
    if (!(await this.usageAvailable(message))) return;
    const current = stripCreateCommand(messageText(message));
    const replied = messageText(message.reply_to_message);
    const source = buildSource(current, replied);
    const flow: FlowState = {
      chatId: message.chat.id,
      threadId: message.message_thread_id,
      state: source ? "media" : "content",
      source,
    };
    await this.ctx.storage.put(flowKey(message.chat.id, userId), flow);
    if (source) await this.askForMedia(message);
    else {
      await this.telegram.sendMessage(
        message.chat.id,
        "What should the post be about? Send the update as a text message.\n\nUse /cancel to stop.",
        message.message_thread_id,
      );
    }
  }

  private async continueGuidedFlow(
    message: TelegramMessage,
    key: string,
    flow: FlowState,
  ): Promise<void> {
    if (flow.state === "content") {
      const content = messageText(message);
      if (!content || extractMedia(message)) {
        await this.telegram.sendMessage(
          message.chat.id,
          "Please send the content as text first, or use /cancel.",
          message.message_thread_id,
        );
        return;
      }
      flow.source = content;
      flow.state = "media";
      await this.ctx.storage.put(key, flow);
      await this.askForMedia(message);
      return;
    }

    const media = extractMedia(message);
    if (!media) {
      await this.telegram.sendMessage(
        message.chat.id,
        "Please send one image, tap No media, or use /cancel.",
        message.message_thread_id,
      );
      return;
    }
    let source = flow.source;
    const caption = messageText(message);
    if (caption) source += `\n\nMedia caption:\n${caption}`;
    if (await this.enqueueCreation(message, source, media)) {
      await this.ctx.storage.delete(key);
    }
  }

  private async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    await this.telegram.answerCallbackQuery(query.id);
    const message = query.message;
    if (!message || !query.data) return;
    const key = flowKey(message.chat.id, query.from.id);
    const flow = await this.ctx.storage.get<FlowState>(key);
    if (!flow || flow.state !== "media" || !sameTopic(message, flow.threadId)) {
      await this.telegram.editMessage(
        message.chat.id,
        message.message_id,
        "This post request is no longer active. Start again with /createpost.",
      );
      return;
    }
    if (query.data === "createpost:cancel") {
      await this.ctx.storage.delete(key);
      await this.telegram.editMessage(
        message.chat.id,
        message.message_id,
        "Post creation cancelled.",
      );
      return;
    }
    if (query.data === "createpost:no_media") {
      await this.telegram.editMessage(
        message.chat.id,
        message.message_id,
        "No media selected.",
      );
      if (await this.enqueueCreation(message, flow.source)) {
        await this.ctx.storage.delete(key);
      }
    }
  }

  private async quickCreate(message: TelegramMessage): Promise<void> {
    const current = stripQuickTrigger(
      messageText(message),
      this.env.BOT_USERNAME,
      this.env.CONTENT_TRIGGER_HASHTAG || "#createpost",
    );
    const repliedText = messageText(message.reply_to_message);
    const source = buildSource(current, repliedText);
    const media = extractMedia(message) ?? extractMedia(message.reply_to_message);
    if (!source && !media) {
      await this.telegram.sendMessage(
        message.chat.id,
        "Include an update, attach an image, or reply to an existing message.",
        message.message_thread_id,
      );
      return;
    }
    await this.enqueueCreation(
      message,
      source || "The supplied image is the only source material.",
      media,
    );
  }

  private async enqueueCreation(
    message: TelegramMessage,
    source: string,
    media?: MediaReference,
  ): Promise<boolean> {
    return this.enqueueJob(message, {
      id: crypto.randomUUID(),
      kind: "create",
      chatId: message.chat.id,
      threadId: message.message_thread_id,
      source,
      media,
      loadingMessageId: 0,
    });
  }

  private async enqueueRevision(
    message: TelegramMessage,
    record: DraftRecord,
    request: string,
  ): Promise<void> {
    await this.enqueueJob(message, {
      id: crypto.randomUUID(),
      kind: "revise",
      chatId: message.chat.id,
      threadId: message.message_thread_id,
      source: record.source,
      draft: record.draft,
      revisionRequest: request,
      loadingMessageId: 0,
    });
  }

  private async enqueueJob(
    message: TelegramMessage,
    job: GenerationJob,
  ): Promise<boolean> {
    if (!(await this.usageAvailable(message))) return false;
    const loading = await this.telegram.sendMessage(
      message.chat.id,
      "⏳ Creating drafts for Telegram, X, and Instagram…",
      message.message_thread_id,
    );
    job.loadingMessageId = loading.message_id;
    try {
      const jobs =
        (await this.ctx.storage.get<GenerationJob[]>(JOBS_KEY)) ?? [];
      if (jobs.length >= 20) {
        await this.safeDelete(message.chat.id, loading.message_id);
        await this.telegram.sendMessage(
          message.chat.id,
          "The generation queue is full. Please try again shortly.",
          message.message_thread_id,
        );
        return false;
      }
      jobs.push(job);
      await this.ctx.storage.put(JOBS_KEY, jobs);
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + 10);
      }
      return true;
    } catch (error) {
      await this.safeDelete(message.chat.id, loading.message_id);
      throw error;
    }
  }

  private async askForMedia(message: TelegramMessage): Promise<void> {
    await this.telegram.sendMessage(
      message.chat.id,
      "Now send one image for the post, or choose No media.",
      message.message_thread_id,
      {
        inline_keyboard: [
          [{ text: "No media", callback_data: "createpost:no_media" }],
          [{ text: "Cancel", callback_data: "createpost:cancel" }],
        ],
      },
    );
  }

  private async cancelFlow(
    message: TelegramMessage,
    userId: number,
  ): Promise<void> {
    const deleted = await this.ctx.storage.delete(flowKey(message.chat.id, userId));
    await this.telegram.sendMessage(
      message.chat.id,
      deleted ? "Post creation cancelled." : "There is no active post creation flow.",
      message.message_thread_id,
    );
  }

  private async approveDraft(message: TelegramMessage): Promise<void> {
    const replied = message.reply_to_message;
    if (!replied) {
      await this.telegram.sendMessage(
        message.chat.id,
        "Reply to one of my drafts with /final.",
        message.message_thread_id,
      );
      return;
    }
    const record = await this.ctx.storage.get<DraftRecord>(
      draftKey(message.chat.id, replied.message_id),
    );
    if (!record) {
      await this.telegram.sendMessage(
        message.chat.id,
        "I could not find that draft in cloud history.",
        message.message_thread_id,
      );
      return;
    }
    const existing = (await this.ctx.storage.get<string>(APPROVED_KEY)) ?? "";
    const addition = `\n\n## Approved ${new Date().toISOString()}\n\n${record.draft}`;
    const maximum = positiveInteger(this.env.APPROVED_POSTS_MAX_CHARS, 12_000);
    await this.ctx.storage.put(APPROVED_KEY, (existing + addition).slice(-maximum));
    await this.telegram.sendMessage(
      message.chat.id,
      "Saved as an approved style example. Future drafts will use it.",
      message.message_thread_id,
    );
  }

  private async sendUsage(message: TelegramMessage): Promise<void> {
    const { daily, monthly } = await this.usageCounts();
    const research = await this.researchUsageCounts();
    await this.telegram.sendMessage(
      message.chat.id,
      `Cloud usage (UTC):\nAI generations today: ${daily}/${positiveInteger(this.env.DAILY_GENERATION_LIMIT, 30)}\nAI generations this month: ${monthly}/${positiveInteger(this.env.MONTHLY_GENERATION_LIMIT, 300)}\nFresh research searches today: ${research.daily}/${positiveInteger(this.env.DAILY_RESEARCH_LIMIT, 10)}\nFresh research searches this month: ${research.monthly}/${positiveInteger(this.env.MONTHLY_RESEARCH_LIMIT, 100)}\nMaximum output: ${positiveInteger(this.env.AI_MAX_OUTPUT_TOKENS, 900)} tokens\nImage detail: ${this.env.AI_IMAGE_DETAIL || "low"}`,
      message.message_thread_id,
    );
  }

  private async researchForSource(
    source: string,
  ): Promise<ResearchCacheEntry | undefined> {
    if ((this.env.RESEARCH_ENABLED || "true").toLowerCase() !== "true") {
      return undefined;
    }
    const topic = researchTopic(source);
    const cache =
      (await this.ctx.storage.get<ResearchCacheEntry[]>(RESEARCH_CACHE_KEY)) ?? [];
    const cached = cachedResearch(
      cache,
      topic,
      positiveInteger(this.env.RESEARCH_CACHE_DAYS, 7),
    );
    if (cached) return cached;
    if (!(await this.researchAvailable())) return undefined;

    await this.recordResearchAttempt();
    try {
      const result = await searchResearch(this.env, topic);
      if (!result) return undefined;
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const updated = [
        result,
        ...cache.filter(
          (entry) => entry.topic !== topic && entry.createdAt >= cutoff,
        ),
      ].slice(0, 24);
      await this.ctx.storage.put(RESEARCH_CACHE_KEY, updated);
      return result;
    } catch (error) {
      console.warn(
        "Optional research failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      return undefined;
    }
  }

  private async researchAvailable(): Promise<boolean> {
    const counts = await this.researchUsageCounts();
    return (
      counts.daily < positiveInteger(this.env.DAILY_RESEARCH_LIMIT, 10) &&
      counts.monthly < positiveInteger(this.env.MONTHLY_RESEARCH_LIMIT, 100)
    );
  }

  private async researchUsageCounts(): Promise<{
    daily: number;
    monthly: number;
  }> {
    const events =
      (await this.ctx.storage.get<number[]>(RESEARCH_USAGE_KEY)) ?? [];
    const now = new Date();
    const dayStart = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    return {
      daily: events.filter((timestamp) => timestamp >= dayStart).length,
      monthly: events.filter((timestamp) => timestamp >= monthStart).length,
    };
  }

  private async recordResearchAttempt(): Promise<void> {
    const events =
      (await this.ctx.storage.get<number[]>(RESEARCH_USAGE_KEY)) ?? [];
    const now = Date.now();
    const retention = now - 40 * 24 * 60 * 60 * 1000;
    await this.ctx.storage.put(
      RESEARCH_USAGE_KEY,
      [...events.filter((timestamp) => timestamp >= retention), now],
    );
  }

  private async usageAvailable(message: TelegramMessage): Promise<boolean> {
    const { daily, monthly } = await this.usageCounts();
    if (daily >= positiveInteger(this.env.DAILY_GENERATION_LIMIT, 30)) {
      await this.telegram.sendMessage(
        message.chat.id,
        "The daily AI generation limit has been reached.",
        message.message_thread_id,
      );
      return false;
    }
    if (monthly >= positiveInteger(this.env.MONTHLY_GENERATION_LIMIT, 300)) {
      await this.telegram.sendMessage(
        message.chat.id,
        "The monthly AI generation limit has been reached.",
        message.message_thread_id,
      );
      return false;
    }
    return true;
  }

  private async usageCounts(): Promise<{ daily: number; monthly: number }> {
    const events = (await this.ctx.storage.get<number[]>(USAGE_KEY)) ?? [];
    const now = new Date();
    const dayStart = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    return {
      daily: events.filter((timestamp) => timestamp >= dayStart).length,
      monthly: events.filter((timestamp) => timestamp >= monthStart).length,
    };
  }

  private async recordGeneration(): Promise<void> {
    const events = (await this.ctx.storage.get<number[]>(USAGE_KEY)) ?? [];
    const now = Date.now();
    const retention = now - 40 * 24 * 60 * 60 * 1000;
    await this.ctx.storage.put(
      USAGE_KEY,
      [...events.filter((timestamp) => timestamp >= retention), now],
    );
  }

  private async sendAndStoreDraft(
    job: GenerationJob,
    draft: string,
  ): Promise<void> {
    const configuredTopic = optionalInteger(this.env.CONTENT_TOPIC_ID);
    const topicId = configuredTopic ?? job.threadId;
    const chunks = splitTelegramText(draft);
    for (let index = 0; index < chunks.length; index += 1) {
      const prefix = index === 0 ? "Draft package\n\n" : "Draft continued\n\n";
      const sent = await this.telegram.sendMessage(
        job.chatId,
        prefix + chunks[index],
        topicId,
      );
      await this.ctx.storage.put(draftKey(job.chatId, sent.message_id), {
        draft,
        source: job.source,
      } satisfies DraftRecord);
    }
  }

  private async safeDelete(chatId: number, messageId: number): Promise<void> {
    try {
      await this.telegram.deleteMessage(chatId, messageId);
    } catch (error) {
      console.warn(
        "Could not delete Telegram message",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
  }

  private async safeSend(
    chatId: number,
    text: string,
    threadId?: number,
  ): Promise<void> {
    try {
      await this.telegram.sendMessage(chatId, text, threadId);
    } catch (error) {
      console.warn(
        "Could not send Telegram error message",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
  }
}
