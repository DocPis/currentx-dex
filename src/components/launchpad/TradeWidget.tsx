import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AbiCoder, Contract, formatUnits, parseUnits } from "ethers";
import {
  EXPLORER_BASE_URL,
  PERMIT2_ADDRESS,
  TOKENS,
  UNIV3_FACTORY_ADDRESS,
  UNIV3_QUOTER_V2_ADDRESS,
  UNIV3_UNIVERSAL_ROUTER_ADDRESS,
  WETH_ADDRESS,
  getProvider,
  getReadOnlyProvider,
  getV2Quote,
  getV2QuoteWithMeta,
} from "../../shared/config/web3";
import {
  ERC20_ABI,
  PERMIT2_ABI,
  UNIV3_FACTORY_ABI,
  UNIV3_QUOTER_V2_ABI,
  UNIV3_UNIVERSAL_ROUTER_ABI,
} from "../../shared/config/abis";
import { getRealtimeClient } from "../../shared/services/realtime";
import type { LaunchpadTokenCard } from "../../services/launchpad/types";
import { formatPercent, formatTokenAmount, shortAddress } from "../../services/launchpad/utils";
import UnverifiedTokenModal from "./UnverifiedTokenModal";

const UR_COMMANDS = {
  V3_SWAP_EXACT_IN: 0x00,
  V2_SWAP_EXACT_IN: 0x08,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
};
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const V3_FEE_TIERS = [10000, 3000, 500];

const toSymbol = (address: string, token: LaunchpadTokenCard) => {
  const lower = String(address || "").toLowerCase();
  if (lower === String(token.address || "").toLowerCase()) return token.symbol;
  if (lower === String(WETH_ADDRESS || "").toLowerCase()) return "ETH";
  const known = Object.values(TOKENS || {}).find(
    (entry) => String(entry?.address || "").toLowerCase() === lower
  );
  return known?.symbol || shortAddress(address);
};

const buildCommandBytes = (commands: number[]) =>
  `0x${commands.map((cmd) => Number(cmd).toString(16).padStart(2, "0")).join("")}`;

