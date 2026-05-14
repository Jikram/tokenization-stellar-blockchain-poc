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
| `initialize(admin, asset_name)` | Write | Deploy-time setup — sets admin wallet, stores `AssetMetadata` on-chain, emits `init` event |
| `get_admin()` | Read | Returns the admin wallet address stored on-chain — always available, no event window dependency |
| `get_metadata()` | Read | Returns the full `AssetMetadata` struct stored on-chain — always available, no event window dependency |
| `approve_user(admin, user)` | Write | Admin whitelists an investor wallet on-chain |
| `is_approved(user)` | Read | Returns whether a wallet is KYC approved |
| `get_balance(user)` | Read | Returns the number of asset units held by a wallet |
| `execute_action(user)` | Execute | Enforces KYC gate — increments and returns the caller's unit balance, reverts if not approved |

## Contract events and emitted data types

Each function emits an on-chain event. The table below shows every field and its Soroban `ScVal` type — useful for Substreams decoders and indexers.

| Event | Topic | Value fields | ScVal types |
|---|---|---|---|
| `init` | `Symbol("init")` | admin address, asset name, deploy ledger, `AssetMetadata` struct | `Address`, `String`, `u32`, `struct`, `enum`, `Vec`, `Map`, `Bytes`, `u64`, `u128`, `Option` |
| `apprv` | `Symbol("apprv")` | admin address, user address, approved flag, ledger, timestamp | `Address`, `bool`, `u32`, `u64` |
| `prot_exec` | `Symbol("prot_exec")` | user address, new unit balance, NAV price (cents), timestamp | `Address`, `u32`, `i128`, `u64` |

**Total type coverage (14):** `Symbol`, `Address`, `String`, `bool`, `u32`, `u64`, `i128`, `u128`, `Bytes`, `Vec`, `Map`, `Option`, `struct` (nested), `enum`

### AssetMetadata struct (stored on-chain + emitted in `init` event)

`AssetMetadata` is written to `persistent()` contract storage during `initialize` and is queryable at any time via `get_metadata()` — it does not expire with the event window. The same struct is also emitted in the `init` event for indexers.

| Field | Type | Example value |
|---|---|---|
| `asset_type` | `String` | `"real-estate"` |
| `total_supply` | `u128` | `1000000` |
| `min_investment` | `u128` | `1000` |
| `status` | `enum AssetStatus` | `Active` / `Suspended` / `Redeemed` |
| `tags` | `Vec<String>` | `["real-estate", "series-a", "kyc-gated", "testnet"]` |
| `properties` | `Map<String, String>` | `{"risk_level": "medium", "liquidity": "low", ...}` |
| `document_hash` | `Bytes` | `deadbeefcafebabe...` (mock prospectus hash) |
| `geo` | `struct GeoLocation` | `{country: "TX", region: "Dallas"}` |
| `issued_at` | `u64` | Unix timestamp of deployment |
| `optional_isin` | `Option<String>` | `"US0231351067"` |

The NAV price is `i128` in cents (`100000` = $1,000.00). The unit balance is `u32` — multiply by 1000 for dollar value. Timestamps are Unix seconds as `u64`.

## Contract interface (ABI)

The file `contract-interface.json` at the project root contains the full contract ABI generated from the WASM:

```bash
stellar contract info interface --wasm target/wasm32v1-none/release/approval_control.wasm --output json-formatted
```

This file describes all functions, parameter types, return types, and custom type definitions (`AssetMetadata`, `GeoLocation`, `AssetStatus`). Share it with Substreams or indexer teams to generate decoder bindings — equivalent to an EVM ABI JSON.

> For Substreams teams: all values are XDR-encoded `ScVal`. Use `scValToNative` (JS SDK) or the Soroban XDR decoder for your language to deserialise. `u64`, `u128`, and `i128` deserialise as `BigInt` in JavaScript — handle accordingly.

## Notes

- This project uses **Testnet only**.
- Do not hardcode private keys in the frontend.
- The frontend reads all network values from environment variables.
- The final demo is designed to be publicly consumable by anyone with Freighter.
