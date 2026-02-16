import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, formatUnits, isAddress, parseUnits } from "ethers";
import {
  CURRENTX_ADDRESS,
  EXPLORER_BASE_URL,
  TOKENS,
  UNIV3_FACTORY_ADDRESS,
  UNIV3_QUOTER_V2_ADDRESS,
  UNIV3_SWAP_ROUTER_ADDRESS,
  WETH_ADDRESS,
  getProvider,
  getReadOnlyProvider,
} from "../../shared/config/web3";
import {
  ERC20_ABI,
  UNIV3_FACTORY_ABI,
  UNIV3_QUOTER_V2_ABI,
} from "../../shared/config/abis";
import { getRealtimeClient } from "../../shared/services/realtime";
import type { LaunchpadTokenCard } from "../../services/launchpad/types";
import { formatPercent, formatTokenAmount, shortAddress } from "../../services/launchpad/utils";

const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const V3_FEE_TIERS = [10000, 3000, 500];
const CURRENTX_ROUTER_AND_FEE_READER_ABI = [
  {
    inputs: [],
    name: "swapRouter",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "POOL_FEE",
    outputs: [{ internalType: "uint24", name: "", type: "uint24" }],
    stateMutability: "view",
    type: "function",
  },
];
const LAUNCHPAD_SWAP_ROUTER02_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "tokenIn", type: "address" },
          { internalType: "address", name: "tokenOut", type: "address" },
          { internalType: "uint24", name: "fee", type: "uint24" },
          { internalType: "address", name: "recipient", type: "address" },
          { internalType: "uint256", name: "amountIn", type: "uint256" },
          { internalType: "uint256", name: "amountOutMinimum", type: "uint256" },
          { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
        ],
        internalType: "struct IV3SwapRouter.ExactInputSingleParams",
        name: "params",
        type: "tuple",
      },
    ],
    name: "exactInputSingle",
    outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes[]", name: "data", type: "bytes[]" }],
    name: "multicall",
    outputs: [{ internalType: "bytes[]", name: "results", type: "bytes[]" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountMinimum", type: "uint256" },
      { internalType: "address", name: "recipient", type: "address" },
    ],
    name: "unwrapWETH9",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
];

const toSymbol = (address: string, token: LaunchpadTokenCard) => {
  const lower = String(address || "").toLowerCase();
  if (lower === String(token.address || "").toLowerCase()) return token.symbol;
  if (lower === String(WETH_ADDRESS || "").toLowerCase()) return "ETH";
  const known = Object.values(TOKENS || {}).find(
    (entry) => String(entry?.address || "").toLowerCase() === lower
  );
  return known?.symbol || shortAddress(address);
};

const parseAmount = (value: string, decimals: number) => {
  const clean = String(value || "").trim();
  if (!clean) return null;
  try {
    return parseUnits(clean, decimals);
  } catch {
    return null;
  }
};

const normalizeError = (error: unknown) => {
  const typed = error as { message?: string; code?: number | string };
  const message = String(typed?.message || "Swap failed");
  const code = typed?.code;
  if (code === 4001 || code === "ACTION_REJECTED") return "Transaction was rejected in wallet.";
  if (message.toLowerCase().includes("insufficient funds")) return "Insufficient funds for amount + gas.";
  if (message.toLowerCase().includes("insufficient_output_amount")) return "Slippage too low for available liquidity.";
  return message;
};

const readable = (amount: bigint, decimals: number) => {
  const value = Number(formatUnits(amount, decimals));
  if (!Number.isFinite(value)) return "--";
  return formatTokenAmount(value);
};

interface TradeWidgetProps {
  token: LaunchpadTokenCard;
  address?: string | null;
  initialSide?: "buy" | "sell";
  onConnect: () => void;
  onRefreshBalances?: () => Promise<void> | void;
  onTradeSuccess?: () => void;
}

interface QuoteState {
  loading: boolean;
  error: string;
  amountOut: bigint | null;
  path: string[];
  priceImpact: number | null;
  protocol: "V3" | null;
  v3Fee: number | null;
}

