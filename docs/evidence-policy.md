# Evidence export policy

The [MN-017 offline checkpoint](https://github.com/Dijo-404/monolith/issues/17#issuecomment-6692959668) adds local validation and packaging. It does not accept the core release. Actual MN-014 workflow evidence and the complete MN-016 walkthrough remain prerequisites. See [the release checklist](release-core.md), [shared contracts](contracts.md#verification-manifest) and [architecture](architecture.md#evidence-and-privacy-regressions).

## What a bundle says

An export preserves reviewed input bytes and their declared evidence labels. A matching hash establishes byte identity. A valid schema establishes a supported public shape. Neither establishes that a worker ran, that an observer saw a trusted network source, that a publisher is authorized, or that a release or sponsor submission qualifies.

| Label | Required meaning |
| --- | --- |
| `OBSERVED_LIVE` | An actual execution with retained source, time, scope and independently reviewable observations. The exporter cannot establish this from the label. |
| `SIMULATED` | Synthetic inputs, mocked ports or software tests. Temporary exports stay outside every directory named `evidence`. |
| `BLOCKED` | An attempted operation did not satisfy its gate. Retain the failure and its limits. |
| `UNTESTED` | The asserted integration or behavior has not been exercised. |

Recorded live evidence describes its observation time. It is not a present availability, freshness or anonymity guarantee. An expired recorded registry snapshot never authorizes a current RPC request. Keep failed attempts; do not relabel a previous failure after a configuration change or a later successful run.

## Accepted inputs

The tool consumes a plan with exactly two properties:

```text
{
  "manifest": <VerificationManifest from @monolith/shared>,
  "kinds": { "<artifact relative path>": "<supported kind>" }
}
```

The `kinds` keys must exactly match the manifest's unique artifact paths. Each artifact entry supplies its original-byte SHA-256, generation time, evidence label and `MN-xxx` source task. The manifest supplies a canonical lowercase synthetic `run-<UUIDv4>` identifier, generation time and evidence label. Generate a new random run identifier for each execution; never reuse a wallet, account, order or stable browser identifier.

Plans and artifacts must use canonical UTF-8 JSON: exactly `JSON.stringify(value, null, 2) + '\n'`. Duplicate-key spellings, alternate whitespace and alternate escape encodings are refused. Prepare and review the canonical public input before calculating its hash. The exporter does not rewrite bytes to make an input pass.

| Kind | Public validator | Content boundary |
| --- | --- | --- |
| `privacy-report` | `privacyReportSchema` | Measured counts, findings and declared scope; no RPC parameters or results. Its run ID must match the bundle. |
| `observer-run` | `observerRunSchema` | Coarse source classes, method and payload-presence booleans; no raw source address or request body. Its run ID must match the bundle. |
| `rpc-trace` | `rpcTraceSchema` | Route and attempt metadata; no wallet parameters or provider response. |
| `registry-manifest` | `registryManifestSchema` | Public discovery metadata, publisher/entity references and source provenance; no endpoint authorization is inferred. |

The exporter uses the public shared validators through the built `@monolith/shared` entry point. The local [TypeScript configuration](../scripts/tsconfig.evidence.json) resolves that existing public entry without changing workspace manifests or the lockfile.

Raw browser captures, importer journals, worker bundles, screenshots, arbitrary text, whole API wrappers and conditional settlement artifacts are outside this first exporter. Accepted historical evidence remains in its original task locations. A future reviewed projection can produce a supported public DTO, preserving its source links, truthful label and limitations; this tool neither performs nor authorizes that projection.

## Validation and file boundaries

The validator checks the entire plan and all selected files before export. It rejects malformed or extra fields, unsupported kinds, missing/duplicate paths, mismatched hashes, invalid identities and inconsistent timestamps or labels. The explicit `--now` clock must be canonical UTC ISO-8601. Artifacts cannot be dated after manifest generation, and manifest generation cannot be in the future relative to that clock. Every manifest, artifact and internal evidence label must agree, including `BLOCKED` and `UNTESTED`; a container cannot upgrade one of its inputs. An artifact's internal generation time, when present, must match its manifest entry.

Input limits are 64 artifacts, 1 MiB per artifact, 8 MiB across artifacts and 256 KiB for the plan. Artifacts must be `.json` files with safe relative paths under the input directory; `verification-manifest.json` is reserved for the generated bundle manifest. Symlinks in input paths, plan paths or checked output ancestors are refused. Input and output directories cannot overlap. The output parent must already exist, and output must be a new directory; an existing bundle is never overwritten. Files are copied from the validated in-memory byte snapshot, rather than reread after validation. Validation failure produces no exported bundle.

Export creates the final directory exclusively, writes the artifacts and writes `verification-manifest.json` last. A later I/O failure can leave a partial directory. Treat any output without that manifest as incomplete; no directory-wide atomicity is promised. The original plan is an operator input and is not automatically included in the output.

The limited sensitive-string checks supplement strict DTOs. They reject recognized raw IP/address/key and credential forms outside explicitly public registry identity/hash fields, and restrict public URLs. They do not identify every secret, encoded value, private fact or stable identifier that could fit a permitted string. Producers must use static labels and omit raw keys, IP logs, private wallet/order data, signatures, capabilities, cookies and private provider errors. The release reviewer checks all intended public bytes and the observations supporting their claims. That review is a task acceptance requirement; there is no CLI switch that certifies it happened.

Use input and output directories controlled by the operator, without concurrent writers. File checks and no-follow reads reduce accidental traversal and symlink exposure; the process is not a sandbox for a hostile user who can concurrently replace its filesystem ancestors.

## Commands

Use Node 24.22.2 and pnpm 12.18.0 from the repository's [engine configuration](../package.json). Build the shared public entry before running the tool:

```sh
pnpm install --frozen-lockfile --offline
pnpm --filter @monolith/shared build
```

The offline installation requires the pinned packages already in the local store. Do not remove `--offline` and describe the result as an offline check if the store is incomplete.

For an existing, operator-reviewed input directory and plan, validate without writing:

```sh
pnpm exec tsx --tsconfig scripts/tsconfig.evidence.json scripts/export-evidence.ts --verify --plan /path/to/plan.json --input /path/to/input --now 2026-11-07T00:00:00.000Z
```

Replace the example clock with the actual validation time. The example is command syntax, not a recorded execution. To export those same reviewed inputs into a new directory:

```sh
pnpm exec tsx --tsconfig scripts/tsconfig.evidence.json scripts/export-evidence.ts --export --plan /path/to/plan.json --input /path/to/input --now 2026-11-07T00:00:00.000Z --output /path/to/new-bundle
```

The exported manifest retains the original generation times and labels. Validation time does not renew an artifact's authority. The command does no network lookup, worker startup, RPC request, signature, deployment or publication. Failures expose fixed error codes rather than source paths, artifact contents, parser diagnostics or upstream messages.

Run the dedicated offline checks explicitly; the current root Vitest include pattern does not discover tests under `scripts/`:

```sh
pnpm exec tsc -p scripts/tsconfig.evidence.json
pnpm exec tsx --tsconfig scripts/tsconfig.evidence.json --test scripts/export-evidence.test.ts
pnpm check
```

The tests create synthetic files in temporary directories and exercise rejection and byte-preservation behavior. Passing them is software evidence labelled `SIMULATED`. No synthetic test bundle belongs under `evidence/**`.
