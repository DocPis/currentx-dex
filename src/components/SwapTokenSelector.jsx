// src/components/SwapTokenSelector.jsx
import { useState } from "react";
import { TOKENS, AVAILABLE_TOKENS } from "../config/tokenRegistry";

/**
 * Selettore di token riusabile (dropdown + logo).
 *
 * Props:
 * - value: simbolo attuale (es. "ETH")
 * - onChange: funzione(newSymbol) chiamata quando scegli un token
 * - availableTokens (opzionale): array di simboli, default AVAILABLE_TOKENS
 * - tokensConfig (opzionale): mappa simbolo -> config, default TOKENS
 */
export default function SwapTokenSelector({
  value,
  onChange,
  availableTokens = AVAILABLE_TOKENS,
  tokensConfig = TOKENS,
}) {
  const [open, setOpen] = useState(false);

  const currentToken = tokensConfig[value];

  const handleSelect = (sym) => {
    if (sym === value) return;
    onChange(sym);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5 text-[12px] text-slate-100 border border-slate-700"
      >
        {currentToken?.logo && (
          <img
            src={currentToken.logo}
            alt={currentToken.symbol}
            className="h-5 w-5 rounded-full"
          />
        )}
        <span>{currentToken?.symbol ?? value}</span>
        <span className="text-[10px] text-slate-400">▼</span>
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-40 rounded-xl border border-slate-700 bg-slate-900 shadow-xl z-20">
          {availableTokens.map((sym) => {
            const t = tokensConfig[sym];
            const isSelected = sym === value;
            return (
              <button
                key={sym}
                type="button"
                disabled={isSelected}
                onClick={() => handleSelect(sym)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] ${
                  isSelected
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                {t?.logo && (
                  <img
                    src={t.logo}
                    alt={sym}
                    className="h-5 w-5 rounded-full"
                  />
                )}
                <span>{sym}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
