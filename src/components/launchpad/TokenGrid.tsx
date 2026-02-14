import React from "react";
import type { LaunchpadTokenCard } from "../../services/launchpad/types";
import TokenCard from "./TokenCard";

interface TokenGridProps {
  items: LaunchpadTokenCard[];
  isLoading?: boolean;
  onOpen?: (token: LaunchpadTokenCard) => void;
  onBuy?: (token: LaunchpadTokenCard) => void;
}

const SkeletonCard = () => (
  <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-4 animate-pulse">
    <div className="flex items-center gap-3">
      <div className="h-11 w-11 rounded-full bg-slate-800" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-28 rounded bg-slate-800" />
        <div className="h-2.5 w-36 rounded bg-slate-800" />
      </div>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2">
      <div className="h-3 rounded bg-slate-800" />
      <div className="h-3 rounded bg-slate-800" />
      <div className="h-3 rounded bg-slate-800" />
      <div className="h-3 rounded bg-slate-800" />
    </div>
    <div className="mt-4 h-10 rounded bg-slate-800" />
    <div className="mt-4 h-8 rounded bg-slate-800" />
  </div>
);

const TokenGrid = ({ items, isLoading = false, onOpen, onBuy }: TokenGridProps) => {
  if (isLoading && !items.length) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, index) => (
          <SkeletonCard key={`launchpad-skeleton-${index}`} />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/45 px-5 py-10 text-center text-sm text-slate-400">
        No tokens match your filters.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((token) => (
        <TokenCard key={token.address} token={token} onOpen={onOpen} onBuy={onBuy} />
      ))}
    </div>
  );
};

export default React.memo(TokenGrid);
