#!/usr/bin/env bash
set -euo pipefail

# Query the Soroban contract for approval status on Testnet.
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <contract-id> <user-address>"
  exit 1
fi

CONTRACT_ID="$1"
USER_ADDRESS="$2"

soroban contract invoke --id "$CONTRACT_ID" --fn is_approved --arg "$USER_ADDRESS" --network testnet
