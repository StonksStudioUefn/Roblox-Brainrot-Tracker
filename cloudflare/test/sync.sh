#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."
cp -r src/. test/.build/src/
for f in test/stubs/*.js; do b=$(basename "$f"); [ -e "src/$b" ] || cp "$f" "test/.build/src/$b"; done
