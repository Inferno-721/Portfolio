/**
 * Eval harness with deterministic pass/fail checks.
 *
 *   pnpm eval          offline: routing and retrieval only, no model and no cost
 *   pnpm eval --live   every case against the real model; needs GEMINI_API_KEY or Anthropic credentials
 *
 * Writes src/features/agent/eval-results.json, which the home page displays, so the site
 * can only ever claim a score that was actually measured.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createStreamMessage } from "../src/features/agent/server/anthropic-stream.ts";
import {
  createGeminiStream,
  DEFAULT_GEMINI_MODEL,
} from "../src/features/agent/server/gemini-stream.ts";
import type {
  AgentEvent,
  AgentMode,
  Source,
} from "../src/features/agent/server/events.ts";
import { buildKnowledge } from "../src/features/agent/server/knowledge.ts";
import { runAgent } from "../src/features/agent/server/run-agent.ts";

type EvalCase = {
  id: string;
  question: string;
  offline: boolean;
  mode?: AgentMode;
  mustNotMode?: AgentMode;
  mustInclude?: string[];
  mustNotInclude?: string[];
  tools?: string[];
  toolsNone?: boolean;
  sources?: string[];
};

const readJson = async (path: string) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const live = process.argv.includes("--live");
const geminiKey = process.env.GEMINI_API_KEY;
const model =
  process.env.AGENT_MODEL ||
  (geminiKey ? DEFAULT_GEMINI_MODEL : "claude-opus-5-5");
// A case can take 2-3 model calls, and the free tier allows about 10 calls a minute.
const PACE_MS = geminiKey ? 16_000 : 0;
const cases: EvalCase[] = await readJson("./cases.json");
const knowledge = buildKnowledge(
  await readJson("../cv.json"),
  await readJson("../src/features/writing/data/posts.json"),
  "/Shubham_Joshi_Resume.pdf",
);
const streamMessage = !live
  ? null
  : geminiKey
    ? createGeminiStream(geminiKey)
    : createStreamMessage();
const selected = live ? cases : cases.filter((evalCase) => evalCase.offline);

function grade(
  evalCase: EvalCase,
  result: {
    answer: string;
    mode: AgentMode;
    tools: string[];
    sources: Source[];
  },
): string[] {
  const failures: string[] = [];
  const text = result.answer.toLowerCase();
  for (const phrase of evalCase.mustInclude ?? []) {
    if (!text.includes(phrase.toLowerCase()))
      failures.push(`missing "${phrase}"`);
  }
  for (const phrase of evalCase.mustNotInclude ?? []) {
    if (text.includes(phrase.toLowerCase()))
      failures.push(`contains "${phrase}"`);
  }
  if (evalCase.mode && result.mode !== evalCase.mode) {
    failures.push(`mode ${result.mode}, expected ${evalCase.mode}`);
  }
  if (evalCase.mustNotMode && result.mode === evalCase.mustNotMode) {
    failures.push(`mode must not be ${evalCase.mustNotMode}`);
  }
  if (
    live &&
    evalCase.tools &&
    !evalCase.tools.some((tool) => result.tools.includes(tool))
  ) {
    failures.push(
      `expected one of ${evalCase.tools.join(", ")}, got [${result.tools.join(", ")}]`,
    );
  }
  if (live && evalCase.toolsNone && result.tools.length > 0) {
    failures.push(`expected no tool calls, got [${result.tools.join(", ")}]`);
  }
  for (const url of evalCase.sources ?? []) {
    if (!result.sources.some((source) => source.url === url))
      failures.push(`missing source ${url}`);
  }
  return failures;
}

let passed = 0;
for (const evalCase of selected) {
  if (live && evalCase !== selected[0]) {
    await new Promise((resolve) => setTimeout(resolve, PACE_MS));
  }
  let sources: Source[] = [];
  const summary = await runAgent({
    question: evalCase.question,
    history: [],
    knowledge,
    model,
    streamMessage,
    emit(event: AgentEvent) {
      if (event.type === "sources") sources = event.items;
    },
  });
  const failures = grade(evalCase, {
    answer: summary.answer,
    mode: summary.mode,
    tools: summary.tools,
    sources,
  });
  if (live && summary.error) failures.push(`model error ${summary.error.name}`);
  if (failures.length === 0) passed++;
  console.log(
    `${failures.length === 0 ? "PASS" : "FAIL"}  ${evalCase.id}${failures.length ? `: ${failures.join("; ")}` : ""}`,
  );
}

console.log(
  `\n${passed}/${selected.length} passing (${live ? `live, ${model}` : "offline"})`,
);

await writeFile(
  new URL("../src/features/agent/eval-results.json", import.meta.url),
  `${JSON.stringify(
    {
      mode: live ? "live" : "offline",
      model: live ? model : null,
      passed,
      total: selected.length,
      ranAt: new Date().toISOString().slice(0, 10),
    },
    null,
    2,
  )}\n`,
);

if (passed < selected.length) process.exitCode = 1;
