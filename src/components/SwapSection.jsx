// src/components/SwapSection.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Contract, formatUnits, parseUnits } from "ethers";
import {
  TOKENS,
  getProvider,
  getV2QuoteWithMeta,
  WETH_ADDRESS,
  ERC20_ABI,
  WETH_ABI,
  UNIV2_ROUTER_ABI,
  UNIV2_ROUTER_ADDRESS,
  getRegisteredCustomTokens,
  setRegisteredCustomTokens,
} from "../config/web3";
import currentxLogo from "../assets/currentx.png";

const BASE_TOKEN_OPTIONS = ["ETH", "WETH", "USDC", "USDT", "DAI", "WBTC", "CRX"];

function TokenSelector({ side, selected, onSelect, balances, tokenRegistry, tokenOptions }) {
  const [open, setOpen] = useState(false);
  const meta = tokenRegistry[selected] || {};
  const logo = meta.logo;
  const balanceDisplay = balances?.[selected] ?? 0;
  return (
    <div className="relative w-full sm:w-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-100 border border-slate-700 flex items-center gap-2 shadow-inner shadow-black/30 min-w-0 w-full sm:w-auto sm:min-w-[120px] hover:border-sky-500/60 transition"
      >
        {logo ? (
          <img
            src={logo}
            alt={`${meta.symbol || selected} logo`}
            className="h-6 w-6 rounded-full object-contain"
          />
        ) : (
          <div className="h-6 w-6 rounded-full bg-slate-700 text-[10px] font-semibold flex items-center justify-center text-white">
            {(meta.symbol || selected || "?").slice(0, 2)}
          </div>
        )}
        <span className="text-sm font-semibold">{meta.symbol || selected}</span>
        <svg
          className="ml-auto h-3.5 w-3.5 text-slate-400"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-52 bg-slate-900 border border-slate-800 rounded-xl shadow-xl shadow-black/50 overflow-hidden">
          {tokenOptions.map((symbol) => {
            const optionMeta = tokenRegistry[symbol] || {};
            const optLogo = optionMeta.logo;
            return (
            <button
              key={`${side}-${symbol}`}
              onClick={() => {
                onSelect(symbol);
                setOpen(false);
              }}
              className={`w-full px-3 py-2 flex items-center gap-2 text-sm transition ${
                symbol === selected
                  ? "bg-slate-800 text-white"
                  : "text-slate-200 hover:bg-slate-800/80"
              }`}
            >
              {optLogo ? (
                <img
                  src={optLogo}
                  alt={`${optionMeta.symbol || symbol} logo`}
                  className="h-6 w-6 rounded-full object-contain"
                />
              ) : (
                <div className="h-6 w-6 rounded-full bg-slate-800 text-[10px] font-semibold flex items-center justify-center text-white border border-slate-700">
                  {(optionMeta.symbol || symbol).slice(0, 2)}
                </div>
              )}
              <div className="flex flex-col items-start">
                <span className="font-medium">{optionMeta.symbol || symbol}</span>
              </div>
              <span className="ml-auto text-[11px] text-slate-400">
                {(balances[symbol] || 0).toFixed(3)}
              </span>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SwapSection({ balances }) {
  const [customTokens, setCustomTokens] = useState(() => getRegisteredCustomTokens());
  const tokenRegistry = useMemo(
    () => ({ ...TOKENS, ...customTokens }),
    [customTokens]
  );
  const [sellToken, setSellToken] = useState("ETH");
  const [buyToken, setBuyToken] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [quoteOut, setQuoteOut] = useState(null);
  const [quoteOutRaw, setQuoteOutRaw] = useState(null);
  const [priceImpact, setPriceImpact] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [slippage, setSlippage] = useState("0.5");
  const [swapStatus, setSwapStatus] = useState(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [approveNeeded, setApproveNeeded] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);
  const [customAddress, setCustomAddress] = useState("");
  const [customStatus, setCustomStatus] = useState("");
  const [customLoading, setCustomLoading] = useState(false);

  useEffect(() => {
    setRegisteredCustomTokens(customTokens);
  }, [customTokens]);

  const tokenOptions = useMemo(() => {
    const customKeys = Object.keys(customTokens || {});
    const orderedBase = BASE_TOKEN_OPTIONS;
    const extras = customKeys.filter((k) => !orderedBase.includes(k));
    return [...orderedBase, ...extras];
  }, [customTokens]);
  const sellBalance = balances?.[sellToken] || 0;
  const handleQuickPercent = (pct) => {
    const bal = balances?.[sellToken] || 0;
    const decimals = Math.min(6, tokenRegistry[sellKey]?.decimals ?? 6);
    if (!bal) {
      setAmountIn("");
      return;
    }
    const val = (bal * pct).toFixed(decimals);
    setAmountIn(val);
  };

  const sellKey = sellToken === "ETH" ? "WETH" : sellToken;
  const buyKey = buyToken === "ETH" ? "WETH" : buyToken;
  const sellMeta = tokenRegistry[sellKey];
  const buyMeta = tokenRegistry[buyKey];
  const isDirectEthWeth =
    (sellToken === "ETH" && buyToken === "WETH") ||
    (sellToken === "WETH" && buyToken === "ETH");
  const involvesCrx = sellToken === "CRX" || buyToken === "CRX";
  const isSupported =
    Boolean(sellMeta?.address || sellToken === "ETH") &&
    Boolean(buyMeta?.address || buyToken === "ETH");

  const loadCustomToken = async (address, target) => {
    const addr = (address || "").trim();
    setCustomStatus("");
    if (!addr) {
      setCustomStatus("Inserisci un address valido (0x...).");
      return;
    }
    if (!addr.startsWith("0x") || addr.length !== 42) {
      setCustomStatus("Indirizzo non valido.");
      return;
    }
    try {
      setCustomLoading(true);
      const provider = await getProvider();
      const normalized = addr.toLowerCase();
      const contract = new Contract(addr, ERC20_ABI, provider);
      const [symbolRaw, nameRaw, decimalsRaw] = await Promise.all([
        contract.symbol().catch(() => "TOKEN"),
        contract.name().catch(() => "Custom token"),
        contract.decimals().catch(() => 18),
      ]);
      const decimals = Number(decimalsRaw) || 18;
      const baseSymbol = (symbolRaw || "TOKEN").toUpperCase();
      let key = baseSymbol;
      let suffix = 1;
      while (
        tokenRegistry[key] &&
        tokenRegistry[key].address?.toLowerCase() !== normalized
      ) {
        key = `${baseSymbol}_${suffix++}`;
      }
      const meta = {
        symbol: key,
        name: nameRaw || baseSymbol,
        address: normalized,
        decimals,
        logo: currentxLogo,
      };
      setCustomTokens((prev) => ({
        ...prev,
        [key]: meta,
      }));
      if (target === "sell") setSellToken(key);
      if (target === "buy") setBuyToken(key);
      setCustomStatus(`Token ${key} aggiunto`);
    } catch (err) {
      setCustomStatus(err?.message || "Impossibile caricare il token");
    } finally {
      setCustomLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchQuote = async () => {
      setQuoteError("");
      setQuoteOut(null);
      setQuoteOutRaw(null);
      setPriceImpact(null);
      setApproveNeeded(false);

      if (involvesCrx) {
        setQuoteError("CRX swaps coming soon (mock token).");
        return;
      }

      if (!amountIn || Number.isNaN(Number(amountIn))) return;
      if (!isSupported) {
        setQuoteError("Seleziona token con indirizzo valido.");
        return;
      }

      if (isDirectEthWeth) {
        const directWei = parseUnits(amountIn, sellMeta?.decimals ?? 18);
        setQuoteOut(amountIn);
        setQuoteOutRaw(directWei);
        setPriceImpact(0);
        return;
      }

      try {
        setQuoteLoading(true);
        const provider = await getProvider();
        const sellAddress = sellMeta?.address;
        const buyAddress = buyMeta?.address;
        const amountWei = parseUnits(amountIn, sellMeta?.decimals ?? 18);

        const meta = await getV2QuoteWithMeta(
          provider,
          amountWei,
          sellAddress,
          buyAddress
        );
        if (cancelled) return;

        const tokensLower = [meta.token0, meta.token1].map((t) =>
          t.toLowerCase()
        );
        if (
          !tokensLower.includes(sellAddress.toLowerCase()) ||
          !tokensLower.includes(buyAddress.toLowerCase())
        ) {
          throw new Error(
            "Resolved pair tokens do not match the selected assets"
          );
        }

        const formatted = formatUnits(meta.amountOut, buyMeta?.decimals ?? 18);
        setQuoteOut(formatted);
        setQuoteOutRaw(meta.amountOut);
        setPriceImpact(meta.priceImpactPct);

        // Precompute allowance requirement for ERC20 sells
        if (sellToken !== "ETH" && sellAddress) {
          try {
            const signer = await provider.getSigner();
            const user = await signer.getAddress();
            const token = new Contract(sellAddress, ERC20_ABI, signer);
            const allowance = await token.allowance(
              user,
              UNIV2_ROUTER_ADDRESS
            );
            setApproveNeeded(allowance < amountWei);
          } catch {
            setApproveNeeded(false);
          }
        } else {
          setApproveNeeded(false);
        }
      } catch (e) {
        if (cancelled) return;
        setQuoteError(e.message || "Failed to fetch quote");
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    };
    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [amountIn, sellToken, buyToken, isSupported]);

  const slippageBps = (() => {
    const val = Number(slippage);
    if (Number.isNaN(val) || val < 0) return 50;
    return Math.min(5000, Math.round(val * 100));
  })();

  const minReceivedRaw = quoteOutRaw
    ? (quoteOutRaw * BigInt(10000 - slippageBps)) / 10000n
    : null;

  const handleApprove = async () => {
    if (sellToken === "ETH") return;
    try {
      setApproveLoading(true);
      setSwapStatus(null);
      if (!amountIn || Number.isNaN(Number(amountIn))) {
        throw new Error("Enter a valid amount");
      }
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();
      const sellAddress = sellMeta?.address;
      const amountWei = parseUnits(amountIn, sellMeta?.decimals ?? 18);
      const token = new Contract(sellAddress, ERC20_ABI, signer);
      const allowance = await token.allowance(user, UNIV2_ROUTER_ADDRESS);
      if (allowance >= amountWei) {
        setApproveNeeded(false);
        return;
      }
      const tx = await token.approve(UNIV2_ROUTER_ADDRESS, amountWei);
      await tx.wait();
      setApproveNeeded(false);
      setSwapStatus({
        variant: "success",
        message: "Approval successful",
      });
    } catch (e) {
      const userRejected =
        e?.code === 4001 ||
        e?.code === "ACTION_REJECTED" ||
        (e?.message || "").toLowerCase().includes("user denied");
      setSwapStatus({
        variant: "error",
        message: userRejected
          ? "Approval was rejected in wallet."
          : e.message || "Approve failed",
      });
    } finally {
      setApproveLoading(false);
    }
  };

  const handleSwap = async () => {
    try {
      setSwapStatus(null);
      if (swapLoading) return;
      if (!amountIn || Number.isNaN(Number(amountIn))) {
        throw new Error("Enter a valid amount");
      }
      if (!isSupported) {
        throw new Error("Seleziona token con indirizzo valido.");
      }
      if (involvesCrx) {
        throw new Error("CRX swaps coming soon (mock token).");
      }
      if (!quoteOutRaw) {
        throw new Error("Fetching quote, please retry");
      }

      setSwapLoading(true);
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();
      const sellAddress = sellMeta?.address;
      const buyAddress = buyMeta?.address;
      const amountWei = parseUnits(amountIn, sellMeta?.decimals ?? 18);

      if (isDirectEthWeth) {
        const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);
        let tx;
        if (sellToken === "ETH") {
          tx = await weth.deposit({ value: amountWei });
        } else {
          tx = await weth.withdraw(amountWei);
        }
        const receipt = await tx.wait();
        setSwapStatus({
          message: `Swap executed (wrap/unwrap). Received ${formatUnits(
            amountWei,
            buyMeta?.decimals ?? 18
          )} ${buyToken}`,
          hash: receipt.hash,
          variant: "success",
        });
        return;
      }

      let amountOut = quoteOutRaw;
      if (!amountOut) {
        const res = await getV2QuoteWithMeta(
          provider,
          amountWei,
          sellAddress,
          buyAddress
        );
        amountOut = res?.amountOut;
      }
      if (!amountOut) {
        throw new Error("Impossibile calcolare l'output minimo.");
      }

      const minOut = (amountOut * BigInt(10000 - slippageBps)) / 10000n;
      const router = new Contract(
        UNIV2_ROUTER_ADDRESS,
        UNIV2_ROUTER_ABI,
        signer
      );
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minuti

      let tx;
      if (sellToken === "ETH") {
        const path = [WETH_ADDRESS, buyAddress];
        tx = await router.swapExactETHForTokens(
          minOut,
          path,
          user,
          deadline,
          { value: amountWei }
        );
      } else if (buyToken === "ETH") {
        const path = [sellAddress, WETH_ADDRESS];
        const token = new Contract(sellAddress, ERC20_ABI, signer);
        const allowance = await token.allowance(user, UNIV2_ROUTER_ADDRESS);
        if (allowance < amountWei) {
          await (await token.approve(UNIV2_ROUTER_ADDRESS, amountWei)).wait();
        }
        tx = await router.swapExactTokensForETH(
          amountWei,
          minOut,
          path,
          user,
          deadline
        );
      } else {
        const path = [sellAddress, buyAddress];
        const token = new Contract(sellAddress, ERC20_ABI, signer);
        const allowance = await token.allowance(user, UNIV2_ROUTER_ADDRESS);
        if (allowance < amountWei) {
          await (await token.approve(UNIV2_ROUTER_ADDRESS, amountWei)).wait();
        }
        tx = await router.swapExactTokensForTokens(
          amountWei,
          minOut,
          path,
          user,
          deadline
        );
      }

      const receipt = await tx.wait();

      setSwapStatus({
        message: `Swap executed. Min received: ${formatUnits(
          minOut,
          buyMeta?.decimals ?? 18
        )} ${buyToken}`,
        hash: receipt.hash,
        variant: "success",
      });
    } catch (e) {
      const userRejected =
        e?.code === 4001 ||
        e?.code === "ACTION_REJECTED" ||
        (e?.message || "").toLowerCase().includes("user denied");
      const message = userRejected
        ? "Transaction was rejected in wallet."
        : e.message || "Swap failed";
      setSwapStatus({ message, variant: "error" });
    } finally {
      setSwapLoading(false);
    }
  };

  return (
    <div className="w-full flex flex-col items-center mt-10 px-4 sm:px-0">
      <div className="w-full max-w-xl rounded-3xl bg-slate-900/80 border border-slate-800 p-4 sm:p-6 shadow-xl">
        <div className="mb-4 rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
            <span>Sell</span>
            <span className="font-medium text-slate-300">
              Balance: {(balances[sellToken] || 0).toFixed(4)} {sellToken}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <TokenSelector
              side="sell"
              selected={sellToken}
              onSelect={(sym) => {
                if (sym === buyToken) setBuyToken(sellToken);
                setSellToken(sym);
              }}
              tokenRegistry={tokenRegistry}
              tokenOptions={tokenOptions}
              balances={balances}
            />
            <input
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0.00"
              className="flex-1 text-right bg-transparent text-2xl font-semibold text-slate-50 outline-none placeholder:text-slate-700 w-full"
            />
          </div>
          <div className="flex justify-end gap-2 mt-3 text-[11px] sm:text-xs">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleQuickPercent(p)}
                className="px-2 py-1 rounded-lg border border-slate-700 bg-slate-800/60 text-slate-200 hover:border-sky-500/60 transition"
              >
                {Math.round(p * 100)}%
              </button>
            ))}
            <div className="px-2 py-1 text-slate-400">
              {(sellBalance || 0).toFixed(4)} {sellToken} disponibili
            </div>
          </div>
        </div>

        <div className="flex justify-center my-2">
          <button
            onClick={() => {
              setSellToken(buyToken);
              setBuyToken(sellToken);
            }}
            className="h-10 w-10 rounded-full border border-slate-700 bg-slate-900 flex items-center justify-center text-slate-200 text-lg shadow-md shadow-black/30 hover:border-sky-500/60 transition"
            aria-label="Invert tokens"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
            >
              <path
                d="M12 4l3 3h-2v7h-2V7H9l3-3ZM12 20l-3-3h2v-7h2v7h2l-3 3Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <div className="mb-4 rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
            <span>Buy</span>
            <span className="font-medium text-slate-300">
              Balance: {(balances[buyToken] || 0).toFixed(2)} {buyToken}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <TokenSelector
              side="buy"
              selected={buyToken}
              onSelect={(sym) => {
                if (sym === sellToken) setSellToken(buyToken);
                setBuyToken(sym);
              }}
              tokenRegistry={tokenRegistry}
              tokenOptions={tokenOptions}
              balances={balances}
            />
            <div className="flex-1 text-right w-full">
              <div className="text-2xl sm:text-3xl font-semibold text-slate-50">
                {quoteOut !== null ? Number(quoteOut).toFixed(6) : "0.00"}
              </div>
              <div className="text-[11px] text-slate-500">
                {quoteLoading
                  ? "Loading quote..."
                  : quoteError ||
                    (amountIn
                      ? isDirectEthWeth
                        ? "Direct wrap/unwrap (no fee)"
                        : "Live quote via Uniswap V2 (Sepolia)"
                      : "Enter an amount to fetch a quote")}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-slate-900 border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-2">Custom token address (ERC20)</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={customAddress}
              onChange={(e) => setCustomAddress(e.target.value)}
              placeholder="0x... token address"
              className="flex-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-100"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => loadCustomToken(customAddress, "sell")}
                disabled={customLoading}
                className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm hover:border-sky-500/60 disabled:opacity-60"
              >
                {customLoading ? "Loading..." : "Use for Sell"}
              </button>
              <button
                type="button"
                onClick={() => loadCustomToken(customAddress, "buy")}
                disabled={customLoading}
                className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm hover:border-sky-500/60 disabled:opacity-60"
              >
                {customLoading ? "Loading..." : "Use for Buy"}
              </button>
            </div>
          </div>
          {customStatus && (
            <div className="mt-2 text-[11px] text-slate-300">{customStatus}</div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <div className="flex-1 rounded-2xl bg-slate-900 border border-slate-800 p-3 text-xs text-slate-300">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Slippage (%)</span>
              <div className="flex items-center gap-2">
                {[0.1, 0.5, 1].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSlippage(String(p))}
                    className={`px-2 py-1 rounded-lg text-[11px] border ${
                      Number(slippage) === p
                        ? "bg-sky-500/20 border-sky-500/50 text-sky-100"
                        : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {p}%
                  </button>
                ))}
                <input
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className="w-20 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-right text-slate-100 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500">Min received</span>
              <span className="text-slate-100">
                {minReceivedRaw
                  ? `${Number(
                      formatUnits(minReceivedRaw, buyMeta?.decimals ?? 18)
                    ).toFixed(6)} ${buyToken}`
                  : "--"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] mt-1">
              <span className="text-slate-500">Price impact</span>
              <span className="text-slate-100">
                {priceImpact !== null ? `${priceImpact.toFixed(2)}%` : "--"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full sm:w-44">
            {approveNeeded && sellToken !== "ETH" ? (
              <button
                onClick={handleApprove}
                disabled={approveLoading || quoteLoading}
                className="w-full py-3 rounded-2xl bg-slate-800 border border-slate-700 text-sm font-semibold text-white hover:border-sky-500/60 transition disabled:opacity-60"
              >
                {approveLoading ? "Approving..." : `Approve ${sellToken}`}
              </button>
            ) : null}
            <button
              onClick={handleSwap}
              disabled={swapLoading || quoteLoading || (approveNeeded && sellToken !== "ETH")}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-600 text-sm font-semibold text-white shadow-[0_10px_40px_-15px_rgba(56,189,248,0.75)] hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-60 disabled:scale-100"
            >
              <span className="inline-flex items-center gap-2 justify-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {swapLoading ? "Swapping..." : "Swap now"}
              </span>
            </button>
          </div>
        </div>

        {swapStatus && (
          <div
            className={`mt-2 text-xs rounded-xl px-3 py-2 border backdrop-blur-sm ${
              swapStatus.variant === "success"
                ? "bg-slate-900/80 border-slate-700 text-slate-100"
                : "bg-rose-500/10 border-rose-500/40 text-rose-100"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  swapStatus.variant === "success"
                    ? "bg-emerald-400"
                    : "bg-rose-400"
                }`}
              />
              <span>{swapStatus.message}</span>
            </div>
            {swapStatus.hash && (
              <a
                href={`https://sepolia.etherscan.io/tx/${swapStatus.hash}`}
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 hover:text-sky-300 underline mt-1 inline-block"
              >
                Open on SepoliaScan
              </a>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
