import React, { useMemo } from "react";
import LaunchpadMarket from "../../pages/launchpad/LaunchpadMarket";
import TokenDetail from "../../pages/launchpad/TokenDetail";
import LegacyLaunchpadSection from "./LaunchpadSection";

const normalizePath = (path = "") => {
  const cleaned = String(path || "").trim().replace(/\/+$/u, "");
  return cleaned || "/launchpad";
};

const DEFAULT_STUDIO_VIEW = "create";

const getStudioPath = (studioView = DEFAULT_STUDIO_VIEW) => {
  const normalized = String(studioView || "").toLowerCase();
  if (normalized === "deployments") return "/launchpad/my-tokens";
  if (normalized === "vault") return "/launchpad/vault";
  if (normalized === "locker") return "/launchpad/locker";
  return "/launchpad/create";
};

const parseLaunchpadPath = (path = "") => {
  const cleaned = normalizePath(path).toLowerCase();
  if (cleaned === "/launchpad/market") {
    return { view: "market", tokenAddress: "", studioView: DEFAULT_STUDIO_VIEW, tradeIntent: null };
  }
  if (cleaned === "/launchpad") {
    return { view: "market", tokenAddress: "", studioView: DEFAULT_STUDIO_VIEW, tradeIntent: null };
  }
  if (cleaned === "/launchpad/create" || cleaned === "/launchpad/legacy" || cleaned === "/launchpad/studio") {
    return { view: "legacy", tokenAddress: "", studioView: "create", tradeIntent: null };
  }
  if (cleaned === "/launchpad/my-tokens") {
    return { view: "legacy", tokenAddress: "", studioView: "deployments", tradeIntent: null };
  }
  if (cleaned === "/launchpad/vault") {
    return { view: "legacy", tokenAddress: "", studioView: "vault", tradeIntent: null };
  }
  if (cleaned === "/launchpad/locker") {
    return { view: "legacy", tokenAddress: "", studioView: "locker", tradeIntent: null };
  }
  const buyMatch = cleaned.match(/^\/launchpad\/(0x[a-f0-9]{40})\/buy$/u);
  if (buyMatch?.[1]) {
    return { view: "detail", tokenAddress: buyMatch[1], studioView: DEFAULT_STUDIO_VIEW, tradeIntent: "buy" };
  }

  const match = cleaned.match(/^\/launchpad\/(0x[a-f0-9]{40})$/u);
  if (match?.[1]) {
    return { view: "detail", tokenAddress: match[1], studioView: DEFAULT_STUDIO_VIEW, tradeIntent: null };
  }

  return { view: "legacy", tokenAddress: "", studioView: DEFAULT_STUDIO_VIEW, tradeIntent: null };
};

export default function LaunchpadMarketplaceSection({
  address,
  onConnect,
  onBalancesRefresh,
  routePath,
  onNavigate,
}) {
  const parsed = useMemo(() => parseLaunchpadPath(routePath), [routePath]);

  if (parsed.view === "detail") {
    return (
      <TokenDetail
        tokenAddress={parsed.tokenAddress}
        address={address}
        initialTradeSide={parsed.tradeIntent === "buy" ? "buy" : undefined}
        onConnect={onConnect}
        onRefreshBalances={onBalancesRefresh}
        onBack={() => onNavigate?.("/launchpad/market")}
        onOpenToken={(tokenAddress) => onNavigate?.(`/launchpad/${tokenAddress}`)}
      />
    );
  }

  if (parsed.view === "market") {
    return (
      <LaunchpadMarket
        onOpenToken={(tokenAddress) => onNavigate?.(`/launchpad/${tokenAddress}`)}
        onBuyToken={(tokenAddress) => onNavigate?.(`/launchpad/${tokenAddress}/buy`)}
        onOpenStudio={(studioView) => onNavigate?.(getStudioPath(studioView))}
      />
    );
  }

  return (
    <LegacyLaunchpadSection
      address={address}
      onConnect={onConnect}
      initialView={parsed.studioView}
      onOpenMarket={() => onNavigate?.("/launchpad/market")}
    />
  );
}
