#!/usr/bin/env bash
# Visual Actor — automated latency benchmark.
# Runs N headless speech sessions through the real engine and writes
# benchmark_results.json + benchmark_report.txt with a PASS/FAIL verdict.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ -d .venv ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

RUNS="${1:-5}"
echo "Running Visual Actor benchmark (${RUNS} runs)..."
python -m app.benchmarks.run_benchmark --runs "$RUNS" \
  --json benchmark_results.json --txt benchmark_report.txt
status=$?
echo
echo "Wrote benchmark_results.json and benchmark_report.txt"
exit $status
