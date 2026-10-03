#!/usr/bin/env bash
# Copia src/ a test/.build/src (wrangler dev recarga solo) sin pisar los stubs.
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."
cp -r src/. test/.build/src/
for f in test/stubs/*.js; do b=$(basename "$f"); [ -e "src/$b" ] || cp "$f" "test/.build/src/$b"; done
