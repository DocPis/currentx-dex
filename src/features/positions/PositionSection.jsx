// src/features/positions/PositionSection.jsx
import React from "react";
import LiquiditySection from "../liquidity/LiquiditySection";

export default function PositionSection({ address, chainId, balances }) {
  return (
    <LiquiditySection
      address={address}
      chainId={chainId}
      balances={balances}
      showV2={false}
      showV3={true}
    />
  );
}
