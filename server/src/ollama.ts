import type { ChatMessage, ChatRequest } from "./types.js";

export type { ChatMessage, ChatRequest };

function getBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
}

export function getDefaultModel(): string {
  return process.env.OLLAMA_DEFAULT_MODEL ?? process.env.DEFAULT_MODEL ?? "qwen2.5:3b-32k";
}

function getNumCtx(): number {
  const raw = Number(process.env.OLLAMA_NUM_CTX ?? 8192);
  if (!Number.isFinite(raw) || raw < 1024) return 8192;
  return Math.min(Math.floor(raw), 32768);
}

function getMaxTokens(): number {
  const raw = Number(process.env.OLLAMA_MAX_TOKENS ?? 768);
  if (!Number.isFinite(raw) || raw < 32) return 768;
  return Math.min(Math.floor(raw), 4096);
}

export async function checkOllamaHealth(): Promise<{
  ok: boolean;
  models?: string[];
  error?: string;
}> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/tags`);
    if (!res.ok) {
      return { ok: false, error: `Ollama responded with ${res.status}` };
    }
    const data = (await res.json()) as {
      models?: Array<{ name: string }>;
    };
    return {
      ok: true,
      models: (data.models ?? []).map((m) => m.name),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function streamChat(request: ChatRequest): Promise<Response> {
  const model = request.model || getDefaultModel();
  const num_ctx = getNumCtx();
  const max_tokens = getMaxTokens();

  const res = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: request.messages,
      stream: true,
      max_tokens,
      options: {
        num_ctx,
        temperature: 0.4,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Ollama chat failed (${res.status}): ${text || res.statusText}`,
    );
  }

  return res;
}
