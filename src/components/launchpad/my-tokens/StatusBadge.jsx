import React from "react";

const TONE_CLASS = {
  neutral: "border-slate-600/70 bg-slate-900/70 text-slate-300",
  good: "border-emerald-400/45 bg-emerald-500/15 text-emerald-100",
  warn: "border-amber-400/45 bg-amber-500/15 text-amber-100",
  info: "border-cyan-300/50 bg-cyan-500/15 text-cyan-100",
};

export default function StatusBadge({
  label,
  icon = null,
  iconOnly = false,
  tone = "neutral",
  title = "",
  ariaLabel = "",
}) {
  const toneClass = TONE_CLASS[tone] || TONE_CLASS.neutral;
  const resolvedAria = String(ariaLabel || label || title || "").trim();
  return (
    <span
      title={title || label || ""}
      aria-label={resolvedAria || undefined}
      className={`inline-flex h-6 flex-none items-center justify-center gap-1 whitespace-nowrap rounded-full border text-[11px] font-semibold leading-none ${toneClass} ${
        iconOnly ? "w-6 min-w-6 px-0" : "px-2"
      }`}
    >
      {icon ? <span className="inline-flex items-center justify-center">{icon}</span> : null}
      {!iconOnly ? <span>{label}</span> : null}
      {iconOnly && resolvedAria ? <span className="sr-only">{resolvedAria}</span> : null}
    </span>
  );
}

