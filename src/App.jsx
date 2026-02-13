// src/App.jsx
import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useDisconnect, useReconnect } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import Header from "./shared/ui/Header";
import { useWallet } from "./shared/hooks/useWallet";
import { useBalances } from "./shared/hooks/useBalances";
import WalletModal from "./features/wallet/WalletModal";
import Footer from "./shared/ui/Footer";
import SeasonBanner from "./shared/ui/SeasonBanner";

const TAB_ROUTES = {
  dashboard: "/dashboard",
  points: "/points",
  swap: "/swap",
  liquidity: "/liquidity",
  launchpad: "/launchpad",
  pools: "/pools",
  farms: "/farms",
  megavault: "/megavault",
};

const SECTION_LOADERS = {
  dashboard: () => import("./features/dashboard/Dashboard"),
  points: () => import("./features/points/PointsPage"),
  swap: () => import("./features/swap/SwapSection"),
  liquidity: () => import("./features/liquidity/LiquiditySection"),
  launchpad: () => import("./features/launchpad/LaunchpadSection"),
  pools: () => import("./features/pools/PoolsSection"),
  farms: () => import("./features/farms/Farms"),
  megavault: () => import("./features/megavault/MegaVaultSection"),
};

const Dashboard = React.lazy(SECTION_LOADERS.dashboard);
const PointsPage = React.lazy(SECTION_LOADERS.points);
const SwapSection = React.lazy(SECTION_LOADERS.swap);
const LiquiditySection = React.lazy(SECTION_LOADERS.liquidity);
const LaunchpadSection = React.lazy(SECTION_LOADERS.launchpad);
const PoolsSection = React.lazy(SECTION_LOADERS.pools);
const Farms = React.lazy(SECTION_LOADERS.farms);
const MegaVaultSection = React.lazy(SECTION_LOADERS.megavault);

const normalizePath = (path = "") => {
  const cleaned = String(path || "").toLowerCase().replace(/\/+$/u, "");
  return cleaned || "/";
};

const getTabFromPath = (path = "") => {
  const cleaned = normalizePath(path);
  if (cleaned === "/") return "dashboard";
  const match = Object.entries(TAB_ROUTES).find(([, route]) => route === cleaned);
  return match ? match[0] : "dashboard";
};

const getPathForTab = (tab) => TAB_ROUTES[tab] || "/dashboard";

const initialPath = (typeof window !== "undefined" && window.location?.pathname) || "";
const initialTab = getTabFromPath(initialPath);
if (SECTION_LOADERS[initialTab]) {
  SECTION_LOADERS[initialTab]();
}

const PREFETCH_PAGE_SIZE = 50;
const getNextPageParam = (lastPage, pages) =>
  lastPage && lastPage.length === PREFETCH_PAGE_SIZE
    ? pages.length * PREFETCH_PAGE_SIZE
    : undefined;
const normalizePoolIds = (ids = []) =>
  Array.from(
    new Set(
      (ids || [])
        .map((id) => String(id || "").toLowerCase())
        .filter(Boolean)
    )
  );
const buildPoolIdsKey = (ids = []) => ids.slice().sort().join(",");

