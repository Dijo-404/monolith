#!/usr/bin/env bash
set -euo pipefail

# Dependencies and copies stay outside every checkout. Use Node 24.22.2 from MN-001.
spike_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
experiment_dir=${MONOLITH_ARKIV_ENV:-$(mktemp -d "${TMPDIR:-/tmp}/monolith-mn005-XXXXXX")}
mkdir -p "$experiment_dir"
experiment_dir=$(CDPATH= cd -- "$experiment_dir" && pwd)
if git -C "$experiment_dir" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo 'Use an isolated environment outside every repository' >&2
  exit 2
fi
if [[ -f "$experiment_dir/package.json" ]] && ! node --input-type=module -e '
import {readFileSync} from "node:fs";
if (JSON.parse(readFileSync(process.argv[1], "utf8")).name !== "monolith-mn005-isolated") process.exit(2);
' "$experiment_dir/package.json"; then
  echo 'Refusing to use an unrelated package environment' >&2
  exit 2
fi
chmod 700 "$experiment_dir"
if [[ ! -f "$experiment_dir/node_modules/@arkiv-network/sdk/package.json" ]]; then
  printf '%s\n' '{"name":"monolith-mn005-isolated","private":true,"type":"module"}' > "$experiment_dir/package.json"
  npm install --prefix "$experiment_dir" --save-exact \
    @arkiv-network/sdk@1.0.1 viem@2.57.16 typescript@6.0.3 @types/node@24.19.2 >&2
fi
cp "$spike_dir"/*.mts "$experiment_dir/"
cd "$experiment_dir"
node --input-type=module -e '
import {readFileSync} from "node:fs";
for (const [name,version] of Object.entries({"@arkiv-network/sdk":"1.0.1","viem":"2.57.16","typescript":"6.0.3","@types/node":"24.19.2"})) {
  if (JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version !== version) throw new Error("Isolated dependency version mismatch");
}'
if [[ ${1:-} == selfcheck ]]; then
  node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2023 \
    --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --types node ./*.mts
  node --test ./*.test.mts
else
  node ./arkiv-preflight.mts "$@"
fi
