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
  const model = script?.dataset.model || "qwen2.5:3b";
  const title = script?.dataset.title || "Kapitán Karel";
  const system =
    script?.dataset.system ||
    "Jsi Kapitán Karel, přátelský pirátský robot-asistent za volantem. Odpovídej stručně česky.";

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
