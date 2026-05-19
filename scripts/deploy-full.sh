#!/usr/bin/env bash
set -euo pipefail

# Full deployment pipeline: check → build → deploy oracle → deploy token → initialize → vercel
#
# Usage:
#   bash scripts/deploy-full.sh                          # full pipeline with all checks
#   bash scripts/deploy-full.sh --skip-checks            # skip format/lint/tests (fast deploy)
#   bash scripts/deploy-full.sh --skip-tests             # skip tests only, keep format/lint
#
# Required env vars:
#   SOURCE_ACCOUNT  — Stellar CLI identity (e.g. alice)
#   ADMIN_ADDRESS   — Freighter wallet to set as admin for both contracts
#
# Optional env vars:
#   ASSET_NAME      — defaults to "Tokenized Real Estate Fund Series A"
#   NAV_PRICE       — initial NAV price in cents, defaults to 100000 ($1,000.00)
#   STELLAR_NETWORK — defaults to testnet

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ORACLE_DIR="$ROOT/contracts/nav-oracle"
TOKEN_DIR="$ROOT/contracts/approval-control"

SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-alice}"
ADMIN_ADDRESS="${ADMIN_ADDRESS:-GDGQDFBRJ4V2Q7L7DZBM62P7IDDTBVF7KE6B5BMDVTG2JHJGT4OH6IBQ}"
ASSET_NAME="${ASSET_NAME:-Tokenized Real Estate Fund Series A}"
NAV_PRICE="${NAV_PRICE:-100000}"
NETWORK="${STELLAR_NETWORK:-testnet}"
WALLETCONNECT_PROJECT_ID="${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}"
SKIP_CHECKS=false
SKIP_TESTS=false

for arg in "$@"; do
  case $arg in
    --skip-checks) SKIP_CHECKS=true ;;
    --skip-tests)  SKIP_TESTS=true ;;
  esac
done

if [ -z "$ADMIN_ADDRESS" ]; then
  echo "ERROR: ADMIN_ADDRESS is required."
  echo "       Set it as an env var: ADMIN_ADDRESS=GXXX... bash scripts/deploy-full.sh"
  exit 1
fi

echo "========================================"
echo " Full Deployment Pipeline"
echo " Network : $NETWORK"
echo " Account : $SOURCE_ACCOUNT"
echo " Admin   : $ADMIN_ADDRESS"
echo " Asset   : $ASSET_NAME"
echo " NAV     : \$$((NAV_PRICE / 100)).$((NAV_PRICE % 100 / 10))0 (${NAV_PRICE} cents)"
if $SKIP_CHECKS; then echo " Mode    : SKIP ALL CHECKS (fast deploy)"; fi
if $SKIP_TESTS;  then echo " Mode    : SKIP TESTS ONLY"; fi
echo "========================================"

# Step 1 — checks
if $SKIP_CHECKS; then
  echo ""
  echo "[ SKIPPED ] Checks skipped via --skip-checks"
elif $SKIP_TESTS; then
  echo ""
  echo "[ 1/8 ] Running format + lint only (tests skipped)..."
  cd "$ROOT"
  cargo fmt --check -p nav-oracle && cargo clippy -p nav-oracle -- -D warnings -A deprecated
  cargo fmt --check -p approval-control && cargo clippy -p approval-control -- -D warnings -A deprecated
  echo "        ✓ Format and lint OK"
else
  echo ""
  echo "[ 1/8 ] Running all checks..."
  bash "$SCRIPTS/check-contract.sh"
fi

# Step 2 — build both contracts
echo ""
echo "[ 2/8 ] Building contracts..."
cd "$ORACLE_DIR" && stellar contract build
cd "$TOKEN_DIR"  && stellar contract build
ORACLE_WASM="$ROOT/target/wasm32v1-none/release/nav_oracle.wasm"
TOKEN_WASM="$ROOT/target/wasm32v1-none/release/approval_control.wasm"
echo "        ✓ Both contracts built"

# Step 3 — deploy nav-oracle
echo ""
echo "[ 3/8 ] Deploying NAV oracle to $NETWORK..."
ORACLE_DEPLOY=$(stellar contract deploy \
  --wasm "$ORACLE_WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK")
ORACLE_CONTRACT_ID=$(echo "$ORACLE_DEPLOY" | tail -1)
if [ -z "$ORACLE_CONTRACT_ID" ]; then
  echo "ERROR: Oracle deploy did not return a contract ID."
  exit 1
