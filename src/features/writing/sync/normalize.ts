import type { Post } from "../types.ts";

const EXCERPT_LENGTH = 1_200;
const TITLE_LENGTH = 90;

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

function hashId(value: string): string {
  let hash = 5381;
  for (const char of value) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

/** A LinkedIn post has no title, so a short first line stands in for one. */
function splitTitle(text: string): { title: string | null; body: string } {
  const [firstLine = "", ...rest] = text.split("\n");
  const first = firstLine.trim();
  if (
    first.length > 0 &&
    first.length <= TITLE_LENGTH &&
    rest.join("").trim()
  ) {
    return { title: first, body: rest.join("\n").trim() };
  }
  return { title: null, body: text };
}

function clip(text: string): string {
  if (text.length <= EXCERPT_LENGTH) return text;
  return `${text.slice(0, EXCERPT_LENGTH).replace(/\s+\S*$/, "")}…`;
}

export function toLinkedInPost(input: {
  text: string;
  url: string;
  publishedAt: string;
  reactions?: number | null;
  comments?: number | null;
}): Post | null {
  const text = input.text.trim();
  const date = new Date(input.publishedAt);
  if (!text || !input.url || Number.isNaN(date.getTime())) return null;
  const url = normalizeUrl(input.url);
  const { title, body } = splitTitle(text);
  return {
    id: hashId(url),
    source: "linkedin",
    sourceName: "LinkedIn",
    title,
    excerpt: clip(body),
    url,
    publishedAt: date.toISOString(),
    image: null,
    reactions: input.reactions ?? null,
    comments: input.comments ?? null,
  };
}

/** LinkedIn links one post several ways, but they all carry the same 19-digit id. */
function dedupeKey(url: string): string {
  const linkedinId = url.includes("linkedin.com") && url.match(/\d{19}/)?.[0];
  return linkedinId ? `linkedin:${linkedinId}` : normalizeUrl(url);
}

/** Fresh data wins on the same URL, and nothing already saved is ever lost. */
export function mergePosts(
  existing: Post[],
  incoming: Post[],
  limit: number,
): Post[] {
  const byUrl = new Map<string, Post>();
  for (const post of [...existing, ...incoming]) {
    byUrl.set(dedupeKey(post.url), post);
  }
  return [...byUrl.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}

export { clip, hashId, normalizeUrl };
