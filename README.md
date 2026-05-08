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

4. Initialize the contract (once after deploy):
   ```bash
   stellar contract invoke \
     --id YOUR_CONTRACT_ID \
     --source YOUR_ACCOUNT \
     --network testnet \
     -- initialize \
     --admin YOUR_ADMIN_ADDRESS \
     --asset_name "Tokenized Real Estate Fund Series A"
   ```

5. Copy the deployed contract ID into `frontend/.env.local`:
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

## Contract functions

| Function | Type | Description |
|---|---|---|
| `initialize(admin, asset_name)` | Write | Deploy-time setup — sets admin wallet and asset name |
| `approve_user(admin, user)` | Write | Admin whitelists an investor wallet on-chain |
| `is_approved(user)` | Read | Returns whether a wallet is KYC approved |
| `execute_action(user)` | Execute | Enforces KYC gate — reverts if wallet not approved |

## Contract events and emitted data types

Each function emits an on-chain event. The table below shows every field and its Soroban `ScVal` type — useful for Substreams decoders and indexers.

| Event | Topic | Value fields | ScVal types |
|---|---|---|---|
| `init` | `Symbol("init")` | admin address, asset name, deploy ledger | `Address`, `String`, `u32` |
| `apprv` | `Symbol("apprv")` | admin address, user address, approved flag, ledger, timestamp | `Address`, `Address`, `bool`, `u32`, `u64` |
| `prot_exec` | `Symbol("prot_exec")` | user address, NAV price (cents), timestamp | `Address`, `i128`, `u64` |

**Type coverage:** `Symbol`, `Address`, `String`, `bool`, `u32`, `u64`, `i128`

The NAV price is represented as `i128` in cents (`10000` = $100.00). Timestamps are Unix seconds as `u64`. The ledger sequence is `u32`.

> For Substreams teams: all values are XDR-encoded `ScVal`. Use `scValToNative` (JS SDK) or the Soroban XDR decoder for your language to deserialise. `u64` and `i128` deserialise as `BigInt` in JavaScript — handle accordingly.

## Notes

- This project uses **Testnet only**.
- Do not hardcode private keys in the frontend.
- The frontend reads all network values from environment variables.
- The final demo is designed to be publicly consumable by anyone with Freighter.
