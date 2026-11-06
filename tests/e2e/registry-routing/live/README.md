# Explicit MN-013 registry routing acceptance

This runner starts its own temporary observer and Vite server, queries actual
Arkiv records through the public registry API, then executes the production
`createBrowserRegistryTransport` composition in Chromium with the real Nym
worker. Ordinary `pnpm check` does not execute it or depend on external networks.

The operator policy comes from the already accepted, committed 100-network
import and selected chain-10 record. It is fixed before any fresh API response:
creator and owner, immutable source revision/catalog hash/license, the exact
source-file URL prefix and `https://mainnet.optimism.io` origin. A changed import
requires explicit policy review; a response cannot expand these pins. The live
candidate's endpoint/entity identity is obtained from the fresh API manifest,
not loaded as a substitute from a historical response.

The worker boots before the short-lived manifest is requested. Selection probes
`eth_chainId` through that worker; the ordinary protected read is
`eth_blockNumber`. Both must complete before the API manifest's 30-second
deadline. Expiry is never waived for a slow network. The source record's longer
content deadline cannot extend routing authority. There is no cache fallback.

## Reproduction

Use workspace-pinned Node **24.22.2** and pnpm **12.18.0**. Install browser tools
outside the repository, without modifying workspace manifests or the lockfile:

```sh
browser_tools=$(mktemp -d /tmp/monolith-mn013-browser-tools.XXXXXX)
npm install --prefix "$browser_tools" --no-fund playwright@1.65.0 @noble/hashes@1.8.0
MONOLITH_BROWSER_TOOLS="$browser_tools" node "$browser_tools/node_modules/playwright/cli.js" install chromium
pnpm install --frozen-lockfile
pnpm build
pnpm exec tsc -p tests/e2e/registry-routing/live/tsconfig.json --noEmit
MONOLITH_BROWSER_TOOLS="$browser_tools" node tests/e2e/registry-routing/live/run.mjs --run --output /tmp/monolith-mn013-observed.json
```

An existing isolated installation with those exact tool versions can be reused.
`MONOLITH_CHROMIUM_PATH` optionally selects an explicitly installed Chromium
binary. The generated artifact records the actual browser version. The runner
creates its own loopback ports and closes its browser context, browser, observer
and Vite server. The observer and Chromium child receive explicitly selected
public environment values, without signing configuration. It neither reads a
key nor signs, writes Arkiv records, funds accounts or submits transactions.

The private network, public RPC or Arkiv service can be unavailable. The runner
returns nonzero with a generated `BLOCKED` artifact; no recorded response,
simulated worker or ordinary RPC fallback replaces a failed operation. Existing
imported records eventually expire; a new accepted import and reviewed pins are
then required. Run the command while no source/build edit is in progress: the
artifact hashes source files, compiled public packages and the lockfile before
execution and requires unchanged bytes afterwards.

## What the artifact verifies

- An actual API response with `OBSERVED_LIVE`/`arkiv-query` provenance supplies
  the exact candidate used by the production browser composition.
- Real worker metadata and a captured resolver response have matching Keccak
  bundle hashes; successful bootstrap, protected chain probe and ordinary read
  are recorded as separate traces.
- An independent Playwright interceptor first proves it detects an intentional
  direct HTTP call to the candidate origin, then blocks every ordinary browser
  HTTP request there during the actual run. A passing run observes zero such
  requests. Worker WebRTC/KPS traffic lies outside this interception boundary.
- The captured metadata response matches the selected manifest exactly. A
  passing read finishes before its deadline, then repeated close clears worker
  metadata and selection, removes frames and denies another read.
- Source/compiled-module/lockfile hashes bind the run to the implementation that
  executed. Public source/entity provenance is preserved; raw IPs, wallet/order
  payloads, signatures and capabilities are absent.

The public metadata HTTP request and server-side Arkiv query are ordinary
contacts. The specifier lookup is separately disclosed non-anonymous bootstrap.
The RPC endpoint can still read request contents. This is a bounded routing
observation; it does not establish browser DNS pinning, app-wide traffic
coverage, paired observer source classes or sponsor eligibility. MN-009's
paired-source gate remains independent.

## Recorded execution

The [unchanged generated observation](observed-live-2026-11-06.json) ran from
**2026-11-06T15:14:19.889Z** to **15:14:40.143Z**, with Node24.22.2 and Chromium
158.0.8127.18. The exact command used the existing isolated browser tools:

```sh
PATH=/tmp/monolith-node24/node-v24.22.2-linux-x64/bin:/tmp/monolith-mn010-bin:$PATH MONOLITH_BROWSER_TOOLS=/tmp/monolith-anon-xEX2ji node tests/e2e/registry-routing/live/run.mjs --run --output tests/e2e/registry-routing/live/observed-run-2026-11-06.json
```

The neutral output filename was renamed after the runner returned
`OBSERVED_LIVE`; its bytes are unchanged. Artifact SHA-256:
`d6c847bc79fa7b0e8efc74aa5ec6926e63d42efeea193d8db71b1043d7cbb28a`.

- The real Nym worker was ready at15:14:31.597Z. The ordinary metadata request
  started at15:14:31.600Z and returned the actual chain-10 OP Mainnet record,
  entity `0xc8d33bed907f23f9cddcf19fb151318dbe7758c5880a6378e8f6a50826010f07`,
  from creator/owner `0x93d1a42655f2b0bcfa126e3d2a33e4ab60a74ca4`.
- The manifest was generated at15:14:33.465Z and expired at15:15:03.465Z.
  Its immutable ethereum-lists source revision was
  `e17474286275730fb6b0490b1d7ea1c64a36ed9e`, with catalog SHA-256
  `2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952`.
  The fresh API response exactly matched the selected manifest and accepted
  entity/provenance; it supplied the endpoint URL used by the production factory.
- The protected chain-ID probe succeeded on attempt1 in5,887ms. The ordinary
  `eth_blockNumber` read returned **`0x97d0a93`** on attempt1 in732ms at
  **15:14:40.096Z**, before the manifest deadline. Total browser lifecycle
  duration was19,565ms. Both traces used `anon-nym`; the chain probe was not a
  bootstrap exception.
- The actual18,283,862-byte worker response from the pinned documented Nym
  resolver matched the captured worker hash
  `0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8`.
  The two successful `direct-bootstrap` specifier reads remain separate.
- The direct HTTP detection control passed; the actual run observed **zero**
  ordinary browser HTTP requests to the candidate origin. Repeated close left
  `CLOSED`, zero frames, cleared selection/worker metadata and a denied future
  read. The context, browser, observer and Vite server all stopped.
- All110 recorded source/build/harness/accepted-import file hashes and the
  lockfile hash matched before and after execution. No writes, keys or signing
  environment were involved.

The generated manifest is now historical and must never be loaded as fresh
registry configuration or a fallback. This run does not satisfy MN-009's
independent paired-source gate or assert application-wide traffic coverage.
