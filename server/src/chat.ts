import {
  checkGeminiHealth,
  getGeminiModel,
  streamGeminiChat,
} from "./gemini.js";
import {
  checkOllamaHealth,
  getDefaultModel as getOllamaModel,
  streamChat as streamOllamaChat,
} from "./ollama.js";
import type { ChatRequest } from "./types.js";

export type ChatProvider = "gemini" | "ollama";

export function getChatProvider(): ChatProvider {
  const raw = (process.env.CHAT_PROVIDER || "gemini").trim().toLowerCase();
  return raw === "ollama" ? "ollama" : "gemini";
}

export function getDefaultModel(): string {
  return getChatProvider() === "gemini" ? getGeminiModel() : getOllamaModel();
}

export async function checkChatHealth() {
  const provider = getChatProvider();
  if (provider === "gemini") {
    const health = await checkGeminiHealth();
    return {
      ...health,
      provider,
      defaultModel: getDefaultModel(),
    };
  }
  const health = await checkOllamaHealth();
  return {
    ...health,
    provider,
    defaultModel: getDefaultModel(),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  };
}

export async function streamChat(request: ChatRequest): Promise<Response> {
  if (getChatProvider() === "gemini") {
    return streamGeminiChat(request);
  }
  return streamOllamaChat(request);
}
