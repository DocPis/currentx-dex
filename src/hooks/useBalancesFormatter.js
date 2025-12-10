export function useBalancesFormatter(balances) {
  function getBalanceLabel(symbol) {
    if (!balances) return "—";
    const v = balances[symbol];
    if (v == null || Number.isNaN(v)) return "—";

    return `${v.toFixed(6)} ${symbol}`;
  }

  return { getBalanceLabel };
}
