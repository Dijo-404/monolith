# Synthetic analyzer fixtures

Every record and exported report here is **SIMULATED**. The values model a useful pair of reads with an injected direct bypass, followed by a repair that preserves both useful operations. No worker, observer or live network ran to produce these inputs. Executing the analyzer demonstrates software accounting and export behavior only.

`leak-repair.json` contains the strict run inputs, trusted scope configuration and independent expected counts. The leak case is `(eligible=2, protected=1, successful=2, coverage=0.5)`. The repaired case is `(2,2,2,1)`. `leak.report-simulated.json` and `repair.report-simulated.json` are the package's actual serialized outputs for those synthetic inputs.

Run these commands from the repository root using its pinned Node/pnpm toolchain:

```sh
pnpm --filter @monolith/shared build
pnpm --filter @monolith/privacy-analyzer build
node packages/privacy-analyzer/test/export-fixtures.mjs
pnpm exec vitest run packages/privacy-analyzer/test/analyzer.test.ts
pnpm exec tsc -p packages/privacy-analyzer/test/tsconfig.json --noEmit
```

The full workspace check is `pnpm check`. The dedicated analyzer test typecheck above also checks the public input consumers in this task's test directory.

The package accepts `analyzePrivacyRun(input, scope)` and `exportPrivacyReport(input, scope)`. Both return the shared safe `Result` type. Input is a versioned run with declared logical reads, shared `RpcTrace` records and normalized measured attempts. Scope is separate trusted composition configuration: the application, approved origin/callsite/scenario catalogs, narrow bootstrap bindings and a fresh synthetic public report ID. Do not populate catalogs or public report IDs from request payloads, provider errors, customer orders or stable sessions.

A collector establishes the exact `(readId, attempt)` binding when it creates the request. It supplies a unique `eventId` for each actual send and retains that ID for duplicate delivery of the same event. It must never infer bindings from matching methods, bodies, source classes or timing proximity. The observer's `rpcId` needs an explicit run-local mapping to the transport binding before normalization. This package does no network I/O and does not authenticate a caller's route or `workerVerified` claim. A source difference by itself is never worker verification.

The denominator is the union of declared logical reads, additional traced reads and distinct unbound measured requests. Retries sharing a logical binding count once. Exact duplicate delivery is idempotent; conflicting event/trace identities are rejected with a fixed error. Distinct sends sharing one attempt binding are reported and earn no protection. A missing trace, missing measurement, gap in attempts or incomplete capture withholds affected protection credit. Unknown/unbound traffic stays visible. Declaring capture complete is a runner assertion about the named origins, not a claim about all browser traffic.

A protected timeout may earn route credit while failing functional completion. Blocked reads earn none; direct comparisons and passthrough never earn protection. A later worker retry cannot erase an earlier direct send. Completion and comparable latency are returned beside the frozen shared report, under `summary`. Latency groups use only normalized sent-attempt durations with matching endpoint, chain, method and route. Percentiles use nearest rank and include a sample count; they do not measure retry backoff or whole-operation latency.

Bootstrap exclusion requires the runner to have matched the exact approved specifier contract, selector and parameter allowlist before constructing a scope rule. The analyzer additionally requires the declared binding, method, endpoint, chain, callsite and origin to agree. An application read cannot be excluded by setting a bootstrap flag, and a chain-ID probe remains eligible.

All trace/attempt evidence labels must equal the run label. Simulated input cannot be relabeled live. `UNTESTED` and `BLOCKED` inputs cannot claim successful traces or completed measurements; those contradictions are rejected. An honest failed `UNTESTED` run remains unresolved, and `BLOCKED` remains a failure. `SIMULATED` may model success while retaining its visible label; `OBSERVED_LIVE` can record an actual success or failure. These labels and measurements remain caller assertions. Actual Anon-RPC execution and paired observer proof belong to their live acceptance tasks.

Exports contain fixed finding messages, approved public catalog values and report-local aliases for measured read/endpoint IDs. The private input run ID, read IDs, event IDs and endpoint IDs are not copied. Invalid inputs return only the finite shared error vocabulary. Schema validation is not semantic redaction: production composition still owns its static labels, public origin catalog and fresh synthetic public report ID.
