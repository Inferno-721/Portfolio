import type { Post } from "../types.ts";
import { clip, hashId, normalizeUrl } from "./normalize.ts";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(
      /&([a-z]+);/gi,
      (match, name) => ENTITIES[name.toLowerCase()] ?? match,
    );
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(
        /<\/(p|div|h[1-6]|li|br|figure|figcaption|blockquote|pre)>|<br\s*\/?>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function tag(block: string, ...names: string[]): string {
  for (const name of names) {
    const match = block.match(
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
    );
    if (match?.[1]) {
      return match[1]
        .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
        .trim();
    }
  }
  return "";
}

/** The first real picture in an article. Medium also embeds a 1px tracking image. */
function coverImage(html: string): string | null {
  for (const [, src = ""] of html.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
    if (src.startsWith("https://") && !src.includes("/_/stat")) return src;
  }
  return null;
}

/** Reads RSS 2.0 and Atom, which covers Medium, Substack, Hashnode, dev.to and most blogs. */
export function parseFeed(xml: string, sourceName: string): Post[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.flatMap((block) => {
    const link =
      tag(block, "link") ||
      (block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "");
    const title = stripHtml(tag(block, "title"));
    const html = tag(
      block,
      "content:encoded",
      "description",
      "summary",
      "content",
    );
    const body = stripHtml(html);
    const date = new Date(
      tag(block, "pubDate", "published", "updated", "dc:date"),
    );
    if (!link || !title || Number.isNaN(date.getTime())) return [];
    const url = normalizeUrl(decodeEntities(link));
    return [
      {
        id: hashId(url),
        source: "blog" as const,
        sourceName,
        title,
        excerpt: clip(body),
        url,
        publishedAt: date.toISOString(),
        image: coverImage(html),
        reactions: null,
        comments: null,
      },
    ];
  });
}

export async function fetchFeed(
  url: string,
  sourceName: string,
): Promise<Post[]> {
  const response = await fetch(url, {
    headers: { "user-agent": "portfolio-post-sync" },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return parseFeed(await response.text(), sourceName);
}
