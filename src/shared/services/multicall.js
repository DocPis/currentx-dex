// src/shared/services/multicall.js
import { Contract } from "ethers";
import { MULTICALL3_ABI } from "../config/abis";
import { MULTICALL3_ADDRESS } from "../config/addresses";
import { getReadOnlyProvider } from "../config/web3";

export const hasMulticall = async (provider) => {
  try {
    const code = await provider.getCode(MULTICALL3_ADDRESS);
    return code && code !== "0x";
  } catch {
    return false;
  }
};

export async function multicall(callStructs, providerOverride) {
  const provider = providerOverride || getReadOnlyProvider();
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const calls = callStructs.map((c) => ({
    target: c.target,
    allowFailure: c.allowFailure !== false, // default true
    callData: c.callData,
  }));
  // Use static call to avoid requiring a signer (aggregate3 is nonpayable).
  const res = await mc.aggregate3.staticCall(calls);
  return res.map((r, i) => ({
    success: r.success,
    returnData: r.returnData,
    requested: callStructs[i],
  }));
}
