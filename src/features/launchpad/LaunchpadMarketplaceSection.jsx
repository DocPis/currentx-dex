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
  if (cleaned === "/launchpad" || cleaned === "/launchpad/market") {
    return { view: "market", tokenAddress: "", studioView: "" };
  }
  if (cleaned === "/launchpad/create" || cleaned === "/launchpad/legacy" || cleaned === "/launchpad/studio") {
    return { view: "market", tokenAddress: "", studioView: "create" };
  }
  if (cleaned === "/launchpad/my-tokens") {
    return { view: "market", tokenAddress: "", studioView: "deployments" };
  }
  if (cleaned === "/launchpad/vault") {
    return { view: "market", tokenAddress: "", studioView: "vault" };
  }
  if (cleaned === "/launchpad/locker") {
    return { view: "market", tokenAddress: "", studioView: "locker" };
  }

  const match = cleaned.match(/^\/launchpad\/(0x[a-f0-9]{40})$/u);
  if (match?.[1]) {
    return { view: "detail", tokenAddress: match[1], studioView: "" };
  }

  return { view: "market", tokenAddress: "", studioView: "" };
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
        onConnect={onConnect}
        onRefreshBalances={onBalancesRefresh}
        onBack={() => onNavigate?.("/launchpad")}
        onOpenToken={(tokenAddress) => onNavigate?.(`/launchpad/${tokenAddress}`)}
      />
    );
  }

  return (
    <>
      <LaunchpadMarket
        onOpenToken={(tokenAddress) => onNavigate?.(`/launchpad/${tokenAddress}`)}
        onOpenStudio={(studioView) => onNavigate?.(getStudioPath(studioView))}
        activeStudioView={parsed.studioView || undefined}
      />
      {parsed.studioView ? (
        <LegacyLaunchpadSection
          address={address}
          onConnect={onConnect}
          initialView={parsed.studioView}
        />
      ) : null}
    </>
  );
}
