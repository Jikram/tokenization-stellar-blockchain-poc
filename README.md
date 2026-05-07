# stellar-tokenization-control-poc

Public Stellar Soroban demo proof-of-concept showing tokenization-style approval controls with a Rust smart contract and a Next.js frontend.

## Project structure

- `contracts/approval-control/` — Soroban smart contract source and unit tests
- `frontend/` — Next.js + TypeScript demo app with Freighter wallet integration
- `scripts/` — helper scripts for building, deploying, and invoking contract actions
- `docs/` — architectural and ecosystem mapping documentation

## Goals

- Deploy a Soroban smart contract to Stellar Testnet
- Use Freighter wallet for user authentication and transaction signing
- Keep all secret data out of the frontend
- Show how an approval control contract can guard a protected action
- Provide a demo-ready UI with wallet connect, approval state, and activity events

## Live demo

- Public URL: https://stellar-tokenization-ji.vercel.app


## Getting started

1. Install tooling:
   - Rust + `cargo`
   - `wasm32-unknown-unknown` target
   - Stellar CLI (or Soroban CLI if you prefer)
   - Node.js 20+ and npm/yarn/pnpm

2. Build the contract:
   ```bash
   ./scripts/build-contract.sh
   ```

3. Deploy to testnet:
   ```bash
   SOURCE_ACCOUNT=YOUR_DEPLOYER_ACCOUNT ./scripts/deploy-testnet.sh
   ```

   If you already have `STELLAR_ACCOUNT` configured in your environment, you can use:
   ```bash
   ./scripts/deploy-testnet.sh
   ```

4. Copy the deployed contract ID into `frontend/.env.local`:
   ```text
   NEXT_PUBLIC_CONTRACT_ID=YOUR_CONTRACT_ID_HERE
   ```

5. Run the frontend locally:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

6. Open the app and connect with Freighter on Stellar Testnet.

## Notes

- This project uses **Testnet only**.
- Do not hardcode private keys in the frontend.
- The frontend reads all network values from environment variables.
- The final demo is designed to be publicly consumable by anyone with Freighter.
