#!/usr/bin/env bash
# Uso: test/dev.sh [--port 8787]   (estado local en test/.state)
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf test/.build && mkdir -p test/.build/src
test/sync.sh
cp schema.sql test/.build/
# Sin la ruta del dominio (en local no hace falta)
awk '/^routes = \[/{skip=1} skip&&/^\]/{skip=0;next} !skip' wrangler.toml > test/.build/wrangler.toml
cd test/.build
exec ../../node_modules/.bin/wrangler dev --local --persist-to ../.state \
  --var ADMIN_TOKEN:test-admin --test-scheduled "$@"
