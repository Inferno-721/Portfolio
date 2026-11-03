import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AgentEvent } from "./events.ts";
import { createAgentHandler } from "./handler.ts";
import { buildKnowledge } from "./knowledge.ts";
import { search } from "./retrieve.ts";
import {
  runAgent,
  type MessageStreamLike,
  type StreamMessage,
} from "./run-agent.ts";

const cv = JSON.parse(
  readFileSync(new URL("../../../../cv.json", import.meta.url), "utf8"),
);
const knowledge = buildKnowledge(cv, [], "/resume.pdf");

type FakeTurn = {
  text?: string;
  tools?: { name: string; input: unknown }[];
  stopReason?: string;
  failWith?: Error;
};

/** Plays back scripted model turns through the same interface as the real stream. */
function fakeModel(turns: FakeTurn[]): {
  streamMessage: StreamMessage;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  let index = 0;
  const streamMessage: StreamMessage = (params) => {
    calls.push(structuredClone(params));
    const turn = turns[index++];
    if (!turn) throw new Error("Model called more times than scripted");
    const stream = {
      async *[Symbol.asyncIterator]() {
        if (turn.failWith) throw turn.failWith;
        if (turn.text) {
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: turn.text },
          };
        }
      },
      finalMessage: async () => ({
        model: "fake-model",
        stop_reason: turn.stopReason ?? (turn.tools ? "tool_use" : "end_turn"),
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 2,
        },
        content: [
          ...(turn.text ? [{ type: "text", text: turn.text }] : []),
          ...(turn.tools ?? []).map(({ name, input }, toolIndex) => ({
            type: "tool_use",
            id: `call_${toolIndex}`,
            name,
            input,
          })),
        ],
      }),
    };
    return stream as unknown as MessageStreamLike;
  };
  return { streamMessage, calls };
}

async function run(question: string, streamMessage: StreamMessage | null) {
  const events: AgentEvent[] = [];
  const summary = await runAgent({
    question,
    history: [],
    knowledge,
    model: "claude-opus-5-5",
    streamMessage,
    emit: (event) => events.push(event),
  });
  return { events, summary };
}

const visibleAnswer = (events: AgentEvent[]): string => {
  let text = "";
  for (const event of events) {
    if (event.type === "reset") text = "";
    if (event.type === "delta") text += event.text;
  }
  return text;
};

test("fixed questions take the fast path and never call the model", async () => {
  const { streamMessage, calls } = fakeModel([]);
  const { summary, events } = await run(
    "How do I contact Shubham?",
    streamMessage,
  );
  assert.equal(summary.mode, "fast-path");
  assert.equal(calls.length, 0);
  assert.ok(visibleAnswer(events).includes("shubham05373@gmail.com"));
});

test("the loop runs tools, feeds results back and streams the final answer", async () => {
  const { streamMessage, calls } = fakeModel([
    { tools: [{ name: "search_profile", input: { query: "Qdrant" } }] },
    { text: "InfoOrigin used Qdrant." },
  ]);
  const { summary, events } = await run(
    "Which vector database has Shubham used?",
    streamMessage,
  );
  assert.equal(summary.mode, "agent");
  assert.deepEqual(summary.tools, ["search_profile"]);
  assert.equal(calls.length, 2);
  assert.equal(visibleAnswer(events), "InfoOrigin used Qdrant.");
  assert.ok(
    events.some(
      (event) =>
        event.type === "trace" && event.label.startsWith("search_profile"),
    ),
  );
  const done = events.find((event) => event.type === "done");
  assert.ok(
    done && done.type === "done" && done.tools === 1 && done.tokens === 34,
  );
  const sources = events.find((event) => event.type === "sources");
  assert.ok(
    sources &&
      sources.type === "sources" &&
      sources.items.some(({ title }) => title === "InfoOrigin"),
  );
});

