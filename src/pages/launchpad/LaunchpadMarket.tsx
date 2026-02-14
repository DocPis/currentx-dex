import React, { useEffect, useMemo, useRef, useState } from "react";
import TokenGrid from "../../components/launchpad/TokenGrid";
import FiltersBar from "../../components/launchpad/FiltersBar";
import SortSelect from "../../components/launchpad/SortSelect";
import LiveBuysFeed from "../../components/launchpad/LiveBuysFeed";
import {
  useLaunchpadTokens,
  useLiveBuys,
  useHasLaunchpadBackend,
} from "../../services/launchpad/hooks";
import type { LaunchpadFilter, LaunchpadSort } from "../../services/launchpad/types";

type StudioView = "create" | "deployments" | "vault" | "locker";

interface LaunchpadMarketProps {
  onOpenToken: (tokenAddress: string) => void;
  onOpenStudio?: (view: StudioView) => void;
  activeStudioView?: StudioView;
}

const studioItems: Array<{ id: StudioView; label: string; hint: string }> = [
  { id: "create", label: "Create Token", hint: "Deploy a new token" },
  { id: "deployments", label: "My Tokens", hint: "View your deployed tokens" },
  { id: "vault", label: "Vault", hint: "Active locks + deposit" },
  { id: "locker", label: "Locker", hint: "LP pair + collect fees" },
];

const LaunchpadMarket = ({ onOpenToken, onOpenStudio, activeStudioView }: LaunchpadMarketProps) => {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<LaunchpadFilter[]>([]);
  const [sort, setSort] = useState<LaunchpadSort>("mcap");
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const {
    items,
    total,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetching,
    isMocked,
  } = useLaunchpadTokens({
    q: query,
    sort,
    filters: activeFilters,
    pageSize: 18,
  });

  const liveBuys = useLiveBuys({ limit: 18, enabled: true });
  const hasBackend = useHasLaunchpadBackend();

  const dynamicTags = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      (item.tags || []).forEach((tag) => {
        const key = String(tag || "").trim().toLowerCase();
        if (!key) return;
        map.set(key, (map.get(key) || 0) + 1);
      });
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map((entry) => entry[0]);
  }, [items]);

  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            void fetchNextPage();
          }
        });
      },
      {
        rootMargin: "240px 0px",
      }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const toggleFilter = (filter: LaunchpadFilter) => {
    setActiveFilters((prev) => {
      if (prev.includes(filter)) {
        return prev.filter((item) => item !== filter);
      }
      return [...prev, filter];
    });
  };

  return (
    <section className="px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <header className="rounded-2xl border border-slate-800/80 bg-slate-950/45 p-5 shadow-[0_16px_36px_rgba(2,6,23,0.55)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold text-slate-100">Launchpad</h1>
              <p className="mt-1 text-sm text-slate-400">
                Discover tokens launched on CurrentX and trade directly from the marketplace.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                  hasBackend
                    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-400/35 bg-amber-500/10 text-amber-200"
                }`}
              >
                {isMocked ? "Mock data" : "API"}
              </span>
              <SortSelect value={sort} onChange={setSort} />
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500">{total.toLocaleString()} tokens indexed</div>
        </header>

        <section className="rounded-2xl border border-slate-800/80 bg-slate-950/35 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-100">Token Studio</h2>
              <p className="mt-1 text-sm text-slate-400">
                Deploy and manage launch settings from the legacy launchpad tools.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenStudio?.("create")}
              className="inline-flex items-center rounded-full border border-cyan-400/45 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-500/20"
            >
              {activeStudioView ? "Studio open" : "Open studio"}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {studioItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenStudio?.(item.id)}
                className={`rounded-2xl border bg-slate-950/65 px-4 py-3 text-left transition hover:border-cyan-300/45 hover:bg-slate-900/80 ${
                  activeStudioView === item.id
                    ? "border-cyan-300/55 bg-cyan-500/10"
                    : "border-slate-800/80"
                }`}
                aria-pressed={activeStudioView === item.id}
              >
                <div className="font-display text-base font-semibold text-slate-100">{item.label}</div>
                <div className="mt-1 text-xs text-slate-400">{item.hint}</div>
              </button>
            ))}
          </div>
        </section>

        <div className="lg:hidden">
          <LiveBuysFeed
            items={liveBuys.items}
            isLoading={liveBuys.isLoading}
            mode={liveBuys.mode}
            onSelectToken={onOpenToken}
          />
        </div>

        <FiltersBar
          query={query}
          onQueryChange={setQuery}
          activeFilters={activeFilters}
          onToggleFilter={toggleFilter}
          dynamicTags={dynamicTags}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <TokenGrid
              items={items}
              isLoading={isLoading}
              onOpen={(token) => onOpenToken(token.address)}
              onBuy={(token) => onOpenToken(token.address)}
            />

            <div ref={loadMoreRef} />

            {isFetchingNextPage && (
              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/45 px-4 py-3 text-center text-xs text-slate-400">
                Loading more tokens...
              </div>
            )}
            {!hasNextPage && items.length > 0 && (
              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/45 px-4 py-3 text-center text-xs text-slate-500">
                You reached the end of the list.
              </div>
            )}
            {isFetching && !isLoading && (
              <div className="text-center text-[11px] text-slate-500">Refreshing market snapshots...</div>
            )}
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-24">
              <LiveBuysFeed
                items={liveBuys.items}
                isLoading={liveBuys.isLoading}
                mode={liveBuys.mode}
                onSelectToken={onOpenToken}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LaunchpadMarket;
