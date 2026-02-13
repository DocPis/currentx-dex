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
- Required server env (Vercel / API runtime):
  - `PINATA_JWT` (recommended), or
  - `PINATA_API_KEY` + `PINATA_SECRET_API_KEY`
- Optional frontend env:
  - `VITE_IPFS_UPLOAD_ENDPOINT` (default: `/api/ipfs/upload`)
  - `VITE_IPFS_GATEWAY` (default: `https://gateway.pinata.cloud/ipfs/`)
\nDeploy trigger: 2026-02-10 22:32:54
\nDeploy trigger: 2026-02-10 22:38:44
