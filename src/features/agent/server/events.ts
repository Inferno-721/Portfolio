export type AgentMode = "fast-path" | "agent" | "search";
export type TraceStage = "gate" | "model" | "tool" | "answer";
export type TraceStatus = "start" | "done" | "skip" | "error";

export type Source = { title: string; url: string };

export type ChatTurn = { role: "user" | "assistant"; text: string };

/** The stream the browser receives. Every trace event reflects real work on the server. */
export type AgentEvent =
  | {
      type: "trace";
      stage: TraceStage;
      status: TraceStatus;
      label: string;
      ms?: number;
    }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "sources"; items: Source[] }
  | {
      type: "done";
      mode: AgentMode;
      model: string | null;
      ms: number;
      tokens: number;
      tools: number;
    };
