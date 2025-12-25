// src/services/masterchef.js
import { Contract, formatUnits } from "ethers";
import {
  MASTER_CHEF_ABI,
  UNIV2_PAIR_ABI,
  ERC20_ABI,
} from "../config/abis";
import {
  CRX_ADDRESS,
  CRX_WETH_LP_ADDRESS,
  MASTER_CHEF_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WETH_ADDRESS,
  WETH_USDC_PAIR_ADDRESS,
} from "../config/addresses";
import { TOKENS } from "../config/tokens";
import { fetchV2PairData } from "../config/subgraph";
import { getV2PairReserves } from "./amm";

const BLOCKS_PER_YEAR = 2628000n; // ~12s block time

async function fetchTokenMeta(provider, address, cache = {}) {
  if (!address) return null;
  const lower = address.toLowerCase();
  if (cache[lower]) return cache[lower];

  const known = Object.values(TOKENS).find(
    (t) => t.address && t.address.toLowerCase() === lower
  );
  if (known) {
    cache[lower] = known;
    return known;
  }

  const erc = new Contract(address, ERC20_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([
    erc.symbol().catch(() => "TOKEN"),
    erc.name().catch(() => "Token"),
    erc.decimals().catch(() => 18),
  ]);

  const meta = {
    symbol,
    name,
    address,
    decimals: Number(decimals) || 18,
    logo: TOKENS.CRX.logo,
  };
  cache[lower] = meta;
  return meta;
}

async function getWethPriceUSD(provider, priceCache) {
  const key = WETH_ADDRESS.toLowerCase();
  const cached = priceCache[key];
  if (typeof cached === "number") return cached;
  const { reserve0, reserve1, token0 } = await getV2PairReserves(
    provider,
    WETH_ADDRESS,
    USDC_ADDRESS,
    WETH_USDC_PAIR_ADDRESS
  );
  const wethIs0 = token0.toLowerCase() === WETH_ADDRESS.toLowerCase();
  const wethRes = wethIs0 ? reserve0 : reserve1;
  const usdcRes = wethIs0 ? reserve1 : reserve0;
  const price =
    Number(formatUnits(usdcRes, TOKENS.USDC.decimals)) /
    Number(formatUnits(wethRes, TOKENS.WETH.decimals));
  priceCache[key] = price;
  return price;
}

async function getTokenPriceUSD(provider, address, priceCache) {
  if (!address) return null;
  const lower = address.toLowerCase();
  if (priceCache[lower] !== undefined) return priceCache[lower];

  try {
    if (
      lower === USDC_ADDRESS.toLowerCase() ||
      lower === USDT_ADDRESS.toLowerCase() ||
      lower === TOKENS.DAI.address.toLowerCase()
    ) {
      priceCache[lower] = 1;
      return 1;
    }

    if (lower === WETH_ADDRESS.toLowerCase()) {
      return getWethPriceUSD(provider, priceCache);
    }

    if (lower === CRX_ADDRESS.toLowerCase()) {
      const wethPrice = await getWethPriceUSD(provider, priceCache);
      const pair = new Contract(CRX_WETH_LP_ADDRESS, UNIV2_PAIR_ABI, provider);
      const [reserve0, reserve1] = await pair.getReserves();
      const token0 = await pair.token0();
      const crxIs0 = token0.toLowerCase() === lower;
      const crxRes = crxIs0 ? reserve0 : reserve1;
      const wethRes = crxIs0 ? reserve1 : reserve0;
      const priceInWeth =
        Number(formatUnits(wethRes, TOKENS.WETH.decimals)) /
        Number(formatUnits(crxRes, TOKENS.CRX.decimals));
      const usd = priceInWeth * wethPrice;
      priceCache[lower] = usd;
      return usd;
    }
  } catch {
    return null;
  }

  return null;
}

async function getLpSummary(provider, lpAddress, priceCache, metaCache) {
  const pair = new Contract(lpAddress, UNIV2_PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const [token0, token1, totalSupply, lpDecimalsRaw] = await Promise.all([
    pair.token0(),
    pair.token1(),
    typeof pair.totalSupply === "function"
      ? pair.totalSupply().catch(() => 0n)
      : Promise.resolve(0n),
    typeof pair.decimals === "function"
      ? pair.decimals().catch(() => 18)
      : Promise.resolve(18),
  ]);
  const lpDecimals = Number(lpDecimalsRaw || 18) || 18;

  const meta0 = await fetchTokenMeta(provider, token0, metaCache);
  const meta1 = await fetchTokenMeta(provider, token1, metaCache);
  const price0 = await getTokenPriceUSD(provider, token0, priceCache);
  const price1 = await getTokenPriceUSD(provider, token1, priceCache);

  let tvlUsd = null;
  const val0 =
    price0 !== null
      ? Number(formatUnits(reserve0, meta0.decimals)) * price0
      : null;
  const val1 =
    price1 !== null
      ? Number(formatUnits(reserve1, meta1.decimals)) * price1
      : null;
  if (val0 !== null && val1 !== null) {
    tvlUsd = val0 + val1;
  } else if (val0 !== null) {
    tvlUsd = val0 * 2;
  } else if (val1 !== null) {
    tvlUsd = val1 * 2;
  }

  if (tvlUsd === null || Number.isNaN(tvlUsd)) {
    try {
      const sub = await fetchV2PairData(token0, token1);
      if (sub?.tvlUsd !== undefined) tvlUsd = Number(sub.tvlUsd);
    } catch {
      // ignore subgraph issues
    }
  }

  return {
    token0: meta0,
    token1: meta1,
    reserve0,
    reserve1,
    totalSupply,
    tvlUsd,
    lpDecimals,
  };
}

export async function fetchMasterChefFarms(provider) {
  const chefProvider = provider;
  const chef = new Contract(MASTER_CHEF_ADDRESS, MASTER_CHEF_ABI, chefProvider);
  const [poolLengthRaw, totalAllocPointRaw, perBlockRaw] = await Promise.all([
    chef.poolLength(),
    chef.totalAllocPoint(),
    chef.currentxPerBlock(),
  ]);
  const poolLength = Number(poolLengthRaw);
  const totalAllocPoint = BigInt(totalAllocPointRaw || 0n);
  const perBlock = BigInt(perBlockRaw || 0n);

  const priceCache = {};
  const metaCache = {};
  const crxPriceUsd = await getTokenPriceUSD(
    chefProvider,
    CRX_ADDRESS,
    priceCache
  );
  const pools = [];
  for (let pid = 0; pid < poolLength; pid++) {
    const info = await chef.poolInfo(pid);
    const allocPoint = BigInt(info.allocPoint || 0n);
    const lpToken = info.lpToken;
    const rewardPerBlock =
      totalAllocPoint > 0n ? (perBlock * allocPoint) / totalAllocPoint : 0n;

    let apr = null;
    let tvlUsd = null;
    let tokens = [];
    let pairLabel = "";
    let lpSummary = null;

    try {
      lpSummary = await getLpSummary(chefProvider, lpToken, priceCache, metaCache);
      tvlUsd = lpSummary.tvlUsd;
      tokens = [lpSummary.token0, lpSummary.token1];
      pairLabel = `${lpSummary.token0.symbol} / ${lpSummary.token1.symbol}`;
      if (crxPriceUsd !== null && tvlUsd && tvlUsd > 0) {
        const rewardsPerYear = Number(
          formatUnits(rewardPerBlock * BLOCKS_PER_YEAR, TOKENS.CRX.decimals)
        );
        const rewardUsd = rewardsPerYear * crxPriceUsd;
        apr = (rewardUsd / tvlUsd) * 100;
      }
    } catch {
      // ignore per-pool errors
    }

    if (!tokens.length) {
      try {
        const pair = new Contract(lpToken, UNIV2_PAIR_ABI, chefProvider);
        const [token0, token1] = await Promise.all([
          pair.token0(),
          pair.token1(),
        ]);
        const meta0 = await fetchTokenMeta(chefProvider, token0, metaCache);
        const meta1 = await fetchTokenMeta(chefProvider, token1, metaCache);
        tokens = [meta0, meta1];
        pairLabel = `${meta0.symbol} / ${meta1.symbol}`;
      } catch {
        // leave tokens empty if still failing
      }
    }

    pools.push({
      pid,
      lpToken,
      allocPoint: Number(allocPoint),
      rewardPerBlock: Number(formatUnits(rewardPerBlock, TOKENS.CRX.decimals)),
      rewardToken: TOKENS.CRX,
      apr,
      tvlUsd,
      tokens,
      pairLabel,
      lpDecimals: Number(lpSummary?.lpDecimals || 18),
    });
  }

  return {
    emissionPerBlock: Number(formatUnits(perBlock, TOKENS.CRX.decimals)),
    totalAllocPoint: Number(totalAllocPoint),
    pools,
  };
}

export async function fetchMasterChefUserData(address, pools, provider) {
  if (!address || !pools?.length) return {};
  const chef = new Contract(MASTER_CHEF_ADDRESS, MASTER_CHEF_ABI, provider);
  const out = {};
  for (const pool of pools) {
    try {
      const lpContract = new Contract(pool.lpToken, ERC20_ABI, provider);
      const [userInfo, pendingRaw, walletBalRaw] = await Promise.all([
        chef.userInfo(pool.pid, address),
        chef.pendingCurrentX(pool.pid, address),
        lpContract.balanceOf(address).catch(() => 0n),
      ]);
      const staked =
        pool.lpDecimals !== undefined
          ? Number(formatUnits(userInfo.amount || 0n, pool.lpDecimals))
          : Number(userInfo.amount || 0n);
      const lpBalance =
        pool.lpDecimals !== undefined
          ? Number(formatUnits(walletBalRaw || 0n, pool.lpDecimals))
          : Number(walletBalRaw || 0n);
      out[pool.pid] = {
        staked,
        lpBalance,
        pending: Number(formatUnits(pendingRaw || 0n, TOKENS.CRX.decimals)),
      };
    } catch {
      out[pool.pid] = { staked: 0, pending: 0, lpBalance: 0 };
    }
  }
  return out;
}
