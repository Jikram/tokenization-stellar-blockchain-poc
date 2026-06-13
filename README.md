# stellar-tokenization-control-poc

Public Stellar Soroban demo proof-of-concept showing tokenization-style approval controls with a Rust smart contract and a Next.js frontend. Test1

## Project structure

- `contracts/approval-control/` — token contract: KYC gating, mint, burn, clawback
- `contracts/nav-oracle/` — NAV oracle contract: on-chain price feed called cross-contract during every token operation
- `frontend/` — Next.js + TypeScript demo app with Freighter wallet integration
- `scripts/` — helper scripts for building, deploying, and invoking contract actions
- `docs/` — architectural and ecosystem mapping documentation

## Goals

- Deploy two Soroban smart contracts to Stellar Testnet and wire them together via cross-contract call
- Use Freighter wallet for user authentication and transaction signing
- Keep all secret data out of the frontend
- Show how a compliant tokenized asset contract can gate minting, burning, and clawback by KYC status
- Demonstrate cross-contract atomicity: if the NAV oracle has no price set, mint/burn/clawback revert entirely
- Provide a demo-ready UI with wallet connect, approval state, mint/burn controls, live oracle price, and activity events

## Live demo

- Public URL: https://stellar-tokenization-ji.vercel.app

## Getting started

1. Install tooling:
   - Rust + `cargo`
   - Stellar CLI: `cargo install --locked stellar-cli --features opt`
   - Node.js 20+ and npm

   Both contracts compile to `wasm32v1-none` (bare-metal WebAssembly for Soroban). `stellar contract build` handles this automatically.

2. Deploy everything (both contracts + frontend) in one command:
   ```bash
   SOURCE_ACCOUNT=alice ADMIN_ADDRESS=GXXX... bash scripts/deploy-full.sh
   ```
   To skip checks for a faster deploy:
   ```bash
   bash scripts/deploy-full.sh --skip-checks
   ```
   The script deploys the NAV oracle first, sets the initial price, then deploys the token contract pointing at the oracle, and updates Vercel with both contract IDs.

3. Run the frontend locally:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

4. Open the app and connect with Freighter on Stellar Testnet.

## Code quality tools

All checks run automatically as part of `deploy-full.sh`. To run them individually from the workspace root:

```bash
# Format check (per package)
cargo fmt --check -p nav-oracle
cargo fmt --check -p approval-control

# Linter (per package)
cargo clippy -p nav-oracle -- -D warnings -A deprecated
cargo clippy -p approval-control -- -D warnings -A deprecated

# Unit + fuzz + invariant tests (per package)
cargo test -p nav-oracle
cargo test -p approval-control

# Security audit (workspace — reads root Cargo.lock)
cargo audit

# Code coverage (workspace)
cargo llvm-cov --summary-only

# Run all checks at once
bash scripts/check-contract.sh
```

## Contracts

This project contains two Soroban contracts that work together. The token contract makes a cross-contract call to the NAV oracle on every mint, burn, and clawback. If the oracle has no price set, the entire transaction reverts atomically.

---

### approval-control (token contract)

| Function | Type | Description |
|---|---|---|
| `initialize(admin, asset_name, nav_oracle_id)` | Write | Deploy-time setup — sets admin wallet, stores oracle contract ID, stores `AssetMetadata` on-chain, initialises circulating supply to 0, emits `init` event |
| `get_admin()` | Read | Returns the admin wallet address stored on-chain |
| `get_metadata()` | Read | Returns the full `AssetMetadata` struct stored on-chain |
| `get_oracle_id()` | Read | Returns the NAV oracle contract address stored on-chain |
| `approve_user(admin, user)` | Write | Admin whitelists an investor wallet on-chain |
| `is_approved(user)` | Read | Returns whether a wallet is KYC approved |
| `get_balance(user)` | Read | Returns the number of asset units held by a wallet |
| `get_circulating_supply()` | Read | Returns total units currently in circulation |
| `mint(admin, user, amount)` | Write | Admin issues units to a KYC-approved investor — calls oracle cross-contract to get live NAV price, rejected if user not approved, if mint would exceed `total_supply` cap, or if oracle has no price |
| `burn(admin, user, amount)` | Write | Admin redeems/destroys units from an investor — calls oracle cross-contract, rejected if amount exceeds investor balance or oracle has no price |
| `clawback(admin, user, amount, reason, severity, case_reference)` | Write | Admin forcibly removes units for regulatory reasons — calls oracle cross-contract, includes audit fields: reason string, severity level (i32), case reference number (i64) |

---

### nav-oracle (NAV price oracle contract)

