import React from "react";
import type { LaunchpadTokenCard } from "../../services/launchpad/types";
import { formatPercent, formatUsd, shortAddress } from "../../services/launchpad/utils";
import LpLockedBadge from "./LpLockedBadge";
import PriceSparkline from "./PriceSparkline";
import TokenLogo from "./TokenLogo";

interface TokenCardProps {
  token: LaunchpadTokenCard;
  onOpen?: (token: LaunchpadTokenCard) => void;
  onBuy?: (token: LaunchpadTokenCard) => void;
}

const TokenCard = ({ token, onOpen, onBuy }: TokenCardProps) => {
  const changeUp = Number(token.market?.change24h || 0) >= 0;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4 shadow-[0_14px_34px_rgba(2,6,23,0.5)] backdrop-blur transition hover:border-slate-600/80 hover:bg-slate-900/65">
      <div className="flex items-start gap-3">
        <TokenLogo
          address={token.address}
          symbol={token.symbol}
          logoUrl={token.logoUrl}
          className="h-11 w-11 rounded-full border border-slate-700/70 bg-slate-900 object-cover"
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen?.(token)}
            className="flex w-full min-w-0 items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-slate-100">{token.name}</span>
            {token.lpLocked === true ? <LpLockedBadge /> : null}
          </button>
          <div className="mt-1 text-xs text-slate-400">
            ${token.symbol} - {shortAddress(token.address)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <div className="text-slate-500">Price</div>
          <div className="font-semibold text-slate-100">{formatUsd(token.market?.priceUSD)}</div>
        </div>
        <div>
          <div className="text-slate-500">24h</div>
          <div className={`font-semibold ${changeUp ? "text-emerald-300" : "text-rose-300"}`}>
            {formatPercent(token.market?.change24h)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">MCap</div>
          <div className="text-slate-200">{formatUsd(token.market?.mcapUSD)}</div>
        </div>
        <div>
          <div className="text-slate-500">Liquidity</div>
          <div className="text-slate-200">{formatUsd(token.market?.liquidityUSD)}</div>
        </div>
        <div>
          <div className="text-slate-500">Volume 24h</div>
          <div className="text-slate-200">{formatUsd(token.market?.volume24hUSD)}</div>
        </div>
        <div>
          <div className="text-slate-500">Buys/min</div>
          <div className="text-slate-200">{token.buysPerMinute.toFixed(1)}</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-800/80 bg-slate-950/40 p-2">
        <PriceSparkline values={token.sparkline} className="h-10 w-full" />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => onBuy?.(token)}
          className="w-full rounded-xl border border-sky-400/70 bg-gradient-to-r from-sky-500/35 to-cyan-500/30 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:brightness-110"
        >
          Buy {token.symbol}
        </button>
      </div>
    </article>
  );
};

export default React.memo(TokenCard);
