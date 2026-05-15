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
- Show how a compliant tokenized asset contract can gate minting, burning, and clawback by KYC status
- Provide a demo-ready UI with wallet connect, approval state, mint/burn controls, and activity events

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
| `initialize(admin, asset_name)` | Write | Deploy-time setup — sets admin wallet, stores `AssetMetadata` on-chain, initialises circulating supply to 0, emits `init` event |
| `get_admin()` | Read | Returns the admin wallet address stored on-chain |
| `get_metadata()` | Read | Returns the full `AssetMetadata` struct stored on-chain |
| `approve_user(admin, user)` | Write | Admin whitelists an investor wallet on-chain |
| `is_approved(user)` | Read | Returns whether a wallet is KYC approved |
| `get_balance(user)` | Read | Returns the number of asset units held by a wallet |
| `get_circulating_supply()` | Read | Returns total units currently in circulation |
| `mint(admin, user, amount)` | Write | Admin issues units to a KYC-approved investor — rejected if user not approved or if mint would exceed `total_supply` cap |
| `burn(admin, user, amount)` | Write | Admin redeems/destroys units from an investor — rejected if amount exceeds investor balance |
| `clawback(admin, user, amount, reason, severity, case_reference)` | Write | Admin forcibly removes units for regulatory reasons — includes audit fields: reason string, severity level (i32), case reference number (i64) |

## Contract events and emitted data types

Each write function emits an on-chain event. The table below shows every field and its Soroban `ScVal` type — useful for Substreams decoders and indexers.

| Event | Topic | Value fields | ScVal types |
|---|---|---|---|
| `Init` | `Symbol("init")` | admin, asset_name, ledger, `AssetMetadata` struct | `Address`, `String`, `u32`, `struct`, `enum`, `Vec`, `Map`, `Bytes`, `u64`, `u128`, `Option` |
| `Approved` | `Symbol("approved")` | admin, user, approved flag, ledger, timestamp | `Address`, `bool`, `u32`, `u64` |
| `Minted` | `Symbol("minted")` | admin, user, amount, new_balance, circulating_supply, nav_price, timestamp | `Address`, `u32`, `i128`, `u64` |
| `Burned` | `Symbol("burned")` | admin, user, amount, new_balance, circulating_supply, nav_price, timestamp | `Address`, `u32`, `i128`, `u64` |
| `Clawback` | `Symbol("clawback")` | admin, user, amount, new_balance, circulating_supply, nav_price, reason, severity, case_reference, timestamp | `Address`, `u32`, `i128`, `String`, `i32`, `i64`, `u64` |

**Total type coverage (16):** `Symbol`, `Address`, `String`, `bool`, `u32`, `u64`, `i32`, `i64`, `i128`, `u128`, `Bytes`, `Vec`, `Map`, `Option`, `struct` (nested), `enum`

### Type-to-event mapping

| Type | Introduced in |
|---|---|
| `Symbol` | All events (topic) |
| `Address` | All events |
| `String` | `Init` (asset_name), `Clawback` (reason) |
| `bool` | `Approved` |
| `u32` | `Init` (ledger), `Minted`/`Burned`/`Clawback` (amount, balance, circulating) |
| `u64` | All events (timestamp), `Init` (issued_at) |
| `i32` | `Clawback` (severity) — regulatory severity level 1–10 |
| `i64` | `Clawback` (case_reference) — regulatory case/ticket number |
| `i128` | `Minted`/`Burned`/`Clawback` (nav_price in cents, 100000 = $1,000.00) |
| `u128` | `Init` metadata (total_supply, min_investment) |
| `Bytes` | `Init` metadata (document_hash) |
| `Vec` | `Init` metadata (tags) |
| `Map` | `Init` metadata (properties) |
| `Option` | `Init` metadata (optional_isin) |
| `struct` (nested) | `Init` metadata (`AssetMetadata` containing `GeoLocation`) |
| `enum` | `Init` metadata (`AssetStatus`: Active / Suspended / Redeemed) |

### AssetMetadata struct (stored on-chain + emitted in `init` event)

`AssetMetadata` is written to `persistent()` contract storage during `initialize` and is queryable at any time via `get_metadata()` — it does not expire with the event window.

| Field | Type | Example value |
|---|---|---|
| `asset_type` | `String` | `"real-estate"` |
| `total_supply` | `u128` | `1000000` |
| `min_investment` | `u128` | `1000` |
| `status` | `enum AssetStatus` | `Active` / `Suspended` / `Redeemed` |
| `tags` | `Vec<String>` | `["real-estate", "series-a", "kyc-gated", "testnet"]` |
| `properties` | `Map<String, String>` | `{"risk_level": "medium", "liquidity": "low", "fund_manager": "Jamshaid"}` |
| `document_hash` | `Bytes` | `deadbeefcafebabe...` (mock prospectus hash) |
| `geo` | `struct GeoLocation` | `{country: "TX", region: "Dallas"}` |
| `issued_at` | `u64` | Unix timestamp of deployment |
| `optional_isin` | `Option<String>` | `"US0231351067"` |

### Supply mechanics

| Value | Type | Behaviour |
|---|---|---|
| `total_supply` | `u128` in `AssetMetadata` | Fixed at deploy — hard cap, never changes |
| `circulating_supply` | `u32` in persistent storage | Starts at 0 — increases on `mint`, decreases on `burn` and `clawback` |

The NAV price is `i128` in cents (`100000` = $1,000.00). Unit balances and amounts are `u32`. Timestamps are Unix seconds as `u64`.

## Contract interface (ABI)

Use `contract-interface.json` at the project root as the ABI for this contract — equivalent to an EVM ABI JSON.

To regenerate it after any contract change:

```bash
stellar contract info interface --wasm target/wasm32v1-none/release/approval_control.wasm --output json-formatted > contract-interface.json
```

**Notes for integrators:**
- All on-chain values are XDR-encoded `ScVal`
- Use `scValToNative` (JS SDK) or the Soroban XDR decoder for your language to deserialise
- `u64`, `u128`, and `i128` deserialise as `BigInt` in JavaScript — handle accordingly
- `i32` and `i64` deserialise as regular JavaScript numbers
- Custom types (`AssetMetadata`, `GeoLocation`, `AssetStatus`) are defined in this file — use them to generate typed bindings
- All events use `data_format: map` — fields are named, not positional

## Notes

- This project uses **Testnet only**.
- Do not hardcode private keys in the frontend.
- The frontend reads all network values from environment variables.
- The final demo is designed to be publicly consumable by anyone with Freighter.
- Only the admin wallet can mint, burn, or clawback — investor wallets must be KYC-approved before receiving units.
