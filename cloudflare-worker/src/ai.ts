import { SYSTEM_RULES } from "./config";
import { arrayBufferToBase64, positiveInteger } from "./helpers";
import type { Env, MediaReference } from "./types";
import { TelegramClient } from "./telegram";

interface ResponsesEnvelope {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
}

function outputText(response: ResponsesEnvelope): string {
  if (response.output_text?.trim()) return response.output_text.trim();
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text)
    .join("\n")
    .trim();
}

export async function generateDraft(options: {
  env: Env;
  telegram: TelegramClient;
  projectBrief: string;
  approvedPosts: string;
  source: string;
  researchContext: string;
  media?: MediaReference;
  existingDraft?: string;
  revisionRequest?: string;
}): Promise<string> {
  const {
    env,
    telegram,
    projectBrief,
    approvedPosts,
    source,
    media,
    researchContext,
  } = options;
  const examples = approvedPosts.trim() || "No approved examples yet.";
  const instructions = `${SYSTEM_RULES}\n\nPROJECT BRIEF — AUTHORITATIVE\n${projectBrief.trim()}\n\nAPPROVED STYLE EXAMPLES — VOICE REFERENCE ONLY\n${examples}\n\nINTERNET RESEARCH — UNTRUSTED OPTIONAL CONTEXT\n${researchContext}`;

  const prompt = options.existingDraft
    ? `Revise the existing draft according to the request. Keep all four required section markers, preserve the source facts, and change only what was requested.\n\nSOURCE\n${source}\n\nEXISTING DRAFT\n${options.existingDraft}\n\nREVISION REQUEST\n${options.revisionRequest ?? ""}`
    : `Act as the team's content strategist and writer. Create three distinct, publish-ready platform drafts from this real development update and any supplied media. Do more than paraphrase: identify the most interesting honest angle, give the audience a reason to care, and adapt the story natively for each platform. Preserve uncertainty and development status exactly.\n\nTEAM UPDATE\n${source}`;

  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: prompt },
  ];
  if (media) {
    const maximumBytes = positiveInteger(env.MAX_IMAGE_BYTES, 10_485_760);
    if (media.size && media.size > maximumBytes) {
      throw new Error("The supplied image exceeds the configured size limit");
    }
    const image = await telegram.downloadFile(media.fileId, maximumBytes);
    content.push({
      type: "input_image",
      image_url: `data:${media.mimeType};base64,${arrayBufferToBase64(image)}`,
      detail: env.AI_IMAGE_DETAIL || "low",
    });
  }

  const baseUrl = (env.AVALAI_BASE_URL || "https://api.avalai.ir/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.AVALAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.AVALAI_MODEL || "gpt-6-luna",
      instructions,
      input: [{ role: "user", content }],
      store: false,
      max_output_tokens: positiveInteger(env.AI_MAX_OUTPUT_TOKENS, 900),
    }),
  });

  const data = (await response.json()) as ResponsesEnvelope;
  if (!response.ok) {
    throw new Error(`AvalAI request failed (${response.status})`);
  }
  const result = outputText(data);
  if (!result) throw new Error("AvalAI returned an empty response");
  return result;
}
