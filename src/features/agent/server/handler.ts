import type { ChatTurn } from "./events.ts";
import type { Knowledge } from "./knowledge.ts";
import { createDailyBudget, createRateLimiter } from "./rate-limit.ts";
import { runAgent, type StreamMessage } from "./run-agent.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";

const MAX_BODY_BYTES = 8_000;
const MAX_QUESTION_LENGTH = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_TURN_LENGTH = 1_500;
const REQUESTS_PER_MINUTE = 8;
const REQUESTS_PER_DAY = 60;
// A question can take up to 3 model calls, so this stays under a free daily quota.
const QUESTIONS_PER_DAY_FOR_MODEL = 150;

export type AgentRequestContext = {
  clientAddress: string;
  streamMessage: StreamMessage | null;
  model: string;
};

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).host === new URL(request.url).host;
}

type Parsed = { question: string; history: ChatTurn[] };

function parseBody(raw: string): Parsed | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || !("question" in body))
    return null;

  const { question } = body;
  if (typeof question !== "string") return null;
  const trimmed = question.trim();
  if (!trimmed || trimmed.length > MAX_QUESTION_LENGTH) return null;

  const rawHistory =
    "history" in body && Array.isArray(body.history) ? body.history : [];
  const history = rawHistory
    .slice(-MAX_HISTORY_TURNS)
    .flatMap((turn: unknown): ChatTurn[] => {
      if (typeof turn !== "object" || turn === null) return [];
      if (!("role" in turn) || !("text" in turn)) return [];
      const { role, text } = turn;
      if ((role !== "user" && role !== "assistant") || typeof text !== "string")
        return [];
      if (!text.trim() || text.length > MAX_TURN_LENGTH) return [];
      return [{ role, text }];
    });
  // The API requires the conversation to open with a user turn.
  while (history[0]?.role === "assistant") history.shift();

  return { question: trimmed, history };
}

export function createAgentHandler(knowledge: Knowledge) {
  const allow = createRateLimiter(REQUESTS_PER_MINUTE, REQUESTS_PER_DAY);
  const spendBudget = createDailyBudget(QUESTIONS_PER_DAY_FOR_MODEL);

  return async function handle(
    request: Request,
    { clientAddress, streamMessage, model }: AgentRequestContext,
  ): Promise<Response> {
    if (!isSameOrigin(request))
      return json(403, { error: "Cross-origin requests aren't allowed." });

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES)
      return json(413, { error: "That message is too long." });

    const parsed = parseBody(raw);
    if (!parsed) {
      return json(400, {
        error: `Send a question of at most ${MAX_QUESTION_LENGTH} characters.`,
      });
    }

    if (!allow(clientAddress)) {
      return json(429, {
        error: "That's a lot of questions. Try again in a minute.",
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const summary = await runAgent({
          ...parsed,
          knowledge,
          model,
          streamMessage: streamMessage && spendBudget() ? streamMessage : null,
          signal: request.signal,
          emit(event) {
            if (request.signal.aborted) return;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          },
        });
        // Metadata only: visitors' questions and addresses are not logged.
        console.log(
          JSON.stringify({
            event: "agent_request",
            mode: summary.mode,
            model: summary.mode === "agent" ? model : null,
            tools: summary.tools,
            input_tokens: summary.inputTokens,
            output_tokens: summary.outputTokens,
            cache_read_tokens: summary.cacheReadTokens,
            stop_reason: summary.stopReason,
            error: summary.error,
            ms: summary.ms,
          }),
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  };
}
