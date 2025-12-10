// src/utils/getBalances.js

import { ethers } from "ethers";
import { TOKEN_REGISTRY } from "./tokenRegistry";

// ABI minimale ERC20: balanceOf (decimals lo prendiamo dal registry)
const ERC20_ABI = [
  {
    inputs: [{ internalType: "address", name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

// Funzione principale: legge i balance RAW di tutti i token del registry
export async function getBalances(provider, account) {
  if (!provider || !account) {
    return {};
  }

  const balances = {};

  for (const token of TOKEN_REGISTRY) {
    try {
      const tokenAddress = token.address; // già lowercase e valido
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const raw = await contract.balanceOf(account);

      // Salviamo il BigNumber/uint256 grezzo
      balances[token.symbol] = raw;
    } catch (err) {
      console.error(
        `Error loading balance for ${token.symbol}:`,
        err?.message || err
      );
    }
  }

  return balances;
}

// Alias compatibile con il vecchio codice: App.jsx importa { getAllBalances }
export async function getAllBalances(provider, account) {
  return getBalances(provider, account);
}

// Default export per compatibilità extra
export default getBalances;

