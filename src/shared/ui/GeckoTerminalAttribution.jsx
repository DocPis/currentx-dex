import React from "react";
import {
  GECKOTERMINAL_URL,
  SHOW_GECKOTERMINAL_ATTRIBUTION,
} from "./geckoTerminalConfig";

const BASE_LINK_CLASS =
  "text-[12px] text-slate-300/70 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";

export function GeckoTerminalAttributionLink({ text, className = "" }) {
  if (!SHOW_GECKOTERMINAL_ATTRIBUTION) return null;
  return (
    <a
      href={GECKOTERMINAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`${BASE_LINK_CLASS} ${className}`.trim()}
    >
      {text}
    </a>
  );
}
