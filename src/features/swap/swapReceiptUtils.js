import { id } from "ethers";
import { WETH_ADDRESS } from "../../shared/config/web3";

const TRANSFER_TOPIC = id("Transfer(address,address,uint256)").toLowerCase();
const WETH_WITHDRAWAL_TOPIC = id("Withdrawal(address,uint256)").toLowerCase();
const WETH_DEPOSIT_TOPIC = id("Deposit(address,uint256)").toLowerCase();

const paddedTopicAddress = (addr) =>
  `0x${(addr || "").toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

export const findActualOutput = (receipt, targetAddress, userAddress, opts = {}) => {
  if (!receipt || !Array.isArray(receipt.logs) || !userAddress) return null;
  const targetLower = (targetAddress || "").toLowerCase();
  const userTopic = paddedTopicAddress(userAddress);
  const parseAmount = (data) => {
    if (!data) return 0n;
    try {
      return BigInt(data);
    } catch {
      return 0n;
    }
  };
  let transferToUser = 0n;
  let withdrawalToUser = 0n;
  let depositToUser = 0n;
  let sawTransfer = false;
  let sawWithdrawal = false;
  let sawDeposit = false;

  for (let i = 0; i < receipt.logs.length; i += 1) {
    const log = receipt.logs[i];
    const addr = (log?.address || "").toLowerCase();
    const topic0 = (log?.topics?.[0] || "").toLowerCase();

    if (targetLower && addr === targetLower && topic0 === TRANSFER_TOPIC) {
      const toTopic = (log?.topics?.[2] || "").toLowerCase();
      if (toTopic === userTopic) {
        const amount = parseAmount(log?.data);
        if (amount > 0n) {
          transferToUser += amount;
          sawTransfer = true;
        }
      }
    }

    if (
      opts.captureWithdrawal &&
      addr === WETH_ADDRESS.toLowerCase() &&
      topic0 === WETH_WITHDRAWAL_TOPIC
    ) {
      const dstTopic = (log?.topics?.[1] || "").toLowerCase();
      if (dstTopic === userTopic) {
        const amount = parseAmount(log?.data);
        if (amount > 0n) {
          withdrawalToUser += amount;
          sawWithdrawal = true;
        }
      }
    }

    if (
      opts.captureDeposit &&
      addr === WETH_ADDRESS.toLowerCase() &&
      topic0 === WETH_DEPOSIT_TOPIC
    ) {
      const dstTopic = (log?.topics?.[1] || "").toLowerCase();
      if (dstTopic === userTopic) {
        const amount = parseAmount(log?.data);
        if (amount > 0n) {
          depositToUser += amount;
          sawDeposit = true;
        }
      }
    }
  }

  // For wrap/unwrap flows, prefer dedicated WETH events to avoid double-counting
  // when both Deposit/Withdrawal and Transfer logs are present.
  if (opts.captureDeposit && sawDeposit) return depositToUser;
  if (opts.captureWithdrawal && sawWithdrawal) return withdrawalToUser;
  if (sawTransfer) return transferToUser;
  if (sawWithdrawal) return withdrawalToUser;
  if (sawDeposit) return depositToUser;
  return null;
};

