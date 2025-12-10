// src/hooks/useBalancesFormatter.js
import { useCallback } from "react";

/**
 * Gestisce lettura e formattazione dei balance
 * per simboli tipo ETH, WETH, USDC, ecc.
 */
export default function useBalancesFormatter(balances, tokensConfig) {
  const getBalanceFor = useCallback(
    (symbol) => {
      if (!balances) return null;
      const v = balances[symbol];
      if (typeof v !== "number" || Number.isNaN(v)) return null;
      return v;
    },
    [balances]
  );

  const getBalanceLabel = useCallback(
    (symbol) => {
      const bal = getBalanceFor(symbol);
      if (bal == null) return "—";

      const decimals = tokensConfig[symbol]?.decimals ?? 4;
      const precision = decimals > 6 ? 6 : decimals;
      return `${bal.toFixed(precision)} ${symbol}`;
    },
    [getBalanceFor, tokensConfig]
  );

  return {
    getBalanceFor,
    getBalanceLabel,
  };
}
