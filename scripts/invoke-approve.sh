#!/usr/bin/env bash
set -euo pipefail

# Send a transaction to approve a user through the admin account.
if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <contract-id> <admin-address> <user-address>"
  exit 1
fi

CONTRACT_ID="$1"
ADMIN_ADDRESS="$2"
USER_ADDRESS="$3"

soroban contract invoke --id "$CONTRACT_ID" --fn approve_user --arg "$ADMIN_ADDRESS" --arg "$USER_ADDRESS" --network testnet