fi
echo "        ✓ Oracle deployed: $ORACLE_CONTRACT_ID"

# Step 4 — initialize nav-oracle
echo ""
echo "[ 4/8 ] Initializing NAV oracle..."
stellar contract invoke \
  --id "$ORACLE_CONTRACT_ID" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDRESS"
echo "        ✓ Oracle initialized"

echo ""
echo "[ 4b ] Setting initial NAV price (${NAV_PRICE} cents)..."
stellar contract invoke \
  --id "$ORACLE_CONTRACT_ID" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  -- update_price \
  --admin "$ADMIN_ADDRESS" \
  --price "$NAV_PRICE"
echo "        ✓ Oracle price set"

# Step 5 — deploy approval-control token contract
echo ""
echo "[ 5/8 ] Deploying token contract to $NETWORK..."
TOKEN_DEPLOY=$(stellar contract deploy \
  --wasm "$TOKEN_WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK")
CONTRACT_ID=$(echo "$TOKEN_DEPLOY" | tail -1)
if [ -z "$CONTRACT_ID" ]; then
  echo "ERROR: Token deploy did not return a contract ID."
  exit 1
fi
echo "        ✓ Token contract deployed: $CONTRACT_ID"

# Step 6 — initialize token contract with oracle ID
echo ""
echo "[ 6/8 ] Initializing token contract..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --asset_name "$ASSET_NAME" \
  --nav_oracle_id "$ORACLE_CONTRACT_ID"
echo "        ✓ Token contract initialized"

# Step 7 — regenerate contract interface files
echo ""
echo "[ 7/8 ] Regenerating contract interface files..."
cd "$ROOT"
stellar contract info interface \
  --wasm "$TOKEN_WASM" \
  --output json-formatted 2>/dev/null > "$ROOT/approval-control-interface.json"
stellar contract info interface \
  --wasm "$ORACLE_WASM" \
  --output json-formatted 2>/dev/null > "$ROOT/nav-oracle-interface.json"
echo "        ✓ approval-control-interface.json updated"
echo "        ✓ nav-oracle-interface.json updated"

echo ""
echo "========================================"
echo " Contracts deployed and initialized!"
echo " Oracle ID : $ORACLE_CONTRACT_ID"
echo " Token ID  : $CONTRACT_ID"
echo "========================================"

# Step 8 — Vercel
echo ""
echo "[ 8/8 ] Updating Vercel..."
cd "$ROOT/frontend"
npx vercel env rm NEXT_PUBLIC_CONTRACT_ID production --yes 2>/dev/null || true
npx vercel env rm NEXT_PUBLIC_ORACLE_CONTRACT_ID production --yes 2>/dev/null || true
echo "$CONTRACT_ID"       | npx vercel env add NEXT_PUBLIC_CONTRACT_ID production
echo "$ORACLE_CONTRACT_ID" | npx vercel env add NEXT_PUBLIC_ORACLE_CONTRACT_ID production
if [ -n "$WALLETCONNECT_PROJECT_ID" ]; then
  npx vercel env rm NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID production --yes 2>/dev/null || true
  echo "$WALLETCONNECT_PROJECT_ID" | npx vercel env add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID production
fi

# Also update local .env.local
cat > "$ROOT/frontend/.env.local" <<EOF
NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID
NEXT_PUBLIC_ORACLE_CONTRACT_ID=$ORACLE_CONTRACT_ID
NEXT_PUBLIC_STELLAR_NETWORK=$NETWORK
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${WALLETCONNECT_PROJECT_ID}
EOF
echo "        ✓ .env.local updated"

VERCEL_OUTPUT=$(npx vercel --prod 2>&1)
echo "$VERCEL_OUTPUT"
DEPLOY_URL=$(echo "$VERCEL_OUTPUT" | grep "^Production:" | awk '{print $2}' | sed 's|https://||')
if [ -n "$DEPLOY_URL" ]; then
  npx vercel alias set "$DEPLOY_URL" stellar-tokenization-ji.vercel.app
fi

echo ""
echo "========================================"
echo " All done!"
echo " Oracle ID : $ORACLE_CONTRACT_ID"
echo " Token ID  : $CONTRACT_ID"
echo " Frontend  : https://stellar-tokenization-ji.vercel.app"
echo "========================================"
