#!/usr/bin/env bash
# Arranca `wrangler dev --local` sobre una copia de src/ en test/.build, rellenando
# con test/stubs/ los módulos de otros equipos que aún no existan.
# Uso: test/dev.sh [--port 8787]      (estado local persistente en test/.state)
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf test/.build && mkdir -p test/.build/src
cp -r src/. test/.build/src/
cp schema.sql test/.build/
for f in test/stubs/*.js; do
  b=$(basename "$f")
  [ -e "src/$b" ] || { echo "stub: $b"; cp "$f" "test/.build/src/$b"; }
done
# Sin la ruta del dominio (en local no hace falta)
awk '/^routes = \[/{skip=1} skip&&/^\]/{skip=0;next} !skip' wrangler.toml > test/.build/wrangler.toml
cd test/.build
exec ../../node_modules/.bin/wrangler dev --local --persist-to ../.state \
  --var ADMIN_TOKEN:test-admin --test-scheduled "$@"
