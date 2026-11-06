# MN-007: published Nym redirect and DNS source audit

6 November 2026. Read-only source inspection; no protected network run, redirect server test, source edit, or build was performed by this audit.

## Result

The published Nym worker does not provide reliable per-request redirect refusal through `RequestInit.redirect`. Its supported tunnel configuration can instead set a zero redirect budget before worker initialization. Pin `config: { maxRedirects: 0 }` in the production Nym composition, with no caller override. Retain `redirect: 'error'` for compatible future workers. This is a source-backed guard, not a claim that a live redirect control passed.

The ordinary post-response `Response.url` check cannot repair the old behavior: the published mix-fetch facade creates a fresh `Response` from body/status/headers and omits URL metadata. The Nym wrapper consequently exports an absent URL. A redirected payload could already have reached a different destination before that check.

## Exact artifact identity

Downloaded only the public versioned source artifacts into `/tmp/monolith-mn007-nym-published-audit/`:

| Artifact | Identity |
| --- | --- |
| [Nym worker 0.1.0](https://cdn.jsdelivr.net/npm/@nymproject/anon-rpc-worker@0.1.0/dist/nym-anon-rpc-worker.js) | 18,283,862 bytes; Keccak-256 `0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8`, matching the captured MN-003/MN-007 bootstrap hash |
| Embedded tunnel worker in that bundle | 13,600,839 bytes; SHA-256 `da0ffd9ccf39a04e94befa353afab18f90394974778f89aef5effcba086b8bc8` |
| [Published mix-tunnel 0.3.0](https://cdn.jsdelivr.net/npm/@nymproject/mix-tunnel@0.3.0/dist/esm/index.js) embedded worker | Byte-identical to the preceding embedded worker, with the same SHA-256 |
| Extracted embedded WASM | 10,103,627 bytes; SHA-256 `45fcda44f0af0b0c415f97bb5476480229070c8964f96bf2aed986a494c0b88d` |

The exact embedded WASM contains the `maxRedirects`, `dohEndpoints`, and `dnsTimeoutMs` setup names and the redirect-budget exhaustion error. It contains none of the newer redirect-mode error text. This audit did not rebuild or disassemble the WASM.

## Primary source chain and zero-hop reasoning

- The [worker's pinned dependency](https://github.com/nymtech/anon-rpc-worker/blob/4db7d4e6ae6e5961337ba401e9deda4ca396fb1e/package.json) is mix-fetch 3.0.0; its lockfile selects mix-tunnel 0.3.0. The downloaded worker embeds that published tunnel worker byte-for-byte.
- The [release commit](https://github.com/nymtech/nym/commit/67dafa9a05d2d8c27c9ecb9f9cd42ba7ecf8c192) bumps those packages to these versions. The [published 0.3.0 types](https://cdn.jsdelivr.net/npm/@nymproject/mix-tunnel@0.3.0/dist/esm/types.d.ts) expose `maxRedirects`.
- Nym's [configuration and fetch adapter](https://github.com/nymtech/anon-rpc-worker/blob/4db7d4e6ae6e5961337ba401e9deda4ca396fb1e/src/nym-anon-client.ts) takes the harness-supplied config in preference to stored settings, copies its fields, and passes them into tunnel setup. It forwards a request's redirect setting to mix-fetch, which does not establish that the lower layer honors it.
- The release's [setup decoder](https://github.com/nymtech/nym/blob/67dafa9a05d2d8c27c9ecb9f9cd42ba7ecf8c192/wasm/smolmix/src/lib.rs) accepts an optional unsigned-byte redirect budget; a supplied zero reaches the builder. The [builder](https://github.com/nymtech/nym/blob/67dafa9a05d2d8c27c9ecb9f9cd42ba7ecf8c192/wasm/smolmix/src/tunnel.rs) uses the supplied value rather than replacing zero with its default of five.
- The release's [fetch orchestration](https://github.com/nymtech/nym/blob/67dafa9a05d2d8c27c9ecb9f9cd42ba7ecf8c192/wasm/smolmix/src/fetch.rs) iterates from zero through that budget inclusively. At zero it permits the initial destination request. After a redirect response it can parse the next URL, but no second iteration can connect or send a payload; the function returns a budget-exhaustion error. No redirect hop is sent.
- [Official PR #7360](https://github.com/nymtech/nym/pull/7360), open and unmerged during this audit, adds actual `error`/`manual` redirect-mode handling. Before that change both settings are ignored by the lower fetch parser. Changing to `manual` alone is therefore not a safe fix.
- The [published mix-fetch 3.0.0 facade](https://cdn.jsdelivr.net/npm/@nymproject/mix-fetch@3.0.0/dist/index.js) rebuilds a native response without URL or redirect metadata, confirming why a later URL check alone is insufficient.

## Separate inference about the repeated 24-second failure

The release's [DNS path](https://github.com/nymtech/nym/blob/67dafa9a05d2d8c27c9ecb9f9cd42ba7ecf8c192/wasm/smolmix/src/dns.rs) tries three DoH endpoints serially: Quad9 `9.9.9.9`, Cloudflare `1.1.1.1`, then Google `8.8.8.8`, all through the mixnet. Each complete endpoint attempt has the default eight-second DNS budget. Three timeouts therefore fit the observed approximately 24-second package probe failure. This timing match is an inference; the actual typed failure cause was not captured.

The Nym worker still inserts legacy `primaryDns`/`fallbackDns` settings. These are absent from the release setup schema and exact WASM strings; the supported knobs are `dohEndpoints` and `dnsTimeoutMs`. A bounded follow-up could change only the DNS timeout or select one existing configured DoH endpoint to distinguish a timeout pattern. Such a diagnostic remains untested, must retain the zero redirect budget, and must keep DNS inside the worker. It would not justify an ordinary direct fallback or a successful-read claim.