const encodeV3Path = (tokens: string[], fees: number[]) => {
  if (
    !Array.isArray(tokens) ||
    !Array.isArray(fees) ||
    tokens.length !== fees.length + 1
  ) {
    throw new Error("Invalid V3 path.");
  }
  const parts: string[] = [];
  for (let i = 0; i < fees.length; i += 1) {
    const token = String(tokens[i] || "").toLowerCase().replace(/^0x/u, "");
    const next = String(tokens[i + 1] || "").toLowerCase().replace(/^0x/u, "");
    const fee = Number(fees[i]);
    if (!token || !next || !Number.isFinite(fee)) {
      throw new Error("Invalid V3 path.");
    }
    if (i === 0) parts.push(token);
    parts.push(fee.toString(16).padStart(6, "0"));
    parts.push(next);
  }
  return `0x${parts.join("")}`;
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
  protocol: "V2" | "V3" | null;
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
  const [confirmUnverifiedOpen, setConfirmUnverifiedOpen] = useState(false);
  const quoteTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!initialSide) return;
    setSide(initialSide);
  }, [initialSide, token.address]);

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
    if (quote.protocol === "V2") {
      return `${base} (V2)`;
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

  const buildCandidatePaths = useCallback(() => {
    const direct = [sellAddress, buyAddress];
    const mids = [TOKENS.USDM?.address, TOKENS.CUSD?.address, TOKENS.CRX?.address]
      .map((value) => String(value || ""))
      .filter(Boolean)
      .filter((mid) => {
        const lower = mid.toLowerCase();
        return lower !== sellAddress.toLowerCase() && lower !== buyAddress.toLowerCase();
      });
    const paths = [direct, ...mids.map((mid) => [sellAddress, mid, buyAddress])];
    const dedup = new Map<string, string[]>();
    paths.forEach((path) => {
      const key = path.map((item) => item.toLowerCase()).join(",");
      if (!dedup.has(key)) dedup.set(key, path);
    });
    return Array.from(dedup.values());
  }, [buyAddress, sellAddress]);

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
      const provider = getReadOnlyProvider();
      const candidates = buildCandidatePaths();
      let bestPath: string[] = [];
      let bestOut: bigint | null = null;
      let bestProtocol: QuoteState["protocol"] = null;
      let bestV3Fee: number | null = null;

      for (const path of candidates) {
        try {
          const output = await getV2Quote(provider, parsedAmount, path);
          if (!bestOut || output > bestOut) {
            bestOut = output;
            bestPath = path;
            bestProtocol = "V2";
            bestV3Fee = null;
          }
        } catch {
          // ignore missing pools
        }
      }

      if (UNIV3_FACTORY_ADDRESS && UNIV3_QUOTER_V2_ADDRESS) {
        try {
          const factory = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, provider);
          const quoter = new Contract(UNIV3_QUOTER_V2_ADDRESS, UNIV3_QUOTER_V2_ABI, provider);
          for (const fee of V3_FEE_TIERS) {
            const poolAddress = await factory
              .getPool(sellAddress, buyAddress, fee)
              .catch(() => ZERO_ADDRESS);
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
              bestPath = [sellAddress, buyAddress];
              bestProtocol = "V3";
              bestV3Fee = fee;
            }
          }
        } catch {
          // ignore V3 lookup failures and keep best available route
        }
      }

      if (!bestOut || !bestPath.length || !bestProtocol) {
        throw new Error("No route with available liquidity.");
      }

      let priceImpact: number | null = null;
      if (bestProtocol === "V2" && bestPath.length === 2) {
        try {
          const meta = await getV2QuoteWithMeta(provider, parsedAmount, bestPath[0], bestPath[1]);
          if (Number.isFinite(meta?.priceImpactPct)) {
            priceImpact = Number(meta.priceImpactPct);
          }
        } catch {
          // no-op
        }
      }

      setQuote({
        loading: false,
        error: "",
        amountOut: bestOut,
        path: bestPath,
        priceImpact,
        protocol: bestProtocol,
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
  }, [amount, buildCandidatePaths, buyAddress, sellAddress, sellDecimals]);

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
        return { needsErc20: false, needsPermit2: false };
      }

      const provider = getReadOnlyProvider();
      const erc20 = new Contract(token.address, ERC20_ABI, provider);
      const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);

      const [erc20Allowance, permit2AllowanceRaw] = await Promise.all([
        erc20.allowance(owner, PERMIT2_ADDRESS),
        permit2.allowance(owner, token.address, UNIV3_UNIVERSAL_ROUTER_ADDRESS),
      ]);

      const permit2Amount = BigInt((permit2AllowanceRaw?.[0] || 0n).toString());
      return {
        needsErc20: BigInt(erc20Allowance.toString()) < amountIn,
        needsPermit2: permit2Amount < amountIn,
      };
    },
    [side, token.address]
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

  const runTrade = async (skipUnverifiedCheck = false) => {
    if (!isConnected || !address) {
      onConnect();
      return;
    }

    if (!token.verified && side === "buy" && !skipUnverifiedCheck) {
      setConfirmUnverifiedOpen(true);
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
          const approveTx = await erc20.approve(PERMIT2_ADDRESS, MAX_UINT256);
          const dispose = await trackPendingTx(String(approveTx.hash || ""));
          await approveTx.wait();
          dispose();
        }

        if (approval.needsPermit2) {
          setTx({ stage: "awaiting_signature", message: "Approve Permit2 spender..." });
          const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, signer);
          const approveTx = await permit2.approve(
            token.address,
            UNIV3_UNIVERSAL_ROUTER_ADDRESS,
            MAX_UINT160,
            MAX_UINT48
          );
          const dispose = await trackPendingTx(String(approveTx.hash || ""));
          await approveTx.wait();
          dispose();
        }
      }

      const minOut = (quote.amountOut * BigInt(Math.max(1, 10000 - slippageBps))) / 10000n;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      const abi = AbiCoder.defaultAbiCoder();
      const universal = new Contract(
        UNIV3_UNIVERSAL_ROUTER_ADDRESS,
        UNIV3_UNIVERSAL_ROUTER_ABI,
        signer
      );

      const commands: number[] = [];
      const inputs: string[] = [];
      const isEthIn = side === "buy";
      const isEthOut = side === "sell";
      const payerIsUser = !isEthIn;
      const useV3Route = quote.protocol === "V3" || Boolean(quote.v3Fee);

      if (isEthIn) {
        commands.push(UR_COMMANDS.WRAP_ETH);
        inputs.push(
          abi.encode(["address", "uint256"], [UNIV3_UNIVERSAL_ROUTER_ADDRESS, parsedAmount])
        );
      }

      const recipient = isEthOut ? UNIV3_UNIVERSAL_ROUTER_ADDRESS : user;
      if (useV3Route) {
        const fee = Number(quote.v3Fee || V3_FEE_TIERS[0]);
        const encodedPath = encodeV3Path(quote.path, [fee]);
        commands.push(UR_COMMANDS.V3_SWAP_EXACT_IN);
        inputs.push(
          abi.encode(
            ["address", "uint256", "uint256", "bytes", "bool"],
            [recipient, parsedAmount, minOut, encodedPath, payerIsUser]
          )
        );
      } else {
        commands.push(UR_COMMANDS.V2_SWAP_EXACT_IN);
        inputs.push(
          abi.encode(
            ["address", "uint256", "uint256", "address[]", "bool"],
            [recipient, parsedAmount, minOut, quote.path, payerIsUser]
          )
        );
      }

      if (isEthOut) {
        commands.push(UR_COMMANDS.UNWRAP_WETH);
        inputs.push(abi.encode(["address", "uint256"], [user, minOut]));
      }

      setTx({ stage: "awaiting_signature", message: "Confirm swap in wallet..." });
      const txRequest = await universal.execute(
        buildCommandBytes(commands),
        inputs,
        deadline,
        isEthIn ? { value: parsedAmount } : {}
      );

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

      <UnverifiedTokenModal
        open={confirmUnverifiedOpen}
        tokenSymbol={token.symbol}
        onCancel={() => setConfirmUnverifiedOpen(false)}
        onConfirm={() => {
          setConfirmUnverifiedOpen(false);
          void runTrade(true);
        }}
        loading={submitLoading}
      />
    </div>
  );
};

const trimTrailingZeros = (value: string): string => {
  if (typeof value !== "string" || !value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
};

export default React.memo(TradeWidget);