export default function App() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(() =>
    getTabFromPath(window?.location?.pathname)
  );
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [poolSelection, setPoolSelection] = useState(null);
  const { address, chainId, connect, disconnect: walletDisconnect } = useWallet();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { reconnect } = useReconnect();
  const { balances, refresh } = useBalances(address, chainId);
  const preloadedRef = useRef(new Set());
  const prefetchedDataRef = useRef(new Set());

  useEffect(() => {
    const handlePop = () => {
      const nextTab = getTabFromPath(window?.location?.pathname);
      setTab((prev) => (prev === nextTab ? prev : nextTab));
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    const targetPath = getPathForTab(tab);
    const currentPath = normalizePath(window?.location?.pathname);
    if (currentPath !== targetPath) {
      const suffix = `${window?.location?.search || ""}${window?.location?.hash || ""}`;
      window.history.pushState({}, "", `${targetPath}${suffix}`);
    }
  }, [tab]);
  useEffect(() => {
    if (!connectError) return undefined;
    const id = setTimeout(() => setConnectError(""), 4000);
    return () => clearTimeout(id);
  }, [connectError]);

  const canPrefetchData = useCallback(() => {
    const connection = navigator?.connection;
    if (connection?.saveData) return false;
    const effectiveType = String(connection?.effectiveType || "");
    if (effectiveType.includes("2g")) return false;
    return true;
  }, []);

  const prefetchTokenData = useCallback(async () => {
    try {
      const [{ TOKENS }, subgraph] = await Promise.all([
        import("./shared/config/tokens"),
        import("./shared/config/subgraph"),
      ]);
      const addresses = Object.values(TOKENS || {})
        .map((t) => t?.address)
        .filter(Boolean);
      if (!addresses.length) return;
      const unique = Array.from(new Set(addresses.map((a) => a.toLowerCase())));
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: ["token-prices", "registry"],
          queryFn: () => subgraph.fetchTokenPrices(unique),
        }),
        queryClient.prefetchQuery({
          queryKey: ["token-tvls", "registry"],
          queryFn: () => subgraph.fetchV3TokenTvls(unique),
        }),
      ]);
    } catch {
      // ignore prefetch failures
    }
  }, [queryClient]);

  const prefetchPoolsData = useCallback(async () => {
    try {
      const subgraph = await import("./shared/config/subgraph");
      const prefetchV3 = queryClient.prefetchInfiniteQuery({
        queryKey: ["pools", "v3"],
        queryFn: ({ pageParam = 0 }) =>
          subgraph.fetchV3PoolsPage({
            limit: PREFETCH_PAGE_SIZE,
            skip: pageParam,
          }),
        initialPageParam: 0,
        getNextPageParam,
      });
      const prefetchV2 = queryClient.prefetchInfiniteQuery({
        queryKey: ["pools", "v2"],
        queryFn: ({ pageParam = 0 }) =>
          subgraph.fetchV2PoolsPage({
            limit: PREFETCH_PAGE_SIZE,
            skip: pageParam,
          }),
        initialPageParam: 0,
        getNextPageParam,
      });

      await prefetchV3;

      const v3Data = queryClient.getQueryData(["pools", "v3"]);
      const v3Ids = normalizePoolIds((v3Data?.pages?.flat() || []).map((p) => p?.id));
      if (v3Ids.length) {
        const v3IdsKey = buildPoolIdsKey(v3Ids);
        await queryClient.prefetchQuery({
          queryKey: ["pools", "v3-roll-24h", v3IdsKey],
          queryFn: async () => {
            const dayData = await subgraph.fetchV3PoolsDayData(v3Ids);
            const missingIds = v3Ids.filter((id) => !dayData?.[id]);
            if (!missingIds.length) return dayData || {};
            const hourData = await subgraph.fetchV3PoolsHourData(missingIds, 24);
            return {
              ...(dayData || {}),
              ...(hourData || {}),
            };
          },
        });
      }

      void (async () => {
        try {
          await prefetchV2;
          const v2Data = queryClient.getQueryData(["pools", "v2"]);
          const v2Ids = normalizePoolIds((v2Data?.pages?.flat() || []).map((p) => p?.id));
          if (!v2Ids.length) return;
          const v2IdsKey = buildPoolIdsKey(v2Ids);
          await queryClient.prefetchQuery({
            queryKey: ["pools", "v2-roll-24h", v2IdsKey],
            queryFn: async () => {
              const dayData = await subgraph.fetchV2PoolsDayData(v2Ids);
              const missingIds = v2Ids.filter((id) => !dayData?.[id]);
              if (!missingIds.length) return dayData || {};
              const hourData = await subgraph.fetchV2PoolsHourData(missingIds, 24);
              return {
                ...(dayData || {}),
                ...(hourData || {}),
              };
            },
          });
        } catch {
          // ignore background prefetch failures
        }
      })();
    } catch {
      // ignore prefetch failures
    }
  }, [queryClient]);

  const prefetchTabData = useCallback(
    (target) => {
      if (!canPrefetchData()) return;
      if (!target || prefetchedDataRef.current.has(target)) return;
      prefetchedDataRef.current.add(target);
      if (target === "pools") {
        void prefetchPoolsData();
      }
      if (target === "swap" || target === "liquidity") {
        void prefetchTokenData();
      }
    },
    [canPrefetchData, prefetchPoolsData, prefetchTokenData]
  );

  const preloadSection = (id) => {
    const loader = SECTION_LOADERS[id];
    if (!loader || preloadedRef.current.has(id)) return;
    preloadedRef.current.add(id);
    loader();
  };

  useEffect(() => {
    const connection = navigator?.connection;
    const saveData = Boolean(connection?.saveData);
    const effectiveType = String(connection?.effectiveType || "");
    const lowBandwidth = effectiveType.includes("2g");
    if (saveData || lowBandwidth) return undefined;

    const idle =
      window.requestIdleCallback ||
      ((cb) => window.setTimeout(() => cb({ timeRemaining: () => 0 }), 800));
    const cancelIdle =
      window.cancelIdleCallback || ((id) => window.clearTimeout(id));

    const handle = idle(() => {
      Object.keys(SECTION_LOADERS).forEach((key) => {
        if (key !== tab) preloadSection(key);
      });
      ["swap", "liquidity", "pools"].forEach((key) => {
        if (key !== tab) prefetchTabData(key);
      });
    }, { timeout: 1500 });

    return () => cancelIdle(handle);
  }, [prefetchTabData, tab]);


  const handleConnect = () => {
    setShowWalletModal(true);
  };

  const handleDisconnect = async () => {
    wagmiDisconnect();
    walletDisconnect();
    await refresh(null);
  };

  const handleWalletSelect = async (walletId) => {
    try {
      const connectedAddress = await connect(walletId);
      reconnect();
      await refresh(connectedAddress);
      setShowWalletModal(false);
      setConnectError("");
    } catch (e) {
      const msg =
        e?.code === 4001 || e?.code === "ACTION_REJECTED"
          ? "Request rejected in wallet. Please approve to continue."
          : e?.message || "Failed to connect wallet";
      setConnectError(msg);
    }
  };

  const handlePoolSelect = (pool) => {
    setPoolSelection(pool || null);
    preloadSection("liquidity");
    prefetchTabData("liquidity");
    setTab("liquidity");
  };

  const handleTabClick = (nextTab) => {
    preloadSection(nextTab);
    prefetchTabData(nextTab);
    setTab(nextTab);
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-transparent text-slate-50">
      <SeasonBanner onClick={() => handleTabClick("points")} />
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-28 top-20 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute right-[-8rem] top-[18rem] h-[22rem] w-[22rem] rounded-full bg-sky-500/15 blur-3xl" />
      </div>
      {connectError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="flex min-w-[260px] items-start gap-3 rounded-2xl border border-rose-500/45 bg-slate-950/90 px-4 py-3 text-rose-100 shadow-2xl shadow-rose-900/40 backdrop-blur">
            <div className="h-2 w-2 mt-1.5 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(248,113,113,0.7)]" />
            <div className="text-sm">
              <div className="font-display font-semibold text-rose-100">Connection rejected</div>
              <div className="text-rose-200/80 text-xs">{connectError}</div>
            </div>
            <button
              type="button"
              onClick={() => setConnectError("")}
              className="ml-auto text-rose-200/70 hover:text-rose-100"
              aria-label="Dismiss"
            >
              X
            </button>
          </div>
        </div>
      )}
      <Header
        address={address}
        chainId={chainId}
        onConnect={handleConnect}
        onSwitchWallet={() => setShowWalletModal(true)}
        onDisconnect={handleDisconnect}
        balances={balances}
      />

      {/* Tabs */}
      <div className="cx-fade-up px-4 pt-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap justify-center gap-2 rounded-3xl border border-slate-700/40 bg-slate-900/45 p-2 text-xs shadow-[0_24px_60px_rgba(2,6,23,0.55)] backdrop-blur-xl sm:text-sm">
          {[
            { id: "dashboard", label: "Dashboard" },
            { id: "swap", label: "Swap" },
            { id: "liquidity", label: "Liquidity" },
            { id: "pools", label: "Pools" },
            { id: "points", label: "Points" },
            { id: "farms", label: "Farms" },
            { id: "megavault", label: "MegaVault" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => handleTabClick(item.id)}
              onMouseEnter={() => {
                preloadSection(item.id);
                prefetchTabData(item.id);
              }}
              onFocus={() => {
                preloadSection(item.id);
                prefetchTabData(item.id);
              }}
              className={`cx-tab-button rounded-2xl border px-4 py-2.5 font-display text-[11px] tracking-wide transition sm:text-xs ${
                tab === item.id
                  ? "cx-tab-button-active border-sky-400/80 bg-gradient-to-r from-sky-500/20 via-cyan-400/20 to-emerald-400/15 text-sky-50 shadow-[0_10px_30px_rgba(56,189,248,0.22)]"
                  : "border-slate-700/60 bg-slate-900/65 text-slate-300 hover:border-slate-500 hover:text-slate-100"
              } ${
                item.id === "points"
                  ? "relative border-cyan-400/60 text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_26px_rgba(34,211,238,0.38)]"
                  : ""
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1">
        <Suspense
          fallback={
            <div className="px-6 py-12 text-center text-sm text-slate-300/80">
              Loading section...
            </div>
          }
        >
          {tab === "swap" && (
            <SwapSection
              balances={balances}
              address={address}
              chainId={chainId}
              onBalancesRefresh={refresh}
            />
          )}
          {tab === "liquidity" && (
            <LiquiditySection
              address={address}
              chainId={chainId}
              balances={balances}
              showV3={true}
              poolSelection={poolSelection}
              onBalancesRefresh={refresh}
            />
          )}
          {tab === "launchpad" && (
            <LaunchpadSection
              address={address}
              onConnect={handleConnect}
            />
          )}
          {tab === "pools" && <PoolsSection onSelectPool={handlePoolSelect} />}
          {tab === "dashboard" && <Dashboard />}
          {tab === "points" && (
            <PointsPage address={address} onConnect={handleConnect} />
          )}
          {tab === "farms" && (
            <Farms address={address} onConnect={handleConnect} />
          )}
          {tab === "megavault" && (
            <MegaVaultSection address={address} onConnectWallet={handleConnect} />
          )}
        </Suspense>
      </main>

      <Footer />

      <WalletModal
        open={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        onSelectWallet={handleWalletSelect}
      />
    </div>
  );
}

