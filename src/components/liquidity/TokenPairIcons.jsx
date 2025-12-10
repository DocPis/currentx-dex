// src/components/liquidity/TokenPairIcons.jsx

import { TOKEN_ICONS } from "../../utils/tokenIcons";

/**
 * Mostra i due cerchi con i loghi dei token (tipo Aerodrome/Velodrome).
 */
export default function TokenPairIcons({ tokens }) {
  return (
    <div className="flex -space-x-1.5">
      {tokens.map((sym) => {
        const src = TOKEN_ICONS[sym];

        if (!src) {
          return (
            <span
              key={sym}
              className="h-6 w-6 rounded-full bg-slate-700 border border-slate-950"
            />
          );
        }

        return (
          <img
            key={sym}
            src={src}
            alt={sym}
            className="h-6 w-6 rounded-full border border-slate-950 bg-slate-900 object-cover shadow-md"
          />
        );
      })}
    </div>
  );
}
