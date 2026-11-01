import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import type { AgentEvent } from "./events.ts";
import { createGeminiStream, toGeminiRequest } from "./gemini-stream.ts";
import { buildKnowledge } from "./knowledge.ts";
import { runAgent } from "./run-agent.ts";

const cv = JSON.parse(
  readFileSync(new URL("../../../../cv.json", import.meta.url), "utf8"),
);
const knowledge = buildKnowledge(cv, [], "/resume.pdf");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Gemini separates stream frames with CRLF line breaks, so the fake does too. */
function sse(frames: object[]): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\r\n\r\n`).join("");
  return new Response(body, { status: 200 });
}

function scriptFetch(responses: (() => Response)[]) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error("Fetched more times than scripted");
    return next();
  }) as typeof fetch;
  return calls;
}

const toolFrame = (name: string, args: object, id?: string) => ({
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          {
            functionCall: { name, args, ...(id ? { id } : {}) },
            thoughtSignature: "signature-abc",
          },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 },
});

const textFrame = (text: string, finishReason?: string) => ({
  candidates: [
    {
      content: { role: "model", parts: [{ text }] },
      ...(finishReason ? { finishReason } : {}),
    },
  ],
  usageMetadata: {
    promptTokenCount: 60,
    candidatesTokenCount: 12,
    thoughtsTokenCount: 3,
  },
  modelVersion: "gemini-test",
});

async function run(question: string) {
  const events: AgentEvent[] = [];
  const summary = await runAgent({
    question,
    history: [],
    knowledge,
    model: "gemini-test",
    streamMessage: createGeminiStream("secret-key"),
    emit: (event) => events.push(event),
  });
  const answer = events
    .flatMap((event) => (event.type === "delta" ? [event.text] : []))
    .join("");
  return { summary, events, answer };
}

test("a full tool loop works and sends the signature and result back correctly", async () => {
  const calls = scriptFetch([
    () => sse([toolFrame("search_profile", { query: "Qdrant" }, "call_1")]),
    () => sse([textFrame("InfoOrigin used "), textFrame("Qdrant.", "STOP")]),
  ]);
  const { summary, answer } = await run("Which vector database was used?");

  assert.equal(summary.mode, "agent");
  assert.deepEqual(summary.tools, ["search_profile"]);
  assert.equal(answer, "InfoOrigin used Qdrant.");
  assert.equal(summary.inputTokens, 100);
  assert.equal(summary.outputTokens, 23);

  const [modelTurn, toolTurn] = calls[1]?.body.contents.slice(-2) ?? [];
  assert.equal(modelTurn.role, "model");
  assert.equal(modelTurn.parts[0].thoughtSignature, "signature-abc");
  assert.equal(toolTurn.role, "user");
  assert.equal(toolTurn.parts[0].functionResponse.id, "call_1");
  assert.equal(toolTurn.parts[0].functionResponse.name, "search_profile");
  assert.ok(
    toolTurn.parts[0].functionResponse.response.result.includes("Qdrant"),
  );
});

test("models that don't send call ids still pair results by name", async () => {
  const calls = scriptFetch([
    () => sse([toolFrame("list_projects", {})]),
    () => sse([textFrame("Done.", "STOP")]),
  ]);
  await run("What projects exist?");
  const response = calls[1]?.body.contents.at(-1).parts[0].functionResponse;
  assert.equal(response.name, "list_projects");
  assert.equal(response.id, undefined);
});

test("the key goes in a header and never in the URL", async () => {
  const calls = scriptFetch([() => sse([textFrame("Hi.", "STOP")])]);
  await run("Tell me about the work please");
  assert.ok(!calls[0]?.url.includes("secret-key"));
  assert.equal(
    (calls[0]?.init.headers as Record<string, string>)["x-goog-api-key"],
    "secret-key",
  );
  assert.ok(
    calls[0]?.url.includes("gemini-test:streamGenerateContent?alt=sse"),
  );
});

test("the last allowed turn tells Gemini not to call more tools", () => {
  const request = toGeminiRequest({
    model: "m",
    max_tokens: 100,
    system: "s",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    tool_choice: { type: "none" },
  }) as { toolConfig: { functionCallingConfig: { mode: string } } };
  assert.equal(request.toolConfig.functionCallingConfig.mode, "NONE");
});

test("hitting the free limit falls back to search straight away, with no retry", async () => {
  const calls = scriptFetch([() => new Response("{}", { status: 429 })]);
  const { summary, answer } = await run("Which vector database was used?");
  assert.equal(calls.length, 1);
  assert.equal(summary.mode, "search");
  assert.equal(summary.error?.status, 429);
  assert.ok(answer.includes("Qdrant"));
});

test("a brief overload is retried once", async () => {
  const calls = scriptFetch([
    () => new Response("{}", { status: 503 }),
    () => sse([textFrame("Recovered.", "STOP")]),
  ]);
  const { summary, answer } = await run("Tell me about the work please");
  assert.equal(calls.length, 2);
  assert.equal(summary.mode, "agent");
  assert.equal(answer, "Recovered.");
});

test("a bad key falls back to search rather than showing an error", async () => {
  scriptFetch([() => new Response("{}", { status: 403 })]);
  const { summary, answer } = await run("Which vector database was used?");
  assert.equal(summary.mode, "search");
  assert.equal(summary.error?.status, 403);
  assert.ok(answer.includes("Qdrant"));
});

test("a safety block shows the short decline", async () => {
  scriptFetch([() => sse([{ candidates: [{ finishReason: "SAFETY" }] }])]);
  const { answer } = await run("Tell me about something else entirely");
  assert.ok(answer.startsWith("I can only help"));
});

test("internal model thoughts and empty text never reach the visitor", async () => {
  scriptFetch([
    () =>
      sse([
        {
          candidates: [
            {
              content: {
                parts: [
                  { text: "private reasoning", thought: true },
                  { text: "" },
                ],
              },
            },
          ],
        },
        textFrame("Visible.", "STOP"),
      ]),
  ]);
  const { answer } = await run("Tell me about the work please");
  assert.equal(answer, "Visible.");
});
