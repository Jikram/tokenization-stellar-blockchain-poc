#!/usr/bin/env bash
set -euo pipefail

# Send a protected-action invocation to the contract on Testnet.
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <contract-id> <user-address>"
  exit 1
fi

CONTRACT_ID="$1"
USER_ADDRESS="$2"

soroban contract invoke --id "$CONTRACT_ID" --fn execute_action --arg "$USER_ADDRESS" --network testnet
