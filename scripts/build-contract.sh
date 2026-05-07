#!/usr/bin/env bash
set -euo pipefail

# Build the Soroban contract to WASM using the Rust toolchain.
cd "$(dirname "$0")"/../contracts/approval-control

echo "Building ApprovalControlContract to WASM..."
cargo build --target wasm32-unknown-unknown --release

echo "Built file: target/wasm32-unknown-unknown/release/approval-control.wasm"
