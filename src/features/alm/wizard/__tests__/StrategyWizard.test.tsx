import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StrategyWizard from "../StrategyWizard";

const STRATEGY = {
  id: 1,
  widthBps: 100,
  recenterBps: 60,
  minRebalanceInterval: 3600,
  maxSwapSlippageBps: 50,
  mintSlippageBps: 50,
  allowSwap: true,
  route: "DIRECT_OR_WETH" as const,
  minCardinality: 0,
  oracleParamsHex: "0x01",
  wethHopFee: 3000,
  targetRatioBps0: 5000,
  minCompoundValueToken1: 2000000n,
  ratioDeadbandBps: 25,
  minSwapValueToken1: 1000000n,
  allowedFeeTiers: [500, 3000],
};

const NFT = {
  token0: "0x4200000000000000000000000000000000000006",
  token1: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
  token0Symbol: "WETH",
  token1Symbol: "USDM",
  token1Decimals: 6,
  fee: 500,
};

describe("StrategyWizard", () => {
  it("shows cross-dex required field errors when enabled", async () => {
    render(
      <StrategyWizard
        readProvider={{}}
        selectedStrategy={STRATEGY}
        selectedNft={NFT}
        selectedToken1Stable={true}
        crossDexDefaults={null}
        canEditRegistry={true}
        canEditAlm={true}
        saving={false}
        maxSwapInBpsCurrent={2500}
        onSubmit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /^off$/i }));

    expect(screen.getByText(/Router is required when cross-DEX is enabled/i)).toBeInTheDocument();
    expect(screen.getByText(/Quoter is required when cross-DEX is enabled/i)).toBeInTheDocument();
    expect(screen.getByText(/Factory is required when cross-DEX is enabled/i)).toBeInTheDocument();
  });

  it("applies aggressive preset and updates interval", () => {
    render(
      <StrategyWizard
        readProvider={{}}
        selectedStrategy={STRATEGY}
        selectedNft={NFT}
        selectedToken1Stable={true}
        crossDexDefaults={null}
        canEditRegistry={true}
        canEditAlm={true}
        saving={false}
        maxSwapInBpsCurrent={2500}
        onSubmit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /aggressive/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getAllByDisplayValue("1800").length).toBeGreaterThan(0);
  });
});
