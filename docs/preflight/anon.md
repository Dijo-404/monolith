# MN-003: isolated browser Anon-RPC preflight

**Result:** a real Nym worker returned Ethereum `eth_chainId = 0x1` in Chromium on 6 November 2026. Tor's bundle verified, but its worker did not become ready before the deadline. No passthrough worker or mocked RPC result was used.

**Scope:** experiment only under [MN-003](https://github.com/Dijo-404/monolith/issues/3). The formal issue remains in backlog until MN-002 merges, this branch rebases onto the foundation, and integrated checks pass. This report does not establish paired observer evidence, application-wide privacy coverage, or sponsor eligibility. Follow the [workflow](../../CONTRIBUTING.md) and [architecture](../architecture.md) before integrating.

## Reproduce without changing workspace tooling

Use Node **24.22.2**, npm, and Linux Chromium dependencies. From the repository root:

```sh
# Install the matching browser through a temporary, isolated package directory.
browser_env="$(mktemp -d /tmp/monolith-anon-browser.XXXXXX)"
npm install --prefix "$browser_env" --no-save --no-package-lock playwright@1.65.0
node "$browser_env/node_modules/playwright/cli.js" install chromium

# Installs its own exact direct dependencies into a new /tmp/monolith-anon-*.
sh apps/dashboard/src/spikes/anon/run.sh tor nym
```

The browser and Node runner sources are stored as `main.ts.txt` and `run.mjs.txt`. The shell launcher copies them into temporary executable files, keeping both outside dashboard compilation and browser import boundaries. The runner prints the temporary environment and `observed.json` path. It creates no repository package manifest, lockfile, build output, or evidence file. Copy reviewed observations into the spike directory deliberately; do not publish raw browser traces or worker logs.

Default deadline: **180000 ms per network**. `MONOLITH_ATTEMPT_MS=300000` permits a bounded longer attempt; supported range is 1000–300000 ms. For a single network, pass `nym` or `tor`. `MONOLITH_CHROMIUM_PATH` can select an already installed Chromium, whose actual version is recorded. Exit codes: `0` means at least one read returned with boundary/shutdown checks passing; `1` means neither read returned; `2` means a boundary or shutdown check failed. Setup/infrastructure exceptions also exit nonzero and must not be presented as successful evidence.

The installed direct versions are browser-harness/core **0.4.0**, noble hashes **1.8.0**, Playwright **1.65.0**, Vite **8.3.6**, and TypeScript **6.0.3**. The artifact records the isolated lock hash and its resolved dependency inventory, including optional platform entries. This is not a claim that every optional package was installed. Future transitive resolutions can differ; the temporary lockfile is kept beside the run output.

## Observed execution

The checked-in [redacted observations](../../apps/dashboard/src/spikes/anon/observed-2026-11-06.json) come from the final real-browser run. Both attempts used fresh contexts in **headless Chromium 158.0.8127.18**, Node **v24.22.2**, and the versions above. The artifact's export note documents metadata field normalization; attempt observations were preserved.

| Network | Start (UTC) | Observed outcome | Total attempt time |
| --- | --- | --- | --- |
| Tor-JS | 2026-11-06 12:17:48.399 | `BLOCKED`: readiness deadline; no chain result | 180003 ms |
| Nym | 2026-11-06 12:20:48.498 | `OBSERVED_LIVE`: ready, then `worker.fetch` returned `0x1` | 24221 ms |

These are individual attempt durations including bootstrap and shutdown, not latency percentiles or a performance benchmark. An earlier exploratory run also returned `0x1` through Nym in 28123 ms. After isolating both executable sources as templates, a [packaging smoke run](../../apps/dashboard/src/spikes/anon/packaging-smoke-2026-11-06.json) again returned `0x1` through Nym in 20469 ms at `2026-11-06T12:27:51.552Z`, with the same hash and passing boundary/shutdown checks.

Both contexts passed the deliberate interception self-check: an ordinary POST to the protected target was blocked before egress. The actual worker attempt then recorded **zero ordinary browser HTTP requests** to that target. The negative control is recorded separately from attempt network failures. Interception covers browser HTTP to this one configured target; it does not inspect all browser traffic, WebRTC/KPS streams, or Nym packet contents.

After each attempt, `close()` removed the visible harness iframe, and a subsequent fetch rejected immediately with `WORKER_CLOSED` (rounded measurement: 0 ms). The runner then destroyed the entire browser context. Tor failure did not initiate a direct retry. These observations establish the tested lifecycle path; they do not establish cancellation of every underlying SDK operation.

## Actual worker and bootstrap metadata

| Network | Specifier | Matching actual HTTPS resolver reply |
| --- | --- | --- |
| Tor-JS | `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e` | `tor-js@0.4.4`, 6874306 bytes, keccak256 `0x5b62f358ce7a2b94ee9bc3a0e6a08757db68fa08fc348276f31eda788aec818b` |
| Nym | `0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0` | `@nymproject/anon-rpc-worker@0.1.0`, 18283862 bytes, keccak256 `0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8` |

The bootstrap provider is fixed to `https://ethereum.publicnode.com`. It permits exactly one `eth_call` for each of `workerHash()` (`0x3898587d`) and `workerResolvers()` (`0x1c67ff29`), to the selected specifier at `latest`. Both calls succeeded for each worker. Other methods, targets, selectors, additional transaction fields, duplicate selectors, and further calls are rejected before fetch. The application chain-ID read goes only through `worker.fetch` to the separately configured `https://ethereum-rpc.publicnode.com`.

The bootstrap responses are decoded from captured replies using the **public** harness-core export, without a second network lookup. Playwright hashes the bytes of actual HTTPS resolver responses independently. This is host observation: browser-harness exposes no integrity metadata getter. Its inspected implementation verifies the hash before executing a bundle; observed Nym readiness is consistent with that step. Neither a matching hash nor readiness alone proves anonymous egress.

Tor used the public demonstration gateway copied from the official guide:

```text
152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ
```

That is public gateway configuration, not a logged client/source IP. Nym received `config: undefined` (represented as `null` in the exported observation), using the worker's automatic gateway discovery. The chosen Nym gateway identity was not exported; this report makes no claim about a particular gateway. KPS resolver addresses are omitted from the artifact; the successful HTTPS resolver URL and actual bundle hash are retained.

**Non-anonymous setup is separate from the protected read.** The bootstrap RPC contacts its configured provider directly. Bundle retrieval contacts the public CDN directly. Nym also uses network directory/gateway setup; its source documents HTTPS discovery and WebSocket gateway connections. Those contacts are not counted as protected application reads. The trusted bootstrap provider and specifier publisher remain trust assumptions. The RPC destination can still read JSON-RPC payloads.

## Browser constraints, failures, and limits

- The test served the spike on `http://127.0.0.1:4317`, with the real null-origin `sandbox="allow-scripts"` iframe and a Web Worker. No restrictive production CSP or custom `iframeUrl` was tested. Inline iframe bootstrap, blob worker creation, WebAssembly, IndexedDB, and the required network transports must be permitted by deployment policy.
- The bootstrap provider and actual jsDelivr resolver responded in this Chromium environment. No ordinary HTTPS network failure was observed in the final attempts. This does not establish CORS compatibility for the future controlled observer or every RPC provider. Headed/manual browser use remains untested.
- Tor's WebRTC ICE observations remained `checking`; sanitized log classification counted one gateway failure and three timeout messages. This supports an unresolved gateway/network startup problem, without identifying its root cause. Limited demo-gateway capacity is an upstream caveat. Nym succeeded, so Tor is not the selected feasibility path for integration.
- Source inspection found that harness 0.4.0 `close()` does not cancel pending bootstrap/resolver awaits or guard every later boot continuation. That race was **not runtime-reproduced** here. The runner aborts its own provider/read requests, calls close, then destroys the context before awaiting incomplete response bodies. Do not promise that close alone cancels all SDK work. Nym likewise documents limits to cancellation of in-flight WASM transfers.
- Worker logs are consumed and discarded; only counts and fixed classifications are exported. No client IP, ICE candidate, wallet data, signature, key, order, or raw RPC body is saved. Public specifier addresses and gateway configuration are intentional metadata.
- Paired trusted-source observer comparison, protected balance/receipt reads, worker integrity-failure injection, production CSP, main-application integration, and independent bypass coverage remain **UNTESTED**. MN-007/MN-009/MN-012 own those later boundaries; this preflight does not replace them.

## Validation and next action

Exact combined live command on this workstation, before the runner was packaged as a template:

```sh
PATH=/tmp/monolith-node24/node-v24.22.2-linux-x64/bin:$PATH node apps/dashboard/src/spikes/anon/run.mjs
```

The current launcher was then validated with:

```sh
PATH=/tmp/monolith-node24/node-v24.22.2-linux-x64/bin:$PATH sh apps/dashboard/src/spikes/anon/run.sh nym
```

Result: exit **0**; isolated strict TypeScript check passed, direct interception self-check and real post-close rejection passed for both attempts, Nym returned the expected chain ID, and Tor stopped at its deadline. The isolated install reported zero known vulnerabilities. The experiment started at the planning baseline; the branch was then advanced to merged MN-001 (`8f8ea49`) before publishing. The SDK remains installed only in temporary environments. Formal MN-003 integration/acceptance still waits for MN-002.

The unchanged MN-001 baseline plus the isolated spike also passed `pnpm install --frozen-lockfile` and `pnpm check` using Node 24.22.2 / pnpm 12.18.0: lint, typecheck, 58 tests in 5 files, and production builds. These checks preserve the foundation while the standalone template receives its own strict TypeScript check; they do not satisfy the missing MN-002 dependency.

Additional checks: shell/runner syntax; report-local links/fences and whitespace; JSON observation invariants; published observations compared with original attempt records; and task path ownership. All passed before publishing the experiment draft.

**Handoff:** retain Nym as the observed working candidate. Keep MN-003 in backlog and the PR in draft while MN-002 is owned by its current session. After MN-002 merges, rebase this branch, adapt to the frozen public contracts and agreed dependency ownership, and run integrated checks plus a fresh live read before requesting formal review. No shared tooling changes are included in this experiment.

## Primary sources inspected

- [Official wallet guide](https://ethereum.github.io/anon-rpc/wallets/) and [worker directory](https://ethereum.github.io/anon-rpc/adopters/): documented specifiers/configuration and bootstrap trust.
- [Harness exports](https://github.com/ethereum/anon-rpc/blob/c8980fb1f89d712c91595863e6f53bd63f64c56d/impl/browser-harness/src/host/index.ts), [specifier/hash verification](https://github.com/ethereum/anon-rpc/blob/c8980fb1f89d712c91595863e6f53bd63f64c56d/impl/harness-core/src/specifier.ts), and [boot/close implementation](https://github.com/ethereum/anon-rpc/blob/c8980fb1f89d712c91595863e6f53bd63f64c56d/impl/browser-harness/src/host/AnonRpcWorker.ts).
- [Tor worker source](https://github.com/ethereum/tor-js/blob/d9d9612d10d3775ff100b70e96a291718191d856/src/anon-rpc-worker/worker.ts) and [Nym source/limits](https://github.com/nymtech/anon-rpc-worker/blob/4db7d4e6ae6e5961337ba401e9deda4ca396fb1e/README.md). Source revisions explain inspected behavior; they are not represented as independently reproduced builds of the on-chain bundles.