test("all tool results return in a single user message after the assistant turn", async () => {
  const { streamMessage, calls } = fakeModel([
    {
      tools: [
        { name: "list_projects", input: {} },
        { name: "get_experience", input: {} },
      ],
    },
    { text: "Done." },
  ]);
  await run("Summarize everything about agents", streamMessage);
  const { messages } = calls[1] as {
    messages: { role: string; content: { type: string }[] }[];
  };
  assert.equal(messages.at(-2)?.role, "assistant");
  assert.equal(messages.at(-1)?.role, "user");
  assert.deepEqual(
    messages.at(-1)?.content.map(({ type }) => type),
    ["tool_result", "tool_result"],
  );
});

test("the last allowed turn forces an answer, so the loop can't run forever", async () => {
  const tool = { name: "search_profile", input: { query: "agents" } };
  const { streamMessage, calls } = fakeModel([
    { tools: [tool] },
    { tools: [tool] },
    { text: "Final answer." },
  ]);
  const { summary } = await run("Tell me a lot about agents", streamMessage);
  assert.equal(calls.length, 3);
  assert.deepEqual((calls[2] as { tool_choice: unknown }).tool_choice, {
    type: "none",
  });
  assert.equal(summary.answer, "Final answer.");
});

test("bad tool input comes back as an error result instead of running", async () => {
  const { streamMessage, calls } = fakeModel([
    { tools: [{ name: "search_profile", input: { query: 42 } }] },
    { text: "Sorry, nothing found." },
  ]);
  await run("Tell me about agents and more", streamMessage);
  const { messages } = calls[1] as {
    messages: { content: { is_error?: boolean }[] }[];
  };
  assert.equal(messages.at(-1)?.content[0]?.is_error, true);
});

test("a preamble before a tool call is cleared from the visible answer", async () => {
  const { streamMessage } = fakeModel([
    { text: "Let me check.", tools: [{ name: "list_projects", input: {} }] },
    { text: "CRM MCP Server." },
  ]);
  const { events } = await run(
    "What projects exist in the portfolio?",
    streamMessage,
  );
  assert.equal(visibleAnswer(events), "CRM MCP Server.");
});

test("an API failure falls back to search and discards partial output", async () => {
  const { streamMessage } = fakeModel([{ failWith: new Error("overloaded") }]);
  const { summary, events } = await run(
    "Which vector database has Shubham used?",
    streamMessage,
  );
  assert.equal(summary.mode, "search");
  assert.equal(summary.error?.name, "Error");
  assert.ok(visibleAnswer(events).includes("Qdrant"));
});

test("a truncated tool call is never executed", async () => {
  const { streamMessage } = fakeModel([
    {
      tools: [{ name: "search_profile", input: { query: "Qd" } }],
      stopReason: "max_tokens",
    },
  ]);
  const { summary } = await run(
    "Which vector database has Shubham used?",
    streamMessage,
  );
  assert.equal(summary.mode, "search");
  assert.deepEqual(summary.tools, ["search_all"]);
});

test("a refusal shows a short decline and no partial text", async () => {
  const { streamMessage } = fakeModel([
    { text: "Partial", stopReason: "refusal" },
  ]);
  const { events, summary } = await run(
    "Tell me something unrelated at length",
    streamMessage,
  );
  assert.equal(summary.mode, "agent");
  assert.ok(visibleAnswer(events).startsWith("I can only help"));
});

test("with no model configured it answers from search", async () => {
  const { summary, events } = await run(
    "What has Shubham built with MCP?",
    null,
  );
  assert.equal(summary.mode, "search");
  assert.ok(visibleAnswer(events).includes("CRM MCP Server"));
});

test("fallback chain is sent for Opus but not for Haiku, which has none", async () => {
  const opus = fakeModel([{ text: "Hi." }]);
  await run("Tell me about Shubham's work please", opus.streamMessage);
  assert.equal((opus.calls[0] as { fallbacks?: string }).fallbacks, "default");

  const haiku = fakeModel([{ text: "Hi." }]);
  await runAgent({
    question: "Tell me about Shubham's work please",
    history: [],
    knowledge,
    model: "claude-haiku-5-5",
    streamMessage: haiku.streamMessage,
    emit: () => {},
  });
  assert.equal((haiku.calls[0] as { fallbacks?: string }).fallbacks, undefined);
});

