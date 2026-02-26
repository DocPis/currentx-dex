# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Setup

1) Install deps
```bash
npm install
```

2) Dev server (HTTPS enabled via plugin-basic-ssl/mkcert)
```bash
npm run dev -- --host --port 4173
```

## Network preset
- Mainnet (MegaETH) only. Configure via `.env.local` as needed.

## Launchpad PNG -> IPFS upload
- Frontend uploads PNG to `/api/ipfs/upload` and stores `ipfs://...` in Launchpad image field.
- PNG max size: `1 MB` (frontend + backend aligned).
- Upload auth is challenge-based (wallet signature), with distributed KV quotas per IP and per wallet.
- Required server env (Vercel / API runtime):
  - `PINATA_JWT` (required)
  - API key scope: `Files -> Write` (`org:files:write`)
- Optional server env:
  - `IPFS_UPLOAD_ALLOWED_ORIGINS` (comma-separated origins; default `*`)
- Optional frontend env:
  - `VITE_IPFS_UPLOAD_ENDPOINT` (default: `/api/ipfs/upload`)
  - `VITE_IPFS_GATEWAY` (default: `https://gateway.pinata.cloud/ipfs/`)

## Protected job endpoints
- Mutative jobs are `POST` only and accept auth only via `Authorization: Bearer <secret>`.
- Query-string token auth is disabled.
- Affected endpoints:
  - `/api/points/ingest`
  - `/api/points/recalc`
  - `/api/points/reset`
  - `/api/whitelist-rewards/recalc`
- GitHub Actions workflow ready: `.github/workflows/points-jobs-cron.yml`
- Required repository secrets for the workflow:
  - `POINTS_API_BASE` (or `API_BASE_URL`)
  - `POINTS_INGEST_TOKEN` (or `CRON_SECRET`)
- Optional repository variable:
  - `POINTS_SEASON_ID`

## Claim signature clock skew (optional)
- By default, claim signatures allow up to `60s` future clock skew (to tolerate minor client/server drift).
- Optional env overrides:
  - `POINTS_REWARD_CLAIM_MAX_FUTURE_SKEW_MS` (points claim endpoint)
  - `WHITELIST_CLAIM_MAX_FUTURE_SKEW_MS` (whitelist claim endpoint)
  - `CLAIM_SIGNATURE_MAX_FUTURE_SKEW_MS` (shared fallback for both)
- Values are clamped to `0..600000` ms and never exceed the signature TTL.
\nDeploy trigger: 2026-02-10 22:32:54
\nDeploy trigger: 2026-02-10 22:38:44
