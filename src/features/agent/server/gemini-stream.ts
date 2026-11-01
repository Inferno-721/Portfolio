import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStreamLike, StreamMessage } from "./run-agent.ts";

/**
 * Runs the agent on Google's Gemini API. The agent loop is written against one message
 * shape, so this translates that shape to Gemini's REST format and back. It uses plain
 * fetch because streaming and function calling are all the agent needs.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 400;
const REFUSAL_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
]);

type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: unknown };
  functionResponse?: { id?: string; name: string; response: unknown };
};

type GeminiFrame = {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
};

/** A block that remembers the exact part Gemini sent, because signatures must go back. */
type BlockWithPart = { geminiPart?: GeminiPart };

export class GeminiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

type RequestParams = Parameters<StreamMessage>[0];

function toGeminiParts(
  content: Anthropic.Beta.BetaMessageParam["content"],
  toolNames: Map<string, string>,
): GeminiPart[] {
  if (typeof content === "string") return [{ text: content }];

  return (content ?? []).flatMap((block): GeminiPart[] => {
    const saved = (block as BlockWithPart).geminiPart;
    if (block.type === "tool_use") {
      toolNames.set(block.id, block.name);
      return [
        saved ?? { functionCall: { name: block.name, args: block.input } },
      ];
    }
    if (block.type === "text") return [saved ?? { text: block.text }];
    if (block.type === "tool_result") {
      const result =
        typeof block.content === "string" ? block.content : "No result";
      return [
        {
          functionResponse: {
            ...(block.tool_use_id.startsWith("gemini_")
              ? {}
              : { id: block.tool_use_id }),
            name: toolNames.get(block.tool_use_id) ?? "unknown",
            response: block.is_error ? { error: result } : { result },
          },
        },
      ];
    }
    return [];
  });
}

export function toGeminiRequest(params: RequestParams): object {
  const toolNames = new Map<string, string>();
  const system = typeof params.system === "string" ? params.system : "";
  const declarations = (params.tools ?? []).map((tool) => {
    const { name, description, input_schema } = tool as {
      name: string;
      description?: string;
      input_schema: unknown;
    };
    return { name, description, parametersJsonSchema: input_schema };
  });

  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: params.messages.map(({ role, content }) => ({
      role: role === "assistant" ? "model" : "user",
      parts: toGeminiParts(content, toolNames),
    })),
    tools: [{ functionDeclarations: declarations }],
    toolConfig: {
      functionCallingConfig: {
        mode: params.tool_choice?.type === "none" ? "NONE" : "AUTO",
      },
    },
    generationConfig: { maxOutputTokens: params.max_tokens },
  };
}

function stopReason(
  finishReason: string | undefined,
  blocked: boolean,
  hasToolCalls: boolean,
): Anthropic.Beta.BetaMessage["stop_reason"] {
  if (blocked || (finishReason && REFUSAL_REASONS.has(finishReason))) {
    return "refusal";
  }
  if (finishReason === "MAX_TOKENS") return "max_tokens";
  if (finishReason === "MALFORMED_FUNCTION_CALL") {
    throw new GeminiError(502, "Gemini returned a malformed function call");
  }
  return hasToolCalls ? "tool_use" : "end_turn";
}

async function send(
  model: string,
  apiKey: string,
  body: object,
  signal: AbortSignal,
): Promise<Response> {
  const url = `${API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      signal,
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return response;
    // A brief overload is worth one retry. A rate limit isn't, so it falls back to search.
    if (response.status >= 500 && attempt === 0) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }
    throw new GeminiError(
      response.status,
      `Gemini returned ${response.status}`,
    );
  }
}

async function* readFrames(response: Response): AsyncGenerator<GeminiFrame> {
  if (!response.body)
    throw new GeminiError(502, "Gemini sent no response body");
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (frame.startsWith("data: ")) {
        yield JSON.parse(frame.slice(6)) as GeminiFrame;
      }
    }
  }
  if (buffer.startsWith("data: ")) {
    yield JSON.parse(buffer.slice(6)) as GeminiFrame;
  }
}

/** Pass the key in explicitly. It goes in a header, never in the URL, so logs can't leak it. */
export function createGeminiStream(apiKey: string): StreamMessage {
  return (params, callerSignal) => {
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS);

    let resolveFinal: (message: Anthropic.Beta.BetaMessage) => void;
    let rejectFinal: (reason: unknown) => void;
    const final = new Promise<Anthropic.Beta.BetaMessage>((resolve, reject) => {
      resolveFinal = resolve;
      rejectFinal = reject;
    });
    // Whoever consumes the stream sees errors first, so this copy must not go unhandled.
    final.catch(() => {});

    async function* events() {
      try {
        const response = await send(
          String(params.model),
          apiKey,
          toGeminiRequest(params),
          signal,
        );

        const content: (Anthropic.Beta.BetaContentBlock & BlockWithPart)[] = [];
        let text = "";
        let textPart: GeminiPart | undefined;
        let finishReason: string | undefined;
        let blocked = false;
        let usage: GeminiFrame["usageMetadata"] = {};
        let modelVersion = String(params.model);
        let toolIndex = 0;

        for await (const frame of readFrames(response)) {
          const candidate = frame.candidates?.[0];
          finishReason = candidate?.finishReason ?? finishReason;
          blocked ||= Boolean(frame.promptFeedback?.blockReason);
          usage = frame.usageMetadata ?? usage;
          modelVersion = frame.modelVersion ?? modelVersion;

          for (const part of candidate?.content?.parts ?? []) {
            if (part.functionCall) {
              content.push({
                type: "tool_use",
                id: part.functionCall.id ?? `gemini_${toolIndex}`,
                name: part.functionCall.name,
                input: part.functionCall.args ?? {},
                geminiPart: part,
              } as Anthropic.Beta.BetaContentBlock & BlockWithPart);
              toolIndex++;
            } else if (part.text && !part.thought) {
              text += part.text;
              textPart = part.thoughtSignature ? part : textPart;
              yield {
                type: "content_block_delta" as const,
                index: 0,
                delta: { type: "text_delta" as const, text: part.text },
              };
            }
          }
        }

        const blocks = text
          ? [
              {
                type: "text",
                text,
                ...(textPart
                  ? {
                      geminiPart: {
                        text,
                        thoughtSignature: textPart.thoughtSignature,
                      },
                    }
                  : {}),
              } as Anthropic.Beta.BetaContentBlock & BlockWithPart,
              ...content,
            ]
          : content;

        const cached = usage?.cachedContentTokenCount ?? 0;
        resolveFinal!({
          model: modelVersion,
          content: blocks,
          stop_reason: stopReason(finishReason, blocked, content.length > 0),
          usage: {
            input_tokens: (usage?.promptTokenCount ?? 0) - cached,
            output_tokens:
              (usage?.candidatesTokenCount ?? 0) +
              (usage?.thoughtsTokenCount ?? 0),
            cache_read_input_tokens: cached,
          },
        } as Anthropic.Beta.BetaMessage);
      } catch (error) {
        rejectFinal!(error);
        throw error;
      }
    }

    const stream = {
      [Symbol.asyncIterator]: events,
      finalMessage: () => final,
    };
    return stream as unknown as MessageStreamLike;
  };
}
