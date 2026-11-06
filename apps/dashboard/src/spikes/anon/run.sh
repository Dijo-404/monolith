#!/bin/sh
set -eu

# Execute the isolated Node runner outside the browser source boundary.
spike_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
runner_dir="$(mktemp -d /tmp/monolith-anon-runner.XXXXXX)"
cp "$spike_dir/run.mjs.txt" "$runner_dir/run.mjs"
cp "$spike_dir/main.ts.txt" "$runner_dir/main.ts.txt"
cp "$spike_dir/index.html" "$runner_dir/index.html"
exec node "$runner_dir/run.mjs" "$@"
