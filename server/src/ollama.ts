export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  model?: string;
};

function getBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
}

export function getDefaultModel(): string {
  return process.env.DEFAULT_MODEL ?? "llama3.2";
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

/** Stream chat completions from Ollama's OpenAI-compatible API. */
export async function streamChat(
  request: ChatRequest,
): Promise<Response> {
  const model = request.model || getDefaultModel();
  const res = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: request.messages,
      stream: true,
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
