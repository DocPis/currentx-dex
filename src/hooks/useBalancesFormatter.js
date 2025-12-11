// src/hooks/useBalancesFormatter.js

export function useBalancesFormatter(balances) {
  function getBalanceLabel(symbol) {
    if (!balances) return "—";

    const v = balances[symbol];
    if (v == null || Number.isNaN(Number(v))) return "—";

    // accetto sia number che string
    const num = typeof v === "number" ? v : Number(v);

    return `${num.toFixed(6)} ${symbol}`;
  }

  return { getBalanceLabel };
}
