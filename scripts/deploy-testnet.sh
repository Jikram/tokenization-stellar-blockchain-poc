#!/usr/bin/env bash
set -euo pipefail

# Deploy the compiled contract to Soroban Testnet using the local Stellar CLI.
cd "$(dirname "$0")"/../contracts/approval-control

WASM_PATH="target/wasm32-unknown-unknown/release/approval_control.wasm"
if [ ! -f "$WASM_PATH" ]; then
  echo "ERROR: compiled WASM not found. Run ./scripts/build-contract.sh first."
  exit 1
fi

CLI="${STELLAR_CLI:-stellar}"
SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-${STELLAR_ACCOUNT:-}}"
RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK="${STELLAR_NETWORK:-testnet}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

if ! command -v "$CLI" >/dev/null 2>&1; then
  echo "ERROR: $CLI not found. Install the Stellar CLI or set STELLAR_CLI to a valid command."
  exit 1
fi

if [ -z "$SOURCE_ACCOUNT" ]; then
  echo "ERROR: SOURCE_ACCOUNT is required. Set SOURCE_ACCOUNT or STELLAR_ACCOUNT to a source identity or public key."
  exit 1
fi

echo "Deploying ApprovalControlContract to Stellar Testnet with $CLI..."
CONTRACT_ID=$("$CLI" contract deploy --wasm "$WASM_PATH" --source-account "$SOURCE_ACCOUNT" --rpc-url "$RPC_URL" --network "$NETWORK" --network-passphrase "$NETWORK_PASSPHRASE" | tee /tmp/approval-contract-id.txt)

echo
if [ -n "$CONTRACT_ID" ]; then
  echo "Deploy complete. Copy this contract ID into frontend/.env.local:"
  echo "$CONTRACT_ID"
else
  echo "Deployment did not return a contract ID. Check the CLI output above for details."
  exit 1
fi
