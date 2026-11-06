# MN012 browser acceptance record

All artifacts here are **SIMULATED software regression evidence**. Chromium actually executed the fixture and the CDP collector actually observed its ordinary HTTP requests, but the driver/results are test-controlled. There is no real anonymity worker, onchain result or payment in this test.

On 6 November 2026, the pinned Node 24.22.2 / pnpm 12.18.0 workspace passed `pnpm install --frozen-lockfile` and `pnpm check`: **1,188 tests in 31 files**, lint, all public/package/app types and production builds. The additional strict fixture check `pnpm exec tsc -p tests/privacy/egress/tsconfig.json` passed. `pnpm exec tsx scripts/check-rpc-egress.ts` passed all 32 actual browser source files. There are 23 new deterministic policy regressions.

The following commands used the existing isolated Playwright 1.65.0 installation at `/tmp/monolith-mn003-env` and generated new immutable output paths. Replace that path for reproduction; keep output names new to preserve earlier observations.

```sh
MONOLITH_BROWSER_TOOLS=/tmp/monolith-mn003-env \
  node tests/e2e/privacy/run.mjs --case leak --output /tmp/new-leak.json
MONOLITH_BROWSER_TOOLS=/tmp/monolith-mn003-env \
  node tests/e2e/privacy/run.mjs --case fixed --output /tmp/new-fixed.json
MONOLITH_BROWSER_TOOLS=/tmp/monolith-mn003-env \
  node tests/e2e/privacy/run.mjs --output /tmp/new-matrix.json
```

Observed command outcomes:

| Command | Exit | Policy result |
| --- | --- | --- |
| `--case leak` | **1**, expected | Functional balance/receipt operations still succeed; captured `eth_getTransactionReceipt` bypass at actual `leak-widget.ts:3:25`, seed `mn012-regression-001`; privacy gate fails |
| `--case fixed` | **0** | Same seed and useful operations, three of three eligible reads protected in the fixture, zero unexpected direct requests |
| Default matrix | **0** | All eight positive/negative expectations hold; this does not turn deliberately failing policy cases into passes |

The [matrix](recorded-simulated/matrix-2026-11-06.json), [failing leak](recorded-simulated/leak-2026-11-06.json) and [passing fixed](recorded-simulated/fixed-2026-11-06.json) records include their actual UTC timestamps, public analyzer reports, independent network classifications and hashes for 88 source/compiled/runtime inputs. Each run verified those input bytes remained unchanged; final independent verification matched each current input hash to each artifact.

Matrix coverage:

- **Leak:** actual direct receipt fetch fails privacy while useful reads work.
- **Fixed:** the public transport completes balance/receipt and protected chain probe; no direct application request.
- **Retry:** a controlled first-attempt timeout retries the same protected route and succeeds, without direct fallback.
- **Outage:** all managed reads block and no direct fallback appears. Functional acceptance and the complete gate fail.
- **Block-all:** a privacy-clean but nonfunctional balance read fails the complete gate.
- **Unexplained:** an undeclared block read is captured without a trace and expands the denominator from three to four.
- **Missing trace:** the independent fixture-port measurement remains; protection is withheld and the gate fails.
- **Direct control:** a separate exact one-send capability permits a direct negative control; it stays eligible with zero protected credit, yielding 3/4 coverage.

The [capture/static policy](../../privacy/egress/README.md) documents exact exemptions, failure semantics and interception limits. The [fixture](../../fixtures/leak-widget/README.md) explains the software port and authored data. No root manifest/lockfile, shared DTO, UI source or production adapter was edited. The new workflow tests these boundaries using isolated browser tools; package installation is a setup operation, and the actual fixture run makes no external RPC request.

MN009's actual source proof, MN014's live dashboard and MN017's final release remain separate acceptance requirements.
