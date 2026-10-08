import styles from "./styles.css?inline";
import { createWidget, type WidgetConfig } from "./ui";

/** Capture immediately — currentScript is null after async/deferred boot. */
const embedScript =
  document.currentScript instanceof HTMLScriptElement
    ? document.currentScript
    : document.querySelector<HTMLScriptElement>('script[src*="widget.js"]');

function readConfig(): WidgetConfig {
  const script =
    embedScript ??
    document.querySelector<HTMLScriptElement>('script[src*="widget.js"]');

  const api =
    script?.dataset.api ||
    (script?.src ? new URL(script.src).origin : window.location.origin);
  const model = script?.dataset.model || "llama3.2";
  const title = script?.dataset.title || "Asistent";
  const system = script?.dataset.system || undefined;

  return { api, model, title, system };
}

function boot(): void {
  createWidget(readConfig(), styles);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
