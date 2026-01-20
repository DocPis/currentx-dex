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

## Network presets (Mainnet/Testnet)
- Mainnet is default. To enable the MegaETH testnet toggle, copy `env.testnet.example` into your env (e.g. merge into `.env.local`) and fill real testnet RPC/explorer/contract addresses.
- Required: `VITE_TESTNET_RPC_URL`, `VITE_TESTNET_WETH_ADDRESS`, `VITE_TESTNET_FACTORY_ADDRESS`, `VITE_TESTNET_ROUTER_ADDRESS`.
- Recommended: token/protocol addresses (`VITE_TESTNET_USDC_ADDRESS`, `VITE_TESTNET_CUSD_ADDRESS`, `VITE_TESTNET_CRX_ADDRESS`, `VITE_TESTNET_MEGA_TOKEN_ADDRESS`, `VITE_TESTNET_MASTER_CHEF_ADDRESS`, `VITE_TESTNET_CRX_WETH_LP_ADDRESS`, `VITE_TESTNET_EXPLORER`, `VITE_TESTNET_CHAIN_ID_HEX`).
- To load testnet by default, set `VITE_DEFAULT_NETWORK_PRESET=testnet`.