interface TxState {
  stage: "idle" | "awaiting_signature" | "pending" | "confirmed" | "failed";
  message: string;
  hash?: string;
}

const TradeWidget = ({
  token,
  address,
  initialSide,
  onConnect,
  onRefreshBalances,
  onTradeSuccess,
}: TradeWidgetProps) => {
  const [side, setSide] = useState<"buy" | "sell">(initialSide || "buy");
  const [slippage, setSlippage] = useState("1.0");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<QuoteState>({
    loading: false,
    error: "",
    amountOut: null,
    path: [],
    priceImpact: null,
    protocol: null,
    v3Fee: null,
  });
  const [walletEth, setWalletEth] = useState<bigint>(0n);
  const [walletToken, setWalletToken] = useState<bigint>(0n);
  const [tx, setTx] = useState<TxState>({ stage: "idle", message: "" });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [swapRouterAddress, setSwapRouterAddress] = useState<string>(
    String(UNIV3_SWAP_ROUTER_ADDRESS || "").trim()
  );
  const [preferredPoolFee, setPreferredPoolFee] = useState<number | null>(null);
  const quoteTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!initialSide) return;
    setSide(initialSide);
  }, [initialSide, token.address]);

  useEffect(() => {
    let ignore = false;

    const resolveRouterAndFee = async () => {
      const fallbackRouter = String(UNIV3_SWAP_ROUTER_ADDRESS || "").trim();
      const provider = getReadOnlyProvider(false, true);
      if (!isAddress(CURRENTX_ADDRESS)) {
        if (!ignore) {
          setSwapRouterAddress(fallbackRouter);
          setPreferredPoolFee(null);
        }
        return;
      }

      try {
        const reader = new Contract(CURRENTX_ADDRESS, CURRENTX_ROUTER_AND_FEE_READER_ABI, provider);
        const [routerRaw, feeRaw] = await Promise.all([
          reader.swapRouter().catch(() => fallbackRouter),
          reader.POOL_FEE().catch(() => null),
        ]);
        const router = String(routerRaw || "").trim();
        const fee = Number(feeRaw);
        if (!ignore) {
          setSwapRouterAddress(isAddress(router) ? router : fallbackRouter);
          setPreferredPoolFee(Number.isFinite(fee) && fee > 0 ? fee : null);
        }
      } catch {
        if (!ignore) {
          setSwapRouterAddress(fallbackRouter);
          setPreferredPoolFee(null);
        }
      }
    };

    void resolveRouterAndFee();
    return () => {
      ignore = true;
    };
  }, []);

  const sellAddress = side === "buy" ? WETH_ADDRESS : token.address;
  const buyAddress = side === "buy" ? token.address : WETH_ADDRESS;
  const sellDecimals = side === "buy" ? 18 : token.decimals;
  const buyDecimals = side === "buy" ? token.decimals : 18;

  const routeLabel = useMemo(() => {
    if (!quote.path.length) return side === "buy" ? `ETH > ${token.symbol}` : `${token.symbol} > ETH`;
    const base = quote.path.map((item) => toSymbol(item, token)).join(" > ");
    if (quote.protocol === "V3" && Number.isFinite(Number(quote.v3Fee))) {
      return `${base} (V3 ${(Number(quote.v3Fee) / 10000).toFixed(2)}%)`;
    }
    return base;
  }, [quote.path, quote.protocol, quote.v3Fee, side, token]);

  const slippageBps = useMemo(() => {
    const value = Number(String(slippage || "0").replace(/,/gu, "."));
    if (!Number.isFinite(value) || value < 0) return 100;
    return Math.max(1, Math.floor(value * 100));
  }, [slippage]);

  const isConnected = Boolean(address);
  const hasQuote = Boolean(quote.amountOut && quote.amountOut > 0n);
  const estimatedReceived = hasQuote ? readable(quote.amountOut as bigint, buyDecimals) : "--";

  const fetchBalances = useCallback(async () => {
    if (!address) {
      setWalletEth(0n);
      setWalletToken(0n);
      return;
    }
    try {
      const provider = getReadOnlyProvider();
      const [ethBalance, tokenBalance] = await Promise.all([
        provider.getBalance(address),
        new Contract(token.address, ERC20_ABI, provider).balanceOf(address),
      ]);
      setWalletEth(BigInt(ethBalance));
      setWalletToken(BigInt(tokenBalance));
    } catch {
      setWalletEth(0n);
      setWalletToken(0n);
    }
  }, [address, token.address]);

  useEffect(() => {
    void fetchBalances();
  }, [fetchBalances]);

  const refreshQuote = useCallback(async () => {
    const parsedAmount = parseAmount(amount, sellDecimals);
    if (!parsedAmount || parsedAmount <= 0n) {
      setQuote({
        loading: false,
        error: "",
        amountOut: null,
        path: [],
        priceImpact: null,
        protocol: null,
        v3Fee: null,
      });
      return;
    }

    setQuote((prev) => ({ ...prev, loading: true, error: "" }));

    try {
      if (!UNIV3_FACTORY_ADDRESS || !UNIV3_QUOTER_V2_ADDRESS) {
        throw new Error("V3 quoting contracts are not configured.");
      }
      const provider = getReadOnlyProvider();
      const factory = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, provider);
      const quoter = new Contract(UNIV3_QUOTER_V2_ADDRESS, UNIV3_QUOTER_V2_ABI, provider);
      const feeCandidates = Array.from(
        new Set(
          [preferredPoolFee, ...V3_FEE_TIERS].filter(
            (value) => Number.isFinite(Number(value)) && Number(value) > 0
          )
        )
      ).map((value) => Number(value));

      let bestOut: bigint | null = null;
      let bestV3Fee: number | null = null;

      for (const fee of feeCandidates) {
        const poolAddress = await factory.getPool(sellAddress, buyAddress, fee).catch(() => ZERO_ADDRESS);
        if (!poolAddress || String(poolAddress).toLowerCase() === ZERO_ADDRESS) continue;

        const params = {
          tokenIn: sellAddress,
          tokenOut: buyAddress,
          amountIn: parsedAmount,
          fee,
          sqrtPriceLimitX96: 0,
        };
        const res = await quoter.quoteExactInputSingle.staticCall(params);
        const outputRaw = res?.[0] ?? res?.amountOut ?? 0n;
        const output = BigInt(outputRaw.toString());
        if (output <= 0n) continue;
        if (!bestOut || output > bestOut) {
          bestOut = output;
          bestV3Fee = fee;
        }
      }

      if (!bestOut || !bestV3Fee) throw new Error("No V3 route with available liquidity.");

      setQuote({
        loading: false,
        error: "",
        amountOut: bestOut,
        path: [sellAddress, buyAddress],
        priceImpact: null,
        protocol: "V3",
        v3Fee: bestV3Fee,
      });
    } catch (error) {
      setQuote({
        loading: false,
        error: normalizeError(error),
        amountOut: null,
        path: [],
        priceImpact: null,
        protocol: null,
        v3Fee: null,
      });
    }
  }, [amount, buyAddress, preferredPoolFee, sellAddress, sellDecimals]);

  useEffect(() => {
    if (quoteTimerRef.current !== null) {
      window.clearTimeout(quoteTimerRef.current);
      quoteTimerRef.current = null;
    }
    quoteTimerRef.current = window.setTimeout(() => {
      void refreshQuote();
    }, 320);

    return () => {
      if (quoteTimerRef.current !== null) {
        window.clearTimeout(quoteTimerRef.current);
        quoteTimerRef.current = null;
      }
    };
  }, [refreshQuote]);

  const applyMax = () => {
    if (side === "buy") {
      const reserve = parseUnits("0.002", 18);
      const value = walletEth > reserve ? walletEth - reserve : 0n;
      setAmount(trimTrailingZeros(formatUnits(value, 18)));
      return;
    }
    setAmount(trimTrailingZeros(formatUnits(walletToken, token.decimals)));
  };

  const checkApprovalNeeds = useCallback(
    async (owner: string, amountIn: bigint) => {
      if (side !== "sell") {
        return { needsErc20: false };
      }
      if (!isAddress(swapRouterAddress)) {
        throw new Error("Swap router is not configured.");
      }

      const provider = getReadOnlyProvider();
      const erc20 = new Contract(token.address, ERC20_ABI, provider);
      const erc20Allowance = await erc20.allowance(owner, swapRouterAddress);
      return {
        needsErc20: BigInt(erc20Allowance.toString()) < amountIn,
      };
    },
    [side, swapRouterAddress, token.address]
  );

  const trackPendingTx = async (hash: string) => {
    setTx({ stage: "pending", hash, message: "Transaction submitted. Waiting for confirmation..." });
    const realtime = getRealtimeClient();
    const unsubscribe = realtime.addTxListener(hash, (receipt) => {
      const status = Number(receipt?.status || 0);
      if (status === 1) {
        setTx({ stage: "confirmed", hash, message: "Transaction confirmed." });
      } else if (status === 0) {
        setTx({ stage: "failed", hash, message: "Transaction reverted." });
      }
    });
    return unsubscribe;
  };

  const runTrade = async () => {
    if (!isConnected || !address) {
      onConnect();
      return;
    }

    const parsedAmount = parseAmount(amount, sellDecimals);
    if (!parsedAmount || parsedAmount <= 0n) {
      setTx({ stage: "failed", message: "Enter a valid amount." });
      return;
    }
    if (!quote.amountOut || !quote.path.length) {
      setTx({ stage: "failed", message: "Route unavailable. Fetch a fresh quote." });
      return;
    }
    if (quote.protocol !== "V3" || !quote.v3Fee) {
      setTx({ stage: "failed", message: "Only V3 route is supported in Launchpad trades." });
      return;
    }
    if (!isAddress(swapRouterAddress)) {
      setTx({ stage: "failed", message: "Swap router is not configured." });
      return;
    }

    setSubmitLoading(true);
    let unsubscribeRealtime: (() => void) | null = null;

    try {
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();

      if (side === "sell") {
        const approval = await checkApprovalNeeds(user, parsedAmount);

        if (approval.needsErc20) {
          setTx({ stage: "awaiting_signature", message: `Approve ${token.symbol} allowance...` });
          const erc20 = new Contract(token.address, ERC20_ABI, signer);
          const approveTx = await erc20.approve(swapRouterAddress, MAX_UINT256);
          const dispose = await trackPendingTx(String(approveTx.hash || ""));
          await approveTx.wait();
          dispose();
        }
      }

      const minOut = (quote.amountOut * BigInt(Math.max(1, 10000 - slippageBps))) / 10000n;
      const swapRouter = new Contract(swapRouterAddress, LAUNCHPAD_SWAP_ROUTER02_ABI, signer);
      const fee = Number(quote.v3Fee || V3_FEE_TIERS[0]);

      const baseParams = {
        tokenIn: sellAddress,
        tokenOut: buyAddress,
        fee,
        recipient: user,
        amountIn: parsedAmount,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0,
      };

      setTx({ stage: "awaiting_signature", message: "Confirm swap in wallet..." });
      const txRequest =
        side === "buy"
          ? await swapRouter.exactInputSingle(baseParams, { value: parsedAmount })
          : await swapRouter.multicall([
              swapRouter.interface.encodeFunctionData("exactInputSingle", [
                {
                  ...baseParams,
                  recipient: swapRouterAddress,
                },
              ]),
              swapRouter.interface.encodeFunctionData("unwrapWETH9", [minOut, user]),
            ]);

      unsubscribeRealtime = await trackPendingTx(String(txRequest.hash || ""));
      const receipt = await txRequest.wait();
      const txHash = String(receipt?.hash || txRequest.hash || "");

      if (Number(receipt?.status || 0) !== 1) {
        throw new Error("Swap transaction failed.");
      }

      setTx({
        stage: "confirmed",
        hash: txHash,
        message: `${side === "buy" ? "Buy" : "Sell"} confirmed.`,
      });
      setAmount("");
      await fetchBalances();
      await onRefreshBalances?.();
      onTradeSuccess?.();
    } catch (error) {
      const message = normalizeError(error);
      setTx({ stage: "failed", message, hash: (error as { hash?: string })?.hash });
    } finally {
      unsubscribeRealtime?.();
      setSubmitLoading(false);
    }
  };

  const walletBalanceLabel = side === "buy" ? readable(walletEth, 18) : readable(walletToken, token.decimals);

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 p-4 shadow-[0_16px_38px_rgba(2,6,23,0.55)]">
      <div className="flex items-center justify-between">
        <div className="font-display text-sm font-semibold text-slate-100">Trade {token.symbol}</div>
        <div className="inline-flex rounded-xl border border-slate-700/70 bg-slate-900/75 p-1 text-xs">
          <button
            type="button"
            onClick={() => setSide("buy")}
            className={`rounded-lg px-3 py-1.5 font-semibold transition ${
              side === "buy" ? "bg-emerald-500/25 text-emerald-100" : "text-slate-300"
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setSide("sell")}
            className={`rounded-lg px-3 py-1.5 font-semibold transition ${
              side === "sell" ? "bg-rose-500/25 text-rose-100" : "text-slate-300"
            }`}
          >
            Sell
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span>Amount ({side === "buy" ? "ETH" : token.symbol})</span>
            <span>Balance: {walletBalanceLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/,/gu, "."))}
              placeholder="0.0"
              className="w-full bg-transparent text-lg font-semibold text-slate-100 outline-none placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={applyMax}
              className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-slate-500"
            >
              Max
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="rounded-xl border border-slate-800/80 bg-slate-900/55 px-3 py-2 text-slate-300">
            Slippage %
            <input
              value={slippage}
              onChange={(event) => setSlippage(event.target.value.replace(/,/gu, "."))}
              className="mt-1 w-full bg-transparent text-sm font-semibold text-slate-100 outline-none"
            />
          </label>
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 px-3 py-2 text-slate-300">
            Est. received
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {quote.loading ? "Quoting..." : estimatedReceived}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-900/45 px-3 py-2 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span>Price impact</span>
            <span className="text-slate-200">
              {quote.priceImpact === null ? "--" : formatPercent(quote.priceImpact)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-slate-400">
            <span>Route</span>
            <span className="text-slate-200">{routeLabel}</span>
          </div>
        </div>

        {quote.error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {quote.error}
          </div>
        )}

        <button
          type="button"
          onClick={() => void runTrade()}
          disabled={submitLoading || quote.loading || (!hasQuote && isConnected)}
          className="w-full rounded-xl border border-sky-400/70 bg-gradient-to-r from-sky-500/40 via-cyan-500/35 to-emerald-500/30 px-4 py-2.5 text-sm font-semibold text-sky-100 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {!isConnected
            ? "Connect wallet"
            : submitLoading
            ? "Submitting..."
            : side === "buy"
            ? `Buy ${token.symbol}`
            : `Sell ${token.symbol}`}
        </button>

        {tx.stage !== "idle" && (
          <div
            className={`rounded-xl border px-3 py-2 text-xs ${
              tx.stage === "confirmed"
                ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-200"
                : tx.stage === "failed"
                ? "border-rose-400/35 bg-rose-500/10 text-rose-200"
                : "border-sky-400/35 bg-sky-500/10 text-sky-200"
            }`}
          >
            <div>{tx.message}</div>
            {tx.hash && (
              <a
                href={`${EXPLORER_BASE_URL}/tx/${tx.hash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[11px] font-semibold text-sky-200 hover:text-sky-100"
              >
                View transaction
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const trimTrailingZeros = (value: string): string => {
  if (typeof value !== "string" || !value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
};

export default React.memo(TradeWidget);
