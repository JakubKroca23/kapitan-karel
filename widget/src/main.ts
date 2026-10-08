import styles from "./styles.css?inline";
import { createWidget, type WelcomeAction, type WidgetConfig } from "./ui";

/** Capture immediately — currentScript is null after async/deferred boot. */
const embedScript =
  document.currentScript instanceof HTMLScriptElement
    ? document.currentScript
    : document.querySelector<HTMLScriptElement>('script[src*="widget.js"]');

function parseActions(raw: string | undefined): WelcomeAction[] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(
      (a): a is WelcomeAction =>
        !!a &&
        typeof a === "object" &&
        typeof (a as WelcomeAction).label === "string" &&
        (!!(a as WelcomeAction).prompt || !!(a as WelcomeAction).href),
    );
  } catch {
    return undefined;
  }
}

function readConfig(): WidgetConfig {
  const script =
    embedScript ??
    document.querySelector<HTMLScriptElement>('script[src*="widget.js"]');

  const api =
    script?.dataset.api ||
    (script?.src ? new URL(script.src).origin : window.location.origin);
  const model = script?.dataset.model || "gemini-3.5-flash-lite";
  const title = script?.dataset.title || "Kapitán Karel";
  const system =
    script?.dataset.system ||
    "Jsi Kapitán Karel, věcný asistent. Odpovídej stručně a srozumitelně česky. " +
      "Opírej se o živý kontext stránky. Nevymýšlej fakta.";
  const welcome = script?.dataset.welcome || undefined;
  const actions = parseActions(script?.dataset.actions);

  return { api, model, title, system, welcome, actions };
}

function boot(): void {
  createWidget(readConfig(), styles);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
