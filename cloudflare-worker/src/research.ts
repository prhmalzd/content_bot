import { positiveInteger } from "./helpers";
import type {
  Env,
  ResearchCacheEntry,
  ResearchSource,
} from "./types";

interface SearchEnvelope {
  results?: Array<{
    title?: unknown;
    url?: unknown;
    snippet?: unknown;
    description?: unknown;
    date?: unknown;
  }>;
}

const TOPICS: Array<{ name: string; pattern: RegExp }> = [
  { name: "pixel art", pattern: /\bpixel(?:\s|-)?art\b|sprite|tileset/i },
  { name: "game animation", pattern: /animat|walk cycle|idle cycle|frame(?:s)?/i },
  { name: "environment art", pattern: /environment|dungeon|background|lighting|biome|scene/i },
  { name: "character art", pattern: /character|king|enemy|npc|portrait|concept art/i },
  { name: "puzzle design", pattern: /puzzle|mechanic|level design|world|hazard|solution/i },
  { name: "game UI UX", pattern: /\bui\b|\bux\b|interface|menu|inventory|icon|hud/i },
  { name: "indie game demo", pattern: /demo|prototype|playtest|itch\.io|browser build/i },
  { name: "game programming", pattern: /code|program|bug|performance|system|implementation/i },
  { name: "game audio", pattern: /music|sound|audio|sfx|soundtrack/i },
  { name: "indie game development", pattern: /devlog|development|progress|update/i },
];

export function researchTopic(source: string): string {
  const matches = TOPICS.filter((candidate) => candidate.pattern.test(source))
    .slice(0, 2)
    .map((candidate) => candidate.name);
  return matches.length > 0 ? matches.join(" and ") : "indie game development";
}

export function cachedResearch(
  cache: ResearchCacheEntry[],
  topic: string,
  maximumAgeDays: number,
): ResearchCacheEntry | undefined {
  const cutoff = Date.now() - maximumAgeDays * 24 * 60 * 60 * 1000;
  return cache.find(
    (entry) => entry.topic === topic && entry.createdAt >= cutoff,
  );
}

export async function searchResearch(
  env: Env,
  topic: string,
): Promise<ResearchCacheEntry | undefined> {
  if ((env.RESEARCH_ENABLED || "true").toLowerCase() !== "true") return undefined;
  const year = new Date().getUTCFullYear();
  const query = `${topic} indie game development community social media content hashtags ${year}`;
  const baseUrl = (env.AVALAI_BASE_URL || "https://api.avalai.ir/v1").replace(
    /\/$/,
    "",
  );
  const response = await fetch(`${baseUrl}/search/firecrawl-search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.AVALAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(10, positiveInteger(env.RESEARCH_MAX_RESULTS, 5)),
      sources: ["web", "news"],
      tbs: "qdr:m",
      ignoreInvalidURLs: true,
      max_tokens_per_page: 300,
    }),
  });
  if (!response.ok) return undefined;

  const data = (await response.json()) as SearchEnvelope;
  const sources: ResearchSource[] = (data.results ?? [])
    .map((result) => ({
      title: cleanText(result.title, 180),
      url: cleanUrl(result.url),
      snippet: cleanText(result.snippet ?? result.description, 600),
      date: cleanText(result.date, 40) || undefined,
    }))
    .filter((result) => result.title && result.url && result.snippet)
    .slice(0, positiveInteger(env.RESEARCH_MAX_RESULTS, 5));

  if (sources.length === 0) return undefined;
  return { topic, query, createdAt: Date.now(), sources };
}

export function formatResearch(entry?: ResearchCacheEntry): string {
  if (!entry) {
    return "No reliable external research was available. Create strong content using only the project brief, team update, and supplied media.";
  }
  const sources = entry.sources
    .map(
      (source, index) =>
        `${index + 1}. ${source.title}${source.date ? ` (${source.date})` : ""}\nURL: ${source.url}\nExcerpt: ${source.snippet}`,
    )
    .join("\n\n");
  return `Research topic: ${entry.topic}\nSearch date: ${new Date(entry.createdAt).toISOString()}\n\n${sources}`.slice(
    0,
    6000,
  );
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function cleanUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString().slice(0, 1000)
      : "";
  } catch {
    return "";
  }
}
