// src/hooks/useSwapQuote.js

import { useEffect, useState } from "react";
import { BrowserProvider, Contract, parseUnits } from "ethers";

import {
  UNISWAP_V2_ROUTER,
  UNISWAP_V2_ROUTER_ABI,
  UNISWAP_V2_FACTORY,
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  WETH_ADDRESS,
} from "../config/uniswapSepolia";

import { TOKENS } from "../config/tokenRegistry";
import { buildPath } from "../utils/buildPath";

export function useSwapQuote({ sellToken, buyToken, amountIn }) {
  const [expectedOut, setExpectedOut] = useState(null);     // BigInt | null
  const [priceImpact, setPriceImpact] = useState(null);     // string | null
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState(null);       // string | null

  const tokenIn = TOKENS[sellToken];
  const tokenOut = TOKENS[buyToken];

  const reloadQuote = () => {
    setExpectedOut(null);
    setPriceImpact(null);
    setQuoteError(null);
  };

  useEffect(() => {
    let cancelled = false;

    async function fetchQuote() {
      // reset base state
      setQuoteError(null);

      // no amount -> reset
      if (!amountIn || parseFloat(amountIn) <= 0) {
        setExpectedOut(null);
        setPriceImpact(null);
        return;
      }

      const isWrap = sellToken === "ETH" && buyToken === "WETH";
      const isUnwrap = sellToken === "WETH" && buyToken === "ETH";

      // ---- WRAP / UNWRAP: 1:1, nessun router ----
      if (isWrap || isUnwrap) {
        try {
          const units = parseUnits(amountIn, 18); // ETH/WETH 18 dec
          if (cancelled) return;
          setExpectedOut(units);
          setPriceImpact("0.00");
          setQuoteError(null);
        } catch (e) {
          console.error("Wrap/unwrap quote error:", e);
          if (cancelled) return;
          setExpectedOut(null);
          setPriceImpact(null);
          setQuoteError("Invalid amount.");
        }
        return;
      }

      // ---- Normal quote via Uniswap V2 ----
      if (!window.ethereum) {
        setExpectedOut(null);
        setPriceImpact(null);
        setQuoteError("No provider available.");
        return;
      }

      try {
        setIsFetchingQuote(true);

        const provider = new BrowserProvider(window.ethereum);
        const router = new Contract(
          UNISWAP_V2_ROUTER,
          UNISWAP_V2_ROUTER_ABI,
          provider
        );

        const amountInUnits = parseUnits(
          amountIn,
          tokenIn?.decimals ?? 18
        );
        const path = buildPath(sellToken, buyToken);

        const amounts = await router.getAmountsOut(amountInUnits, path);
        if (cancelled) return;

        if (!amounts || amounts.length < 2) {
          setExpectedOut(null);
          setPriceImpact(null);
          setQuoteError("No route found for this pair.");
          return;
        }

        const out = amounts[amounts.length - 1];
        setExpectedOut(out);

        // ---- Price impact (solo per path a 2 hop) ----
        if (path.length === 2) {
          try {
            const factory = new Contract(
              UNISWAP_V2_FACTORY,
              UNISWAP_V2_FACTORY_ABI,
              provider
            );

            const pairAddress = await factory.getPair(path[0], path[1]);
            if (
              !pairAddress ||
              pairAddress === "0x0000000000000000000000000000000000000000"
            ) {
              setPriceImpact(null);
              return;
            }

            const pair = new Contract(
              pairAddress,
              UNISWAP_V2_PAIR_ABI,
              provider
            );

            const token0 = (await pair.token0()).toLowerCase();
            const [reserve0, reserve1] = await pair.getReserves();

            const addrInLower = path[0].toLowerCase();
            const addrOutLower = path[1].toLowerCase();

            let reserveInRaw;
            let reserveOutRaw;

            if (token0 === addrInLower && addrOutLower !== addrInLower) {
              reserveInRaw = reserve0;
              reserveOutRaw = reserve1;
            } else if (token0 === addrOutLower && addrInLower !== addrOutLower) {
              reserveInRaw = reserve1;
              reserveOutRaw = reserve0;
            } else {
              setPriceImpact(null);
              return;
            }

            const decIn = tokenIn?.decimals ?? 18;
            const decOut = tokenOut?.decimals ?? 18;

            const reserveInNum =
              Number(reserveInRaw) / Math.pow(10, decIn);
            const reserveOutNum =
              Number(reserveOutRaw) / Math.pow(10, decOut);

            if (reserveInNum <= 0 || reserveOutNum <= 0) {
              setPriceImpact(null);
              return;
            }

            const midPrice = reserveOutNum / reserveInNum;

            const execPrice =
              (Number(out) / Math.pow(10, decOut)) /
              (Number(amountInUnits) / Math.pow(10, decIn));

            if (midPrice <= 0 || execPrice <= 0) {
              setPriceImpact(null);
              return;
            }

            let impact = ((midPrice - execPrice) / midPrice) * 100;
            if (!Number.isFinite(impact)) {
              setPriceImpact(null);
              return;
            }
            if (impact < 0) impact = 0;

            setPriceImpact(impact.toFixed(2));
          } catch (e) {
            console.warn("Price impact calc failed:", e);
            setPriceImpact(null);
          }
        } else {
          setPriceImpact(null);
        }
      } catch (err) {
        console.error("Quote error:", err);
        if (cancelled) return;
        setExpectedOut(null);
        setPriceImpact(null);
        setQuoteError("Failed to fetch quote.");
      } finally {
        if (!cancelled) setIsFetchingQuote(false);
      }
    }

    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [sellToken, buyToken, amountIn]);

  return {
    expectedOut,
    priceImpact,
    isFetchingQuote,
    quoteError,
    reloadQuote,
  };
}
