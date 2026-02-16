// src/shared/services/v3Staker.js
import { AbiCoder, Interface, keccak256 } from "ethers";
import { V3_STAKER_ABI } from "../config/abis";
import { V3_STAKER_ADDRESS } from "../config/addresses";

export const V3_STAKER_DEPLOY_BLOCK = 7873058;
const DEFAULT_LOG_CHUNK_SIZE = 5000;
const DEFAULT_LOG_CHUNK_CONCURRENCY = 3;
const LOG_REORG_WINDOW = 25;

const INCENTIVE_KEY_TYPE =
  "tuple(address rewardToken,address pool,uint256 startTime,uint256 endTime,address refundee)";

const abi = AbiCoder.defaultAbiCoder();
const iface = new Interface(V3_STAKER_ABI);
const incentiveCreatedTopic = iface.getEvent("IncentiveCreated").topicHash;
const depositTransferredTopic = iface.getEvent("DepositTransferred").topicHash;
const incentivesCache = new Map();
const depositsCache = new Map();

const encodeIncentiveKey = (key) => abi.encode([INCENTIVE_KEY_TYPE], [key]);
export const getIncentiveId = (key) => keccak256(encodeIncentiveKey(key));

const asTopicAddress = (address) =>
  `0x${(address || "").toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

const toSafeBlock = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.floor(num) : fallback;
};

const sortLogs = (logs = []) =>
  (logs || []).sort((a, b) => {
    const blockDelta = Number(a?.blockNumber || 0) - Number(b?.blockNumber || 0);
    if (blockDelta !== 0) return blockDelta;
    return Number(a?.logIndex || 0) - Number(b?.logIndex || 0);
  });

const runWithConcurrency = async (items = [], limit = 3, worker) => {
  if (!Array.isArray(items) || !items.length) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
};

const buildBlockRanges = (fromBlock, toBlock, chunkSize) => {
  if (fromBlock > toBlock) return [];
  const ranges = [];
  const size = Math.max(1, toSafeBlock(chunkSize, DEFAULT_LOG_CHUNK_SIZE));
  for (let start = fromBlock; start <= toBlock; start += size) {
    ranges.push([start, Math.min(toBlock, start + size - 1)]);
  }
  return ranges;
};

const fetchLogsInChunks = async (
  provider,
  filter,
  fromBlock,
  toBlock,
  chunkSize = DEFAULT_LOG_CHUNK_SIZE,
  chunkConcurrency = DEFAULT_LOG_CHUNK_CONCURRENCY
) => {
  if (fromBlock > toBlock) return [];
  const ranges = buildBlockRanges(fromBlock, toBlock, chunkSize);
  const chunks = await runWithConcurrency(
    ranges,
    Math.max(1, toSafeBlock(chunkConcurrency, DEFAULT_LOG_CHUNK_CONCURRENCY)),
    async ([start, end]) =>
      provider.getLogs({ ...filter, fromBlock: start, toBlock: end }).catch(() => [])
  );
  return sortLogs(chunks.flat().filter(Boolean));
};

const getProviderScope = async (provider) => {
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network?.chainId || 0);
    if (Number.isFinite(chainId) && chainId > 0) return String(chainId);
  } catch {
    // ignore network resolution failures
  }
  return "unknown";
};

const collectOwnedTokenIds = (ownerByToken, ownerLower) => {
  const out = [];
  ownerByToken.forEach((owner, tokenId) => {
    if (owner === ownerLower) out.push(tokenId);
  });
  return out;
};

const parseIncentiveLogsIntoMap = (logs, byId) => {
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
      byId.set(incentiveId, {
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
};

export async function fetchV3StakerIncentives(provider, opts = {}) {
  const fromBlock = Math.max(
    V3_STAKER_DEPLOY_BLOCK,
    toSafeBlock(opts.fromBlock, V3_STAKER_DEPLOY_BLOCK)
  );
  const latest =
    typeof opts.toBlock === "number"
      ? toSafeBlock(opts.toBlock, fromBlock)
      : await provider.getBlockNumber();
  if (latest < fromBlock) return [];

  const scope = await getProviderScope(provider);
  const cacheKey = `${scope}:${V3_STAKER_ADDRESS.toLowerCase()}:${fromBlock}`;
  const forceRefresh = Boolean(opts.forceRefresh);
  const cached = !forceRefresh ? incentivesCache.get(cacheKey) : null;
  let byId = cached?.byId ? new Map(cached.byId) : new Map();
  let queryFrom = fromBlock;

  if (cached && Number.isFinite(cached.toBlock)) {
    const cachedToBlock = Number(cached.toBlock);
    if (latest <= cachedToBlock) {
      return Array.from(byId.values()).sort((a, b) => a.startTime - b.startTime);
    }
    queryFrom = Math.max(fromBlock, cachedToBlock - LOG_REORG_WINDOW + 1);
  }

  const logs = await fetchLogsInChunks(
    provider,
    { address: V3_STAKER_ADDRESS, topics: [incentiveCreatedTopic] },
    queryFrom,
    latest,
    opts.chunkSize || DEFAULT_LOG_CHUNK_SIZE,
    opts.chunkConcurrency || DEFAULT_LOG_CHUNK_CONCURRENCY
  );
  parseIncentiveLogsIntoMap(logs, byId);

  incentivesCache.set(cacheKey, {
    toBlock: latest,
    byId,
  });

  return Array.from(byId.values()).sort((a, b) => a.startTime - b.startTime);
}

export async function fetchV3StakerDepositsForUser(provider, address, opts = {}) {
  if (!address) return [];
  const target = address.toLowerCase();
  const fromBlock = Math.max(
    V3_STAKER_DEPLOY_BLOCK,
    toSafeBlock(opts.fromBlock, V3_STAKER_DEPLOY_BLOCK)
  );
  const latest =
    typeof opts.toBlock === "number"
      ? toSafeBlock(opts.toBlock, fromBlock)
      : await provider.getBlockNumber();
  if (latest < fromBlock) return [];

  const scope = await getProviderScope(provider);
  const cacheKey = `${scope}:${V3_STAKER_ADDRESS.toLowerCase()}:${target}:${fromBlock}`;
  const forceRefresh = Boolean(opts.forceRefresh);
  const cached = !forceRefresh ? depositsCache.get(cacheKey) : null;
  let ownerByToken = cached?.ownerByToken
    ? new Map(cached.ownerByToken)
    : new Map();
  let queryFrom = fromBlock;

  if (cached && Number.isFinite(cached.toBlock)) {
    const cachedToBlock = Number(cached.toBlock);
    if (latest <= cachedToBlock) {
      return collectOwnedTokenIds(ownerByToken, target);
    }
    queryFrom = Math.max(fromBlock, cachedToBlock - LOG_REORG_WINDOW + 1);
  }

  const addrTopic = asTopicAddress(address);
  const [logsOld, logsNew] = await Promise.all([
    fetchLogsInChunks(
      provider,
      { address: V3_STAKER_ADDRESS, topics: [depositTransferredTopic, null, addrTopic] },
      queryFrom,
      latest,
      opts.chunkSize || DEFAULT_LOG_CHUNK_SIZE,
      opts.chunkConcurrency || DEFAULT_LOG_CHUNK_CONCURRENCY
    ),
    fetchLogsInChunks(
      provider,
      { address: V3_STAKER_ADDRESS, topics: [depositTransferredTopic, null, null, addrTopic] },
      queryFrom,
      latest,
      opts.chunkSize || DEFAULT_LOG_CHUNK_SIZE,
      opts.chunkConcurrency || DEFAULT_LOG_CHUNK_CONCURRENCY
    ),
  ]);
  const logs = sortLogs([...logsOld, ...logsNew]);
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

  depositsCache.set(cacheKey, {
    toBlock: latest,
    ownerByToken,
  });

  return collectOwnedTokenIds(ownerByToken, target);
}
