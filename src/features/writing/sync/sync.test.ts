import assert from "node:assert/strict";
import { test } from "node:test";
import type { Post } from "../types.ts";
import { fetchLinkedInPosts, parseApifyItems } from "./linkedin-apify.ts";
import { parseCsv, parseSharesCsv } from "./linkedin-export.ts";
import { mergePosts, toLinkedInPost } from "./normalize.ts";
import { parseFeed } from "./rss.ts";

test("Apify items map to posts, and reposts or empty items are dropped", () => {
  const posts = parseApifyItems([
    {
      type: "post",
      linkedinUrl:
        "https://www.linkedin.com/posts/me_agents-123?utm_source=share",
      content: "Why evals matter\n\nI tuned my agent to 60/60.",
      postedAt: { date: "2026-05-01T10:00:00.000Z" },
      engagement: { likes: 12, comments: 3 },
    },
    {
      type: "post",
      linkedinUrl: "https://x.test/a",
      content: "",
      postedAt: { date: "2026-05-01" },
    },
    {
      type: "comment",
      linkedinUrl: "https://x.test/b",
      content: "nice",
      postedAt: { date: "2026-05-01" },
    },
  ]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.url, "https://www.linkedin.com/posts/me_agents-123");
  assert.equal(posts[0]?.title, "Why evals matter");
  assert.equal(posts[0]?.excerpt, "I tuned my agent to 60/60.");
  assert.equal(posts[0]?.reactions, 12);
});

