#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "========================================"
echo " Contract CI Checks (workspace)"
echo "========================================"

for pkg in nav-oracle approval-control; do
  echo ""
  echo "--- $pkg ---"

  echo ""
  echo "[ fmt  ] Formatting check..."
  cargo fmt --check -p "$pkg"
  echo "         ✓ OK"

  echo ""
  echo "[ lint ] Clippy..."
  cargo clippy -p "$pkg" -- -D warnings -A deprecated
  echo "         ✓ OK"

  echo ""
  echo "[ test ] Unit tests..."
  cargo test -p "$pkg"
  echo "         ✓ OK"
done

echo ""
echo "[ audit ] Security audit (workspace)..."
if command -v cargo-audit >/dev/null 2>&1; then
  cargo audit
  echo "          ✓ No known vulnerabilities"
else
  echo "          ⚠ cargo-audit not installed. Run: cargo install cargo-audit"
fi

echo ""
echo "[ cov ] Code coverage (workspace)..."
if command -v cargo-llvm-cov >/dev/null 2>&1; then
  cargo llvm-cov --summary-only
  echo "        ✓ Coverage report generated"
else
  echo "        ⚠ cargo-llvm-cov not installed. Run: cargo install cargo-llvm-cov"
fi

echo ""
echo "========================================"
echo " All checks complete"
echo "========================================"
