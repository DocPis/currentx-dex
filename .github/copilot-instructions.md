# CurrentX DEX - AI Coding Agent Instructions

## Project Overview
A decentralized exchange (DEX) frontend on **MegaETH L2** featuring swap, liquidity provision, farms, pools, and a points/rewards system. Built with React 19 + Vite, ethers.js/wagmi for Web3, deployed via Vercel.

## Architecture & Data Flow

### Frontend (React/Vite)
- **Entry**: `src/App.jsx` - Tab-based SPA with lazy-loaded feature modules
- **Tab System**: Routes map to feature components (swap, liquidity, farms, pools, launchpad, megavault, points, etc.)
- **State Management**: TanStack React Query for server state, React hooks for local UI state
- **Web3 Integration**: 
  - `useWallet()` hook - Wallet connection, address/chain tracking
  - `useBalances()` hook - Token balance fetching and caching
  - Wagmi/RainbowKit integration for wallet modal

### Backend API (Vercel Serverless)
Located at `api/`:
- **Points System** (`api/points/`): User points claims, leaderboard recalc, user data ingestion
- **Whitelist Rewards** (`api/whitelist-rewards/`): Whitelisted user rewards claims and summaries
- **IPFS** (`api/ipfs/upload.js`): Image uploads for launchpad via Pinata
- **Presale** (`api/presale.js`): Presale contract interaction
- **Subgraph** (`api/subgraph.js`): The Graph query wrapper

**Data Persistence**: Vercel KV (Redis) stores leaderboard state, claim records, user data

### Data Sources
1. **Smart Contracts** (ethers.js): Uniswap V2/V3, MasterChef, token balances, liquidity positions
2. **The Graph Subgraphs**: 
   - V2 subgraph for swap volumes, liquidity tracked from UniswapV2Factory
   - V3 subgraph for concentrated liquidity positions
3. **On-chain Realtime Service** (`src/shared/services/realtime.js`): WebSocket price feeds
4. **RPC Endpoints**: Fallback mechanism configured in `networks.js` with failover to multiple providers

## Configuration & Environment

**Network Preset**: Mainnet (MegaETH, chain ID `0x10e6` = 4326) only - no multi-chain support.

**Key Config Files**:
- `src/shared/config/networks.js` - Network metadata, RPC URLs, subgraph URLs
- `src/shared/config/addresses.js` - Contract addresses (WETH, CRX, MasterChef, etc.)
- `src/shared/config/tokens.js` - Supported token metadata
- `src/shared/config/web3.js` - Provider setup, RPC pool with failover logic

**Environment Variables**:
- `VITE_RPC_URL` / `VITE_MEGAETH_RPC` - RPC endpoints (fallback chain)
- `VITE_UNIV2_SUBGRAPH` / `VITE_UNIV3_SUBGRAPH` - The Graph URLs
- `VITE_IPFS_UPLOAD_ENDPOINT` - IPFS upload endpoint (default: `/api/ipfs/upload`)
- `VITE_IPFS_GATEWAY` - IPFS read gateway (default: Pinata)
- Server env (Vercel): `PINATA_JWT` - Pinata API key for IPFS uploads

## Core Patterns & Conventions

### Points & Incentives System
**Key Files**: `src/shared/lib/points.js`, `src/server/pointsLib.js`, `api/points/`

**Boost Pairs**: Specific pairs (CRX/ETH, CRX/USDM) earn 2-3x point multiplier. Defined in `isBoostPair()`, `getBoostPairMultiplier()`.

**Point Computation**: Based on trading volume + liquidity provision. Formula:
```javascript
computePoints({ volumeUsd, lpUsdCrxEth, lpUsdCrxUsdm, boostEnabled })
// Applies multipliers to boost pairs, applies diminishing factor (0.25x default)
```

**Leaderboard Claims**: Server-side signature verification (`verifyMessage()`) prevents unauthorized claims. Uses Vercel KV to track issued claims.

### Feature Module Pattern
Each feature (swap, liquidity, farms) has:
- Entry component at `src/features/{feature}/{FeatureName}.jsx`
- Lazy-loaded in `App.jsx` via `React.lazy()` for code splitting
- Custom hooks for data fetching (e.g., `usePoints()`, `useBalances()`, `usePoolsData()`)
- Utility functions for contract interactions in subfolder (e.g., `src/features/swap/utils/`)

### Multicall Optimization
`src/shared/services/multicall.js` - Batch contract reads to reduce RPC calls. Used extensively for fetching balances, reserves, pool data in single transaction.

