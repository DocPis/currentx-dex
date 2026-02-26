const STRATEGY_TUPLE_COMPONENTS = [
  { name: "poolClass", type: "uint8" },
  { name: "widthBps", type: "uint16" },
  { name: "recenterBps", type: "uint16" },
  { name: "minRebalanceInterval", type: "uint16" },
  { name: "maxSwapSlippageBps", type: "uint16" },
  { name: "mintSlippageBps", type: "uint16" },
  { name: "allowSwap", type: "bool" },
  { name: "route", type: "uint8" },
  { name: "minCardinality", type: "uint16" },
  { name: "_pad", type: "uint32" },
  { name: "allowedFeeBitmap", type: "uint256" },
  { name: "oracleParams", type: "bytes" },
  { name: "wethHopFee", type: "uint24" },
  { name: "targetRatioBps0", type: "uint16" },
  { name: "minCompoundValueToken1", type: "uint256" },
  { name: "ratioDeadbandBps", type: "uint16" },
  { name: "minSwapValueToken1", type: "uint256" },
] as const;

export const ALM_ABI = [
  {
    type: "function",
    name: "keeper",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "registry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "emergency",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "EMERGENCY_DELAY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextPositionId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "performanceFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "emergencySetAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "strategyId", type: "uint256" },
    ],
    outputs: [{ name: "positionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "compoundWeighted",
    stateMutability: "nonpayable",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "userPositions",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "positionsById",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "strategyId", type: "uint256" },
      { name: "pool", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "currentTokenId", type: "uint256" },
      { name: "lastRebalanceAt", type: "uint40" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "dust0",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "dust1",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Deposited",
    anonymous: false,
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "strategyId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DustRefunded",
    anonymous: false,
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Rotated",
    anonymous: false,
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "oldTokenId", type: "uint256", indexed: false },
      { name: "newTokenId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    anonymous: false,
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RebalanceSkipped",
    anonymous: false,
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "reason", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SwapToTarget",
    anonymous: false,
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "zeroForOne", type: "bool", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DustUpdated",
    anonymous: false,
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "dust0Amt", type: "uint256", indexed: false },
      { name: "dust1Amt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EmergencySet",
    anonymous: false,
    inputs: [
      { name: "enabled", type: "bool", indexed: false },
      { name: "when", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EmergencyRescued",
    anonymous: false,
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PerformanceFeeTaken",
    anonymous: false,
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "fee0", type: "uint256", indexed: false },
      { name: "fee1", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RecoveredERC20",
    anonymous: false,
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const STRATEGY_REGISTRY_ABI = [
  {
    type: "function",
    name: "strategiesCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getStrategy",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [...STRATEGY_TUPLE_COMPONENTS] }],
  },
  {
    type: "function",
    name: "setStrategy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "s", type: "tuple", components: [...STRATEGY_TUPLE_COMPONENTS] },
    ],
    outputs: [{ name: "newId", type: "uint256" }],
  },
  {
    type: "function",
    name: "isFeeAllowed",
    stateMutability: "view",
    inputs: [
      { name: "strategyId", type: "uint256" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isStablePair",
    stateMutability: "view",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isStableToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "classify",
    stateMutability: "view",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const NFPM_ABI = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getApproved",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const;

export const POOL_SLOT0_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

export const V3_FACTORY_MIN_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

export const ERC20_METADATA_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
