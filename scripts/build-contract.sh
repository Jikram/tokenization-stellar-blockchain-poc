#!/usr/bin/env bash
set -euo pipefail

# Build the Soroban contract to WASM using the Rust toolchain.
cd "$(dirname "$0")"/../contracts/approval-control

echo "Building ApprovalControlContract to WASM..."
stellar contract build

echo "Built file: target/wasm32v1-none/release/approval_control.wasm"