### Web3 Provider Hierarchy
1. **Browser Wallet** (injected provider) - Preferred for transaction signing, avoids CORS
2. **RPC Fallback** - Multiple RPC URLs with automatic failover if one is unavailable
3. **Read-only Provider** - `getReadOnlyProvider()` for contract reads when no signer needed

## Developer Workflows

### Local Development
```bash
npm install
npm run dev  # HTTPS on https://localhost:4173 (uses @vitejs/plugin-basic-ssl)
# Dev server proxies /api/* to http://127.0.0.1:3000
npm run lint  # ESLint check
npm run build  # Production build
npm run preview  # Preview production build
```

**Custom Certificates**: Place `dev.key` and `dev.crt` in `certs/` directory for custom HTTPS (otherwise uses auto-generated via basicSsl plugin).

**Vite Config Notes**:
- React Fast Refresh disabled (`fastRefresh: false`) to avoid CSP issues in dev nonces
- Nonce injection for `<script>` tags (CSP-compliant development)
- Rollup warning filter for harmless `@pure` annotation warnings from node_modules

### Testing Wallet Integration
Points claims and leaderboard updates require:
1. Valid EIP-191 message signature from claimed address
2. User in Vercel KV whitelist/computed leaderboard
3. No prior claim for that epoch/season

### Building for Production
- Output: `dist/` directory
- Deployment: Vercel (config in `vercel.json`, landing page in `vercel.landing.json`)
- Static hosting for main app, serverless functions for `/api/*`

## Critical Developer Patterns

### Address Normalization
Always lowercase and validate addresses. Use `ethers.getAddress()` for EIP-55 checksumming:
```javascript
const normalizeAddress = (addr) => {
  if (!addr) return null;
  try {
    return getAddress(String(addr));  // Returns checksummed
  } catch {
    return String(addr);  // Fallback if invalid
  }
};
```

### RPC URL Handling
Log fallback events when primary RPC fails. The pool rotates or retries. Check `web3.js` for current RPC selection logic.

### Subgraph Query Error Handling
The Graph may return incomplete/stale results. Always:
1. Validate response structure before accessing nested properties
2. Use fallback subgraph URLs if primary is unavailable
3. Implement client-side filtering/deduplication for multi-page results

### Signature Verification (Server-side)
```javascript
import { verifyMessage } from "ethers";
const recoveredAddress = verifyMessage(message, signature);
// Verify recoveredAddress matches claimed address before processing
```

## Common Tasks & File Locations

| Task | Primary File(s) |
|------|-----------------|
| Add new token | `src/shared/config/tokens.js` + `src/shared/config/abis.js` if new ABI |
| Modify incentive boost pairs | `src/shared/lib/points.js`, `src/server/pointsLib.js` |
| Update contract address | `src/shared/config/addresses.js` + update `.env.local` |
| Add new feature/tab | Create `src/features/{name}/{Name}.jsx`, add to `App.jsx` SECTION_LOADERS and TAB_ROUTES |
| Create API endpoint | Create file in `api/{feature}/` as Vercel handler: `export default function handler(req, res) { ... }` |
| Update subgraph queries | `src/shared/config/subgraph.js` |
| Add hook for data fetching | `src/shared/hooks/`, use React Query pattern with `useQuery()` |
| Adjust RPC failover | `src/shared/config/web3.js`, update RPC_POOL construction |

## No-Go Areas (By Design)

1. **Multi-chain support** - Network preset is mainnet-only; no testnet logic
2. **Legacy Web3 patterns** - Use ethers v6+, wagmi v2+, not web3.js v1 or wagmi v1
3. **Direct state management** - Use React Query (TanStack) or local hooks, not Redux/Zustand
4. **Hardcoded addresses/ABIs** - Always reference `src/shared/config/`
5. **Client-side claim validation** - Claims **must** be server-verified via signature

## Debugging Tips

- **RPC issues**: Check `src/shared/config/networks.js` RPC URLs, verify endpoints are responsive
- **Subgraph stale**: Try forcing fresh query via React Query invalidation: `queryClient.invalidateQueries()`
- **Wallet connection**: Check `useWallet()` state, session storage key `cx_session_connected`
- **CSP errors**: Vite dev server applies nonce to all `<script>` tags; check CSP policy in headers
- **Points not updating**: Check Vercel KV connectivity, epoch/season timestamp in `pointsLib.js`
