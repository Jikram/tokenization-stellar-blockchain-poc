#!/usr/bin/env bash
set -euo pipefail

# Full deployment pipeline: check → build → deploy → initialize → vercel
#
# Usage:
#   bash scripts/deploy-full.sh                          # full pipeline with all checks
#   bash scripts/deploy-full.sh --skip-checks            # skip format/lint/tests (fast deploy)
#   bash scripts/deploy-full.sh --skip-tests             # skip tests only, keep format/lint
#
# Required env vars:
#   SOURCE_ACCOUNT  — Stellar CLI identity (e.g. alice)
#   ADMIN_ADDRESS   — Freighter wallet to set as contract admin
#
# Optional env vars:
#   ASSET_NAME      — defaults to "Tokenized Real Estate Fund Series A"
#   STELLAR_NETWORK — defaults to testnet

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
CONTRACT_DIR="$ROOT/contracts/approval-control"

SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-alice}"
ADMIN_ADDRESS="${ADMIN_ADDRESS:-GDGQDFBRJ4V2Q7L7DZBM62P7IDDTBVF7KE6B5BMDVTG2JHJGT4OH6IBQ}"
ASSET_NAME="${ASSET_NAME:-Tokenized Real Estate Fund Series A}"
NETWORK="${STELLAR_NETWORK:-testnet}"
SKIP_CHECKS=false
SKIP_TESTS=false

# Parse flags
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
if $SKIP_CHECKS; then echo " Mode    : SKIP ALL CHECKS (fast deploy)"; fi
if $SKIP_TESTS;  then echo " Mode    : SKIP TESTS ONLY"; fi
echo "========================================"

# Step 1 — checks
if $SKIP_CHECKS; then
  echo ""
  echo "[ SKIPPED ] Checks skipped via --skip-checks"
elif $SKIP_TESTS; then
  echo ""
  echo "[ 1/4 ] Running format + lint only (tests skipped)..."
  cd "$CONTRACT_DIR"
  cargo fmt --check
  cargo clippy -- -D warnings -A deprecated
  echo "        ✓ Format and lint OK"
  cd "$ROOT"
else
  echo ""
  echo "[ 1/4 ] Running all checks..."
  bash "$SCRIPTS/check-contract.sh"
fi

# Step 2 — build
echo ""
echo "[ 2/4 ] Building contract..."
cd "$CONTRACT_DIR"
stellar contract build
WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/approval_control.wasm"
echo "        ✓ Build complete"

# Step 3 — deploy
echo ""
echo "[ 3/4 ] Deploying to $NETWORK..."
DEPLOY_OUTPUT=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK")
CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | tail -1)
if [ -z "$CONTRACT_ID" ]; then
  echo "ERROR: Deploy did not return a contract ID."
  exit 1
fi
echo "        ✓ Deployed: $CONTRACT_ID"

# Step 4 — initialize
echo ""
echo "[ 4/4 ] Initializing contract..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --asset_name "$ASSET_NAME"
echo "        ✓ Contract initialized"

echo ""
echo "========================================"
echo " Contract deployed and initialized!"
echo " Contract ID: $CONTRACT_ID"
echo "========================================"

# Step 5 — Vercel
echo ""
echo "[ 5/5 ] Updating Vercel..."
cd "$ROOT/frontend"
npx vercel env rm NEXT_PUBLIC_CONTRACT_ID production --yes
echo "$CONTRACT_ID" | npx vercel env add NEXT_PUBLIC_CONTRACT_ID production
VERCEL_OUTPUT=$(npx vercel --prod 2>&1)
echo "$VERCEL_OUTPUT"
DEPLOY_URL=$(echo "$VERCEL_OUTPUT" | grep "^Production:" | awk '{print $2}' | sed 's|https://||')
if [ -n "$DEPLOY_URL" ]; then
  npx vercel alias set "$DEPLOY_URL" stellar-tokenization-ji.vercel.app
fi

echo ""
echo "========================================"
echo " All done!"
echo " Contract ID : $CONTRACT_ID"
echo " Frontend    : https://stellar-tokenization-ji.vercel.app"
echo "========================================"
