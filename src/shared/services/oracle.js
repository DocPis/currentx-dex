// src/shared/services/oracle.js
import { Contract } from "ethers";
import { HIGH_PRECISION_TIMESTAMP_ORACLE_ABI } from "../config/abis";
import { HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS } from "../config/addresses";
import { getReadOnlyProvider } from "../config/web3";

// Reads the microsecond-precision timestamp from the oracle.
export async function fetchHighPrecisionTimestamp(providerOverride) {
  const provider = providerOverride || getReadOnlyProvider();
  const oracle = new Contract(
    HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS,
    HIGH_PRECISION_TIMESTAMP_ORACLE_ABI,
    provider
  );
  const raw = await oracle.timestamp();
  const microseconds = typeof raw === "bigint" ? raw : BigInt(raw || 0);
  const msBigInt = microseconds / 1000n;
  const msNumber =
    msBigInt <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(msBigInt)
      : Number.MAX_SAFE_INTEGER;

  return {
    microseconds,
    milliseconds: msBigInt,
    date: new Date(msNumber),
  };
}