| Function | Type | Description |
|---|---|---|
| `initialize(admin)` | Write | Deploy-time setup — sets the oracle admin wallet |
| `get_admin()` | Read | Returns the oracle admin wallet address |
| `update_price(admin, price)` | Write | Admin sets the NAV price in cents (`100000` = $1,000.00). Must be positive. Emits `price_updated` event |
| `get_price()` | Read | Returns the current NAV price in cents. Panics (reverts the calling transaction) if no price has been set |
| `has_price()` | Read | Returns `true` if a price is currently set — use this before attempting a mint to check oracle state |
| `clear_price(admin)` | Write | Admin removes the price. Subsequent mint/burn/clawback on the token contract will revert atomically until a new price is set. Emits `price_cleared` event |

## Contract events and emitted data types

### approval-control events

| Event | Topic | Value fields | ScVal types |
|---|---|---|---|
| `Init` | `Symbol("init")` | admin, asset_name, ledger, `AssetMetadata` struct | `Address`, `String`, `u32`, `struct`, `enum`, `Vec`, `Map`, `Bytes`, `u64`, `u128`, `Option` |
| `Approved` | `Symbol("approved")` | admin, user, approved flag, ledger, timestamp | `Address`, `bool`, `u32`, `u64` |
| `Minted` | `Symbol("minted")` | admin, user, amount, new_balance, circulating_supply, nav_price, timestamp | `Address`, `u32`, `i128`, `u64` |
| `Burned` | `Symbol("burned")` | admin, user, amount, new_balance, circulating_supply, nav_price, timestamp | `Address`, `u32`, `i128`, `u64` |
| `Clawback` | `Symbol("clawback")` | admin, user, amount, new_balance, circulating_supply, nav_price, reason, severity, case_reference, timestamp | `Address`, `u32`, `i128`, `String`, `i32`, `i64`, `u64` |

### nav-oracle events

| Event | Topic | Value fields | ScVal types |
|---|---|---|---|
| `PriceUpdated` | `Symbol("price_updated")` | admin, price, ledger, timestamp | `Address`, `i128`, `u32`, `u64` |
| `PriceCleared` | `Symbol("price_cleared")` | admin, ledger, timestamp | `Address`, `u32`, `u64` |

**Total type coverage (16):** `Symbol`, `Address`, `String`, `bool`, `u32`, `u64`, `i32`, `i64`, `i128`, `u128`, `Bytes`, `Vec`, `Map`, `Option`, `struct` (nested), `enum`

### Type-to-event mapping

| Type | Introduced in |
|---|---|
| `Symbol` | All events (topic) |
| `Address` | All events |
| `String` | `Init` (asset_name), `Clawback` (reason) |
| `bool` | `Approved` |
| `u32` | `Init` (ledger), `Minted`/`Burned`/`Clawback` (amount, balance, circulating), oracle events (ledger) |
| `u64` | All events (timestamp), `Init` (issued_at) |
| `i32` | `Clawback` (severity) — regulatory severity level 1–10 |
| `i64` | `Clawback` (case_reference) — regulatory case/ticket number |
| `i128` | `Minted`/`Burned`/`Clawback` (nav_price fetched live from oracle), `PriceUpdated` (price) |
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

The NAV price is fetched live from the oracle contract during every mint, burn, and clawback — it is `i128` in cents (`100000` = $1,000.00) and recorded in the emitted event. Unit balances and amounts are `u32`. Timestamps are Unix seconds as `u64`.

### Cross-contract atomicity

When `mint`, `burn`, or `clawback` is called on the token contract, it calls `get_price()` on the NAV oracle contract within the same transaction. If the oracle panics (no price set), the entire transaction reverts — balances and circulating supply remain unchanged. This can be demonstrated live using the **Clear Price** button in the oracle admin panel.

## Contract interfaces (ABI)

Two interface files live at the project root — one per contract:

| File | Contract |
|---|---|
| `approval-control-interface.json` | Token contract (KYC gating, mint, burn, clawback) |
| `nav-oracle-interface.json` | NAV oracle contract (price feed) |

To regenerate after a contract change:

```bash
stellar contract info interface \
  --wasm target/wasm32v1-none/release/approval_control.wasm \
  --output json-formatted > approval-control-interface.json

stellar contract info interface \
  --wasm target/wasm32v1-none/release/nav_oracle.wasm \
  --output json-formatted > nav-oracle-interface.json
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
- The frontend reads all network values from environment variables (`NEXT_PUBLIC_CONTRACT_ID`, `NEXT_PUBLIC_ORACLE_CONTRACT_ID`, `NEXT_PUBLIC_STELLAR_NETWORK`).
- The final demo is designed to be publicly consumable by anyone with Freighter.
- Only the admin wallet can mint, burn, or clawback — investor wallets must be KYC-approved before receiving units.
- The NAV oracle admin and token contract admin are the same wallet in this POC. In production, the oracle would typically be controlled by a multi-sig or a licensed third-party valuation agent.
