#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"/../contracts/approval-control

echo "========================================"
echo " Approval Control Contract — CI Checks"
echo "========================================"

echo ""
echo "[ 1/5 ] Formatting check (rustfmt)..."
cargo fmt --check
echo "       ✓ Formatting OK"

echo ""
echo "[ 2/5 ] Linting (clippy)..."
cargo clippy -- -D warnings -A deprecated
echo "       ✓ No lint warnings"

echo ""
echo "[ 3/5 ] Unit tests..."
cargo test
echo "       ✓ All tests passed"

echo ""
echo "[ 4/5 ] Security audit (cargo audit)..."
if command -v cargo-audit >/dev/null 2>&1; then
    cargo audit
    echo "       ✓ No known vulnerabilities"
else
    echo "       ⚠ cargo-audit not installed. Run: cargo install cargo-audit"
fi

echo ""
echo "[ 5/5 ] Code coverage (cargo llvm-cov)..."
if command -v cargo-llvm-cov >/dev/null 2>&1; then
    cargo llvm-cov --summary-only
    echo "       ✓ Coverage report generated"
else
    echo "       ⚠ cargo-llvm-cov not installed. Run: cargo install cargo-llvm-cov"
fi

echo ""
echo "========================================"
echo " All checks complete"
echo "========================================"
