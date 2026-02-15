// src/features/positions/PositionSection.jsx
import React from "react";
import LiquiditySection from "../liquidity/LiquiditySection";

export default function PositionSection({ address, chainId, balances, onConnect }) {
  return (
    <LiquiditySection
      address={address}
      chainId={chainId}
      balances={balances}
      onConnect={onConnect}
      showV2={false}
      showV3={true}
    />
  );
}
