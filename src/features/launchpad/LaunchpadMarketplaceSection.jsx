import React, { useMemo } from "react";
import LaunchpadMarket from "../../pages/launchpad/LaunchpadMarket";
import TokenDetail from "../../pages/launchpad/TokenDetail";
import LegacyLaunchpadSection from "./LaunchpadSection";

const normalizePath = (path = "") => {
  const cleaned = String(path || "").trim().replace(/\/+$/u, "");
  return cleaned || "/launchpad";
};

const parseLaunchpadPath = (path = "") => {
  const cleaned = normalizePath(path).toLowerCase();
  if (cleaned === "/launchpad" || cleaned === "/launchpad/market") {
    return { view: "market", tokenAddress: "" };
  }
  if (cleaned === "/launchpad/create" || cleaned === "/launchpad/legacy") {
    return { view: "legacy", tokenAddress: "" };
  }

  const match = cleaned.match(/^\/launchpad\/(0x[a-f0-9]{40})$/u);
  if (match?.[1]) {
    return { view: "detail", tokenAddress: match[1] };
  }

  return { view: "market", tokenAddress: "" };
};

export default function LaunchpadMarketplaceSection({
  address,
  onConnect,
  onBalancesRefresh,
  routePath,
  onNavigate,
}) {
  const parsed = useMemo(() => parseLaunchpadPath(routePath), [routePath]);

  if (parsed.view === "legacy") {
    return <LegacyLaunchpadSection address={address} onConnect={onConnect} />;
  }

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

  return <LaunchpadMarket onOpenToken={(tokenAddress) => onNavigate?.(`/launchpad/${tokenAddress}`)} />;
}