test("the LinkedIn request sends the token as a header and asks only for own recent posts", async () => {
  const original = globalThis.fetch;
  let url = "";
  let init: RequestInit | undefined;
  globalThis.fetch = (async (input: string, options: RequestInit) => {
    url = input;
    init = options;
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
  try {
    await fetchLinkedInPosts({
      profileUrl: "https://www.linkedin.com/in/me/",
      token: "secret-token",
      maxPosts: 5,
      postedLimit: "month",
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(!url.includes("secret-token"));
  assert.equal(
    (init?.headers as Record<string, string>).authorization,
    "Bearer secret-token",
  );
  const body = JSON.parse(String(init?.body));
  assert.deepEqual(body.targetUrls, ["https://www.linkedin.com/in/me/"]);
  assert.equal(body.maxPosts, 5);
  assert.equal(body.postedLimit, "month");
  assert.equal(body.includeReposts, false);
});

test("a failed LinkedIn request is reported rather than treated as no posts", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("bad token", { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(
      fetchLinkedInPosts({
        profileUrl: "https://www.linkedin.com/in/me/",
        token: "x",
        maxPosts: 5,
      }),
      /Apify returned 401/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("a one-paragraph post has no invented title", () => {
  const post = toLinkedInPost({
    text: "Just one line about RAG.",
    url: "https://x.test/p",
    publishedAt: "2026-01-01",
  });
  assert.equal(post?.title, null);
  assert.equal(post?.excerpt, "Just one line about RAG.");
});

test("an invalid date or URL drops the post rather than breaking the page", () => {
  assert.equal(
    toLinkedInPost({ text: "x", url: "https://x.test", publishedAt: "soon" }),
    null,
  );
  assert.equal(
    toLinkedInPost({ text: "x", url: "", publishedAt: "2026-01-01" }),
    null,
  );
});

test("the CSV parser handles quotes, commas and newlines inside fields", () => {
  assert.deepEqual(parseCsv('a,b\n"x, ""y""\nz",2\r\n'), [
    ["a", "b"],
    ['x, "y"\nz', "2"],
  ]);
});

test("Shares.csv import keeps public posts and leaves out connections-only ones", () => {
  const csv = [
    "Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility",
    '2026-03-14 09:21:05,https://www.linkedin.com/feed/update/urn:li:share:1,"Public post, with comma",,,MEMBER_NETWORK',
    "2026-03-15 09:21:05,https://www.linkedin.com/feed/update/urn:li:share:2,Private post,,,CONNECTIONS",
    "2026-03-16 09:21:05,https://www.linkedin.com/feed/update/urn:li:share:3,,,,MEMBER_NETWORK",
  ].join("\n");
  const posts = parseSharesCsv(csv);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.excerpt, "Public post, with comma");
  assert.equal(posts[0]?.publishedAt, "2026-03-14T09:21:05.000Z");
});

test("Shares.csv with unexpected columns fails loudly and names what it found", () => {
  assert.throws(
    () => parseSharesCsv("foo,bar\n1,2\n"),
    /missing expected columns.*foo, bar/,
  );
});

test("RSS and Atom feeds parse, including CDATA and entities", () => {
  const rss = `<rss><channel><item>
    <title><![CDATA[Agents &amp; evals]]></title>
    <link>https://medium.com/@me/agents-abc?source=rss</link>
    <pubDate>Mon, 02 Mar 2026 10:00:00 GMT</pubDate>
    <content:encoded><![CDATA[<p>First para</p><p>Second &amp; last</p>]]></content:encoded>
  </item></channel></rss>`;
  const [post] = parseFeed(rss, "Medium");
  assert.equal(post?.title, "Agents & evals");
  assert.equal(post?.url, "https://medium.com/@me/agents-abc");
  assert.ok(post?.excerpt.startsWith("First para"));
  assert.ok(post?.excerpt.includes("Second & last"));

  const atom = `<feed><entry><title>Atom post</title><link href="https://blog.test/a"/>
    <published>2026-04-01T00:00:00Z</published><summary>Hello</summary></entry></feed>`;
  assert.equal(parseFeed(atom, "Blog")[0]?.url, "https://blog.test/a");
});

test("the same LinkedIn post under two kinds of link is only kept once", () => {
  const make = (url: string, reactions: number): Post => ({
    id: url,
    source: "linkedin",
    sourceName: "LinkedIn",
    title: null,
    excerpt: "x",
    url,
    publishedAt: "2026-01-01",
    image: null,
    reactions,
    comments: null,
  });
  const merged = mergePosts(
    [
      make(
        "https://www.linkedin.com/feed/update/urn:li:activity:7516951729041600512",
        1,
      ),
    ],
    [
      make(
        "https://www.linkedin.com/posts/me_topic-activity-7516951729041600512-abcd",
        9,
      ),
    ],
    10,
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.reactions, 9);
});

test("an image caption stays separate from the sentence after it", () => {
  const rss = `<rss><item><title>T</title><link>https://m.test/a</link>
    <pubDate>Mon, 02 Mar 2026 10:00:00 GMT</pubDate>
    <content:encoded><![CDATA[<figure><img src="https://x.test/a.png"><figcaption>A caption</figcaption></figure><p>Next sentence</p>]]></content:encoded></item></rss>`;
  assert.equal(
    parseFeed(rss, "Medium")[0]?.excerpt,
    "A caption\n\nNext sentence",
  );
});

test("a feed's cover image skips Medium's tracking pixel, and a post may have none", () => {
  const feed = (
    images: string,
  ) => `<rss><item><title>T</title><link>https://m.test/a</link>
    <pubDate>Mon, 02 Mar 2026 10:00:00 GMT</pubDate>
    <content:encoded><![CDATA[${images}<p>Body</p>]]></content:encoded></item></rss>`;
  const pixel =
    '<img src="https://medium.com/_/stat?event=post.clientViewed" width="1">';
  const cover =
    '<img alt="" src="https://cdn-images-1.medium.com/max/1024/a.png">';
  assert.equal(
    parseFeed(feed(pixel + cover), "Medium")[0]?.image,
    "https://cdn-images-1.medium.com/max/1024/a.png",
  );
  assert.equal(parseFeed(feed(pixel), "Medium")[0]?.image, null);
});

test("merging keeps old posts, refreshes duplicates, sorts newest first and caps", () => {
  const make = (url: string, publishedAt: string, reactions: number): Post => ({
    id: url,
    source: "linkedin",
    sourceName: "LinkedIn",
    title: null,
    excerpt: "x",
    url,
    publishedAt,
    image: null,
    reactions,
    comments: null,
  });
  const old = [
    make("https://x.test/a", "2026-01-01", 1),
    make("https://x.test/b", "2026-02-01", 1),
  ];
  const fresh = [
    make("https://x.test/a/", "2026-01-01", 9),
    make("https://x.test/c", "2026-03-01", 1),
  ];

  const merged = mergePosts(old, fresh, 10);
  assert.deepEqual(
    merged.map(({ url }) => url),
    ["https://x.test/c", "https://x.test/b", "https://x.test/a/"],
  );
  assert.equal(merged[2]?.reactions, 9);

  assert.equal(mergePosts(old, [], 10).length, 2);
  assert.equal(mergePosts(old, fresh, 1).length, 1);
});
