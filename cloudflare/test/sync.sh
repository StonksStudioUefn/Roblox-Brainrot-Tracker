#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cp -r src/. test/.build/src/
