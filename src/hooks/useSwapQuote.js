// src/hooks/useSwapQuote.js
import { useEffect, useState } from "react";
import { BrowserProvider, Contract, parseUnits, formatUnits } from "ethers";

import {
  UNISWAP_V2_ROUTER,
  UNISWAP_V2_ROUTER_ABI,
  UNISWAP_V2_FACTORY,
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
} from "../config/uniswapSepolia";

import { buildPath } from "../utils/uniswapPaths";

/**
 * Gestisce:
 * - getAmountsOut su Uniswap
 * - price impact
 * - minimum received (in base allo slippage)
 */
export function useSwapQuote({
  amountIn,
  sellToken,
  buyToken,
  tokenIn,
  tokenOut,
  isWrap,
  isUnwrap,
  slippage,
}) {
  const [expectedOut, setExpectedOut] = useState(null);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [priceImpact, setPriceImpact] = useState(null);
  const [minReceived, setMinReceived] = useState(null);

  /* ---------- FETCH QUOTE + PRICE IMPACT ---------- */

  useEffect(() => {
    let cancelled = false;

    async function fetchQuote() {
      if (!amountIn || parseFloat(amountIn) <= 0) {
        setExpectedOut(null);
        setQuoteError(null);
        setPriceImpact(null);
        return;
      }

      // WRAP/UNWRAP: 1:1, niente Uniswap
      if (isWrap || isUnwrap) {
        try {
          const units = parseUnits(amountIn, 18); // ETH/WETH 18 dec
          if (!cancelled) {
            setExpectedOut(units);
            setQuoteError(null);
            setPriceImpact(null);
          }
        } catch {
          if (!cancelled) {
            setExpectedOut(null);
            setQuoteError("Invalid amount.");
            setPriceImpact(null);
          }
        }
        return;
      }

      if (typeof window === "undefined" || !window.ethereum) {
        setExpectedOut(null);
        setQuoteError("No provider available.");
        setPriceImpact(null);
        return;
      }

      try {
        setIsFetchingQuote(true);
        setQuoteError(null);

        const provider = new BrowserProvider(window.ethereum);
        const router = new Contract(
          UNISWAP_V2_ROUTER,
          UNISWAP_V2_ROUTER_ABI,
          provider
        );

        const amountInUnits = parseUnits(amountIn, tokenIn.decimals || 18);
        const path = buildPath(sellToken, buyToken);

        const amounts = await router.getAmountsOut(amountInUnits, path);
        if (cancelled) return;

        if (!amounts || amounts.length < 2) {
          setExpectedOut(null);
          setQuoteError("Unable to fetch quote.");
          setPriceImpact(null);
          return;
        }

        const out = amounts[amounts.length - 1];
        setExpectedOut(out);

        // price impact solo per path dirette (2 token)
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
            } else {
              const pair = new Contract(
                pairAddress,
                UNISWAP_V2_PAIR_ABI,
                provider
              );
              const token0 = (await pair.token0()).toLowerCase();
              const token1 = (await pair.token1()).toLowerCase();
              const [reserve0, reserve1] = await pair.getReserves();

              const addrInLower = path[0].toLowerCase();
              const addrOutLower = path[1].toLowerCase();

              let reserveInRaw;
              let reserveOutRaw;

              if (token0 === addrInLower && token1 === addrOutLower) {
                reserveInRaw = reserve0;
                reserveOutRaw = reserve1;
              } else if (
                token0 === addrOutLower &&
                token1 === addrInLower
              ) {
                reserveInRaw = reserve1;
                reserveOutRaw = reserve0;
              } else {
                setPriceImpact(null);
                return;
              }

              const reserveInNum =
                Number(reserveInRaw) /
                Math.pow(10, tokenIn.decimals || 18);
              const reserveOutNum =
                Number(reserveOutRaw) /
                Math.pow(10, tokenOut.decimals || 18);

              if (reserveInNum <= 0 || reserveOutNum <= 0) {
                setPriceImpact(null);
                return;
              }

              const midPrice = reserveOutNum / reserveInNum;
              const execPrice =
                (Number(out) /
                  Math.pow(10, tokenOut.decimals || 18)) /
                (Number(amountInUnits) /
                  Math.pow(10, tokenIn.decimals || 18));

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
            }
          } catch (e) {
            console.warn("Price impact calc error:", e);
            setPriceImpact(null);
          }
        } else {
          setPriceImpact(null);
        }
      } catch (err) {
        console.error("Quote error:", err);
        if (!cancelled) {
          setExpectedOut(null);
          setQuoteError("Failed to fetch quote. Please try again.");
          setPriceImpact(null);
        }
      } finally {
        if (!cancelled) setIsFetchingQuote(false);
      }
    }

    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [
    amountIn,
    sellToken,
    buyToken,
    tokenIn.decimals,
    tokenOut.decimals,
    isWrap,
    isUnwrap,
  ]);

  /* ---------- MINIMUM RECEIVED ---------- */

  useEffect(() => {
    if (!expectedOut) {
      setMinReceived(null);
      return;
    }

    if (isWrap || isUnwrap) {
      setMinReceived(formatUnits(expectedOut, 18));
      return;
    }

    const s = parseFloat(slippage || "0");
    if (Number.isNaN(s) || s < 0 || s > 50) {
      setMinReceived(null);
      return;
    }

    const slippageBps = Math.round(s * 100);
    const bpsDenominator = 10000n;

    const minOut =
      (expectedOut * BigInt(10000 - slippageBps)) / bpsDenominator;

    setMinReceived(formatUnits(minOut, tokenOut.decimals || 18));
  }, [expectedOut, slippage, tokenOut.decimals, isWrap, isUnwrap]);

  return {
    expectedOut,
    isFetchingQuote,
    quoteError,
    priceImpact,
    minReceived,
  };
}

export default useSwapQuote;
