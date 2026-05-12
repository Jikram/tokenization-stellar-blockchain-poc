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
   - Stellar CLI: `cargo install --locked stellar-cli --features opt`
   - Node.js 20+ and npm

   The contract compiles to `wasm32v1-none` (bare-metal WebAssembly for Soroban). `stellar contract build` handles this automatically — no need to install the target manually.

2. Deploy everything (contract + frontend) in one command:
   ```bash
   bash scripts/deploy-full.sh
   ```
   To skip checks for a faster deploy:
   ```bash
   bash scripts/deploy-full.sh --skip-checks
   ```

3. Run the frontend locally:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

4. Open the app and connect with Freighter on Stellar Testnet.

## Code quality tools

All checks run automatically as part of `deploy-full.sh`. To run them individually:

```bash
# Format check
cargo fmt --check

# Linter
cargo clippy -- -D warnings -A deprecated

# Unit + fuzz + invariant tests
cargo test

# Security audit
cargo audit

# Code coverage (summary)
cargo llvm-cov --summary-only

# Run all checks at once
bash scripts/check-contract.sh
```

## Contract functions

| Function | Type | Description |
|---|---|---|
| `initialize(admin, asset_name)` | Write | Deploy-time setup — sets admin wallet and asset name |
| `approve_user(admin, user)` | Write | Admin whitelists an investor wallet on-chain |
| `is_approved(user)` | Read | Returns whether a wallet is KYC approved |
| `get_balance(user)` | Read | Returns the number of asset units held by a wallet |
| `execute_action(user)` | Execute | Enforces KYC gate — increments and returns the caller's unit balance, reverts if not approved |

## Contract events and emitted data types

Each function emits an on-chain event. The table below shows every field and its Soroban `ScVal` type — useful for Substreams decoders and indexers.

| Event | Topic | Value fields | ScVal types |
|---|---|---|---|
| `init` | `Symbol("init")` | admin address, asset name, deploy ledger | `Address`, `String`, `u32` |
| `apprv` | `Symbol("apprv")` | admin address, user address, approved flag, ledger, timestamp | `Address`, `Address`, `bool`, `u32`, `u64` |
| `prot_exec` | `Symbol("prot_exec")` | user address, new unit balance, NAV price (cents), timestamp | `Address`, `u32`, `i128`, `u64` |

**Type coverage:** `Symbol`, `Address`, `String`, `bool`, `u32`, `u64`, `i128`

The NAV price is represented as `i128` in cents (`10000` = $100.00). Timestamps are Unix seconds as `u64`. The ledger sequence is `u32`. The unit balance is a `u32` counter incremented on each `execute_action` call — multiply by 100 to get the dollar value of the wallet's holdings.

> For Substreams teams: all values are XDR-encoded `ScVal`. Use `scValToNative` (JS SDK) or the Soroban XDR decoder for your language to deserialise. `u64` and `i128` deserialise as `BigInt` in JavaScript — handle accordingly.

## Notes

- This project uses **Testnet only**.
- Do not hardcode private keys in the frontend.
- The frontend reads all network values from environment variables.
- The final demo is designed to be publicly consumable by anyone with Freighter.
