// src/shared/services/v3Staker.js
import { AbiCoder, Interface, keccak256 } from "ethers";
import { V3_STAKER_ABI } from "../config/abis";
import { V3_STAKER_ADDRESS } from "../config/addresses";

export const V3_STAKER_DEPLOY_BLOCK = 7873058;

const INCENTIVE_KEY_TYPE =
  "tuple(address rewardToken,address pool,uint256 startTime,uint256 endTime,address refundee)";

const abi = AbiCoder.defaultAbiCoder();
const iface = new Interface(V3_STAKER_ABI);
const incentiveCreatedTopic = iface.getEvent("IncentiveCreated").topicHash;
const depositTransferredTopic = iface.getEvent("DepositTransferred").topicHash;

const encodeIncentiveKey = (key) => abi.encode([INCENTIVE_KEY_TYPE], [key]);
export const getIncentiveId = (key) => keccak256(encodeIncentiveKey(key));

const asTopicAddress = (address) =>
  `0x${(address || "").toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

const fetchLogsInChunks = async (provider, filter, fromBlock, toBlock, chunkSize = 4000) => {
  const logs = [];
  let start = fromBlock;
  const end = toBlock;
  while (start <= end) {
    const chunkEnd = Math.min(end, start + chunkSize - 1);
    const res = await provider.getLogs({ ...filter, fromBlock: start, toBlock: chunkEnd });
    if (res?.length) logs.push(...res);
    start = chunkEnd + 1;
  }
  return logs;
};

export async function fetchV3StakerIncentives(provider, opts = {}) {
  const fromBlock = Number(opts.fromBlock || V3_STAKER_DEPLOY_BLOCK);
  const latest =
    typeof opts.toBlock === "number" ? opts.toBlock : await provider.getBlockNumber();
  const logs = await fetchLogsInChunks(
    provider,
    { address: V3_STAKER_ADDRESS, topics: [incentiveCreatedTopic] },
    fromBlock,
    latest,
    opts.chunkSize || 5000
  );
  const incentives = [];
  const seen = new Set();
  logs.forEach((log) => {
    try {
      const parsed = iface.parseLog(log);
      const rewardToken = parsed.args?.rewardToken;
      const pool = parsed.args?.pool;
      const startTime = Number(parsed.args?.startTime || 0);
      const endTime = Number(parsed.args?.endTime || 0);
      const refundee = parsed.args?.refundee;
      const reward = parsed.args?.reward ?? 0n;
      if (!rewardToken || !pool || !startTime || !endTime || !refundee) return;
      const key = { rewardToken, pool, startTime, endTime, refundee };
      const incentiveId = getIncentiveId(key);
      if (seen.has(incentiveId)) return;
      seen.add(incentiveId);
      incentives.push({
        id: incentiveId,
        rewardToken,
        pool,
        startTime,
        endTime,
        refundee,
        reward,
        createdBlock: log.blockNumber,
        createdTx: log.transactionHash,
      });
    } catch {
      // ignore malformed logs
    }
  });
  return incentives.sort((a, b) => a.startTime - b.startTime);
}

export async function fetchV3StakerDepositsForUser(provider, address, opts = {}) {
  if (!address) return [];
  const fromBlock = Number(opts.fromBlock || V3_STAKER_DEPLOY_BLOCK);
  const latest =
    typeof opts.toBlock === "number" ? opts.toBlock : await provider.getBlockNumber();
  const addrTopic = asTopicAddress(address);
  const logsOld = await fetchLogsInChunks(
    provider,
    { address: V3_STAKER_ADDRESS, topics: [depositTransferredTopic, null, addrTopic] },
    fromBlock,
    latest,
    opts.chunkSize || 5000
  );
  const logsNew = await fetchLogsInChunks(
    provider,
    { address: V3_STAKER_ADDRESS, topics: [depositTransferredTopic, null, null, addrTopic] },
    fromBlock,
    latest,
    opts.chunkSize || 5000
  );
  const logs = [...logsOld, ...logsNew].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return (a.logIndex || 0) - (b.logIndex || 0);
  });

  const ownerByToken = new Map();
  logs.forEach((log) => {
    try {
      const parsed = iface.parseLog(log);
      const tokenId = parsed.args?.tokenId;
      const newOwner = (parsed.args?.newOwner || "").toLowerCase();
      if (tokenId === undefined || tokenId === null) return;
      ownerByToken.set(String(tokenId), newOwner);
    } catch {
      // ignore malformed logs
    }
  });

  const target = address.toLowerCase();
  const out = [];
  ownerByToken.forEach((owner, tokenId) => {
    if (owner === target) out.push(tokenId);
  });
  return out;
}
