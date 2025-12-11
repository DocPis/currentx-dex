// src/utils/getBalances.js

import { BrowserProvider, Contract } from "ethers";
import { TOKEN_REGISTRY } from "./tokenRegistry";

// ABI minimo ERC20: solo balanceOf(address)
const ERC20_ABI = [
  {
    inputs: [{ internalType: "address", name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

// Funzione principale usata in App.jsx
export async function getAllBalances(address) {
  if (!address || !window.ethereum) return {};

  try {
    const provider = new BrowserProvider(window.ethereum);
    const balances = {};

    for (const token of TOKEN_REGISTRY) {
      try {
        const contract = new Contract(token.address, ERC20_ABI, provider);
        const raw = await contract.balanceOf(address);
        balances[token.symbol] = raw;
      } catch (err) {
        console.error(
          `Error loading balance for ${token.symbol}:`,
          err?.message || err
        );
      }
    }

    return balances;
  } catch (err) {
    console.error("getAllBalances error:", err);
    return {};
  }
}

// Alias compatibile se da qualche parte importi getBalances
export async function getBalances(address) {
  return getAllBalances(address);
}

export default getAllBalances;
