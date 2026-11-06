# MN-013 registry-driven protected routing

The dashboard [browser composition](../../../apps/dashboard/src/composition/transport.ts)
connects the [public registry client](../../../apps/dashboard/src/composition/registry.ts)
to the public MonolithTransport/browser adapter APIs. It does not mount a UI or
change the active dashboard shell. MN-014 supplies the application-owned host
asset calling `installBrowserHost()` and connects the presenter to these ports;
the acceptance harness has its own isolated [host](live/host.ts).

`createBrowserRegistryTransport` takes deployment pins independently of the
response: creator/owner pairs, approved HTTPS origins, immutable source revision,
catalog hash, license URL and exact source-file URL prefix. The registry URL has
the fixed `/api/registry/chains` path. Same-origin metadata is allowed; remote
metadata requires public HTTPS. Cookies, referrers, redirects, personalized query
parameters and a stale/unsigned cache fallback are excluded. Streaming response
size, deadlines and outstanding metadata calls are bounded.

Call `select(chainId)` before `read({readId, method, params, callsite})`. Selection
initializes the verified worker **before** fetching the short-lived public
manifest, rechecks the entire manifest and pins, and issues `eth_chainId` through
the same protected transport. The return includes the original public manifest
and endpoint plus a local `routingEndpointId` which correlates protected traces
to this exact selection generation. The local capability retains the original
URL/publisher/entity/provenance and expires at the earlier of the endpoint and
manifest deadlines. It cannot inherit the endpoint's hours-long lifetime when
the manifest lasts only 30 seconds.

A replacement selection immediately revokes the wrapper's prior readiness.
Expired, forged, wrong-chain, unsupported-version or unavailable registry data
cannot authorize ordinary reads. Selection and read results are checked again
after awaited operations; obsolete completions cannot restore readiness. Each
selection has a distinct capability so a revision change cannot reuse an older
probe even when its URL and deadlines match. There are no internal retries: a
new read reenters current selection checks and uses a fresh `readId`. Recreating
the session is required after 128 selection attempts, bounding retained endpoint
capabilities. Repeated `close()` is safe and clears selection/worker resources.

The worker host URL must be an application-owned same-origin asset. Ordinary
metadata HTTP, the backend's public Arkiv query and the narrowly enumerated
specifier bootstrap are disclosed contacts; only the probe and ordinary RPC
read use the anonymizing worker. Browser origin checks do not establish DNS
pinning. The destination still sees JSON-RPC contents.

## Verification

Use Node **24.22.2** and pnpm **12.18.0** from the workspace pins:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec vitest run tests/e2e/registry-routing/registry.test.mjs tests/e2e/registry-routing/transport.test.mjs
pnpm exec tsc -p tests/e2e/registry-routing/live/tsconfig.json --noEmit
```

The full check passed **1,010 tests in 25 files**, lint, public package/dashboard
type checks and builds. The new **93 SIMULATED cases** exercise strict public
metadata admission/HTTP bounds, trusted publisher and provenance, wrong chains,
expiry before/during probes and reads, expiry before retry, refresh outage after
success, overlapping selection/read completion, worker close and resource limits.
A separate reviewer independently reran those 93 cases without a test cache.
These software checks do not prove live routing.

See the [explicit browser runner and evidence](live/README.md) for actual
Arkiv-backed protected-read acceptance. Ordinary `pnpm check` remains offline.
Historical generated manifests are evidence only; they are never accepted as
fresh configuration or a fallback. MN-009's independent paired-source gate and
its current blocker are separate from this bounded routing task.