test("retrieval ranks the right chunk first", () => {
  assert.equal(
    search("CRM MCP server", knowledge.chunks)[0]?.title,
    "CRM MCP Server",
  );
  assert.equal(
    search("NVIDIA hackathon", knowledge.chunks)[0]?.title,
    "Contract Risk Intelligence",
  );
  assert.deepEqual(search("the of and", knowledge.chunks), []);
});

const ctx = { clientAddress: "1.1.1.1", streamMessage: null, model: "m" };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://site.test/api/agent", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("the endpoint rejects bad input, foreign origins and floods", async () => {
  const handle = createAgentHandler(knowledge);
  assert.equal((await handle(post("{nope"), ctx)).status, 400);
  assert.equal((await handle(post({ question: "" }), ctx)).status, 400);
  assert.equal(
    (await handle(post({ question: "x".repeat(501) }), ctx)).status,
    400,
  );
  assert.equal((await handle(post("x".repeat(9000)), ctx)).status, 413);
  assert.equal(
    (
      await handle(
        post({ question: "hi" }, { origin: "https://evil.test" }),
        ctx,
      )
    ).status,
    403,
  );

  const responses = [];
  for (let i = 0; i < 9; i++) {
    responses.push((await handle(post({ question: "hi" }), ctx)).status);
  }
  assert.equal(responses.filter((status) => status === 200).length, 8);
  assert.equal(responses.at(-1), 429);
});

test("the endpoint streams well-formed SSE ending in done, and logs no question text", async () => {
  const handle = createAgentHandler(knowledge);
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => lines.push(line);
  try {
    const response = await handle(
      post({ question: "secret question about MCP servers" }),
      ctx,
    );
    assert.equal(
      response.headers.get("content-type"),
      "text/event-stream; charset=utf-8",
    );
    const frames = (await response.text()).trim().split("\n\n");
    const events = frames.map(
      (frame) => JSON.parse(frame.replace(/^data: /, "")) as AgentEvent,
    );
    assert.equal(events.at(-1)?.type, "done");
    assert.ok(events.some((event) => event.type === "delta"));
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]?.includes("secret question"));
  assert.equal(JSON.parse(lines[0] ?? "{}").event, "agent_request");
});

test("a model that stalls falls back to search before the function is stopped", async () => {
  const stalled: StreamMessage = (_params, signal) => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        await new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        });
      },
      finalMessage: () => new Promise(() => {}),
    };
    return stream as unknown as MessageStreamLike;
  };
  const events: AgentEvent[] = [];
  const summary = await runAgent({
    question: "Which vector database was used?",
    history: [],
    knowledge,
    model: "m",
    streamMessage: stalled,
    emit: (event) => events.push(event),
    modelDeadlineMs: 30,
  });
  assert.equal(summary.mode, "search");
  assert.equal(summary.error?.name, "TimeoutError");
  assert.ok(visibleAnswer(events).includes("Qdrant"));
  assert.equal(events.at(-1)?.type, "done");
});

test("a visitor who leaves mid-answer gets no fallback", async () => {
  const controller = new AbortController();
  const stalled: StreamMessage = (_params, signal) => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        controller.abort();
        await new Promise((_resolve, reject) => {
          if (signal?.aborted) reject(signal.reason);
        });
      },
      finalMessage: () => new Promise(() => {}),
    };
    return stream as unknown as MessageStreamLike;
  };
  const events: AgentEvent[] = [];
  const summary = await runAgent({
    question: "Which vector database was used?",
    history: [],
    knowledge,
    model: "m",
    streamMessage: stalled,
    emit: (event) => events.push(event),
    signal: controller.signal,
  });
  assert.equal(summary.error?.name, "Aborted");
  assert.ok(!events.some((event) => event.type === "done"));
});
