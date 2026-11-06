# Monolith CLI and TUI

The prerelease `@monolith/cli` package provides local privacy-analysis commands,
sanitized report viewing and a terminal menu. Its `lab` command opens the existing
browser application. It does not run an anonymity worker in Node.

This package has not been published to npm. Its proposed package name and future
registry availability are unverified. MN-026 is tracked in [issue #50](https://github.com/Dijo-404/monolith/issues/50).

## Build and install a local tarball

Use Node **24.22.2** and pnpm **12.18.0**, matching the workspace. The supported
Node engine is `>=24.22.2 <25`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @monolith/cli... build
cli_scratch="$(mktemp -d)"
(cd packages/cli && npm pack --ignore-scripts --pack-destination "$cli_scratch")
mkdir -p "$cli_scratch/consumer"
npm install --prefix "$cli_scratch/consumer" --offline --ignore-scripts --no-audit --no-fund "$cli_scratch/monolith-cli-0.1.0.tgz"
"$cli_scratch/consumer/node_modules/.bin/monolith" --help
"$cli_scratch/consumer/node_modules/.bin/monolith" --version
```

The bundle includes the required public shared/analyzer code and runtime
dependencies; the installed executable does not load repository scripts,
workspace fixtures, browser SDKs or unpublished workspace packages. Package
source, test fixtures, `.env` files and dependency trees are outside the tarball's
declared file set. The tarball includes its license and dependency notices.

After an owner-approved npm release, the intended registry invocation is
`npx --package @monolith/cli monolith --help`. That registry command is a future
usage example, not evidence that a release exists.

## Commands

| Command | Behavior |
| --- | --- |
| `monolith --help` | Show commands and options. |
| `monolith --version` | Show the package version. |
| `monolith doctor [--json]` | Check local prerequisites without contacting a service. |
| `monolith check --input <file> [--json]` | Validate and analyze portable captured measurements, then return a CI exit code. |
| `monolith report <file> [--json]` | View a safe projection of a privacy report's counts, evidence label and known finding codes. |
| `monolith lab [--url <dashboard-url>] [--json]` | Ask the operating system to open the explicitly selected browser lab. |
| `monolith tui` | Start the keyboard-operated terminal menu. |

`MONOLITH_LAB_URL` optionally configures the browser lab; `lab --url` overrides it.
`doctor` validates this setting locally and makes no network request. `check` and
`report` read local files; neither command fetches missing data. Input is limited
to a regular UTF-8 JSON file of at most 1 MiB. `lab` requires an explicit HTTPS or
HTTP loopback dashboard URL. Credentials, whitespace, query strings and fragments
are rejected before a browser opener runs. A successful opener result means only that
the launch request completed: it does not establish page availability, worker
readiness, a protected read or accepted live evidence.

The TUI uses the same command handlers as the CLI. Use arrow keys or `j`/`k` to
move, Enter to choose, and `?` for help. File and URL prompts are local input.
Escape cancels a prompt; `q` exits the menu; Ctrl-C cancels the session. Terminal
raw mode and cursor visibility are restored on exit and errors. Piped input never
starts the TUI or waits for an answer: use the noninteractive commands in CI.

## Portable analysis input

`check` accepts one strict JSON object:

```json
{
  "schemaVersion": 1,
  "input": {
    "schemaVersion": 1,
    "runId": "synthetic-run-001",
    "evidence": "SIMULATED",
    "reads": [],
    "traces": [],
    "attempts": []
  },
  "scope": {
    "reportRunId": "public-run-001",
    "application": "example-app",
    "origins": [],
    "callsites": [],
    "scenarios": [],
    "bootstrapRules": [],
    "captureComplete": true
  }
}
```

This empty example deliberately **fails**: its protected coverage is `null`, and
there is no useful completed read. The full synthetic one-read example is
[simulated-pass.json](../tests/e2e/cli/fixtures/simulated-pass.json). To exercise it
from this checkout with an installed executable:

```sh
monolith check --input tests/e2e/cli/fixtures/simulated-pass.json --json
```

The nested values follow the public `AnalyzerInput` and `AnalyzerScope` contracts
in [the analyzer types](../packages/privacy-analyzer/src/types.ts), using shared
runtime validation. The supplied scope declares collector completeness, aliases,
origins and exact bootstrap exclusions. Treat scope and measurements as
unverified caller input. The CLI does not authenticate a collector, observe
browser traffic, check artifact hashes or prove that a claimed live run occurred.
Every machine-readable analysis/view result identifies this limit as
`inputTrust: "unverified-local-input"`.

`report` takes the shared `PrivacyReport` DTO described in
[contracts.md](contracts.md#analyzer-and-test-run-boundary). It validates shape and
count consistency, then displays a count-based projection. It does not echo
caller-supplied run/read IDs, messages, callsites, origins or scenario strings.
It does not verify artifact hashes, provenance or prior redaction. Use the
evidence-release process for those checks.

## CI output and exit codes

Use `--json` for a single JSON object on stdout, including command errors. JSON
mode leaves stderr empty; human-readable errors use stderr. The response includes
`schemaVersion`, `command`, `status` and either `data` or a fixed sanitized `error`.
Data may include evidence, eligible/protected/successful read counts, coverage,
known finding counts and the input-trust disclosure. Internal correlation IDs,
file paths and exception messages are not public output.

| Exit | Meaning |
| --- | --- |
| `0` | Command completed; for `check`, a nonempty run passed both privacy policy and useful-read acceptance. |
| `1` | `check` detected a policy violation, failed useful reads, incomplete evidence or an empty run. |
| `2` | Invalid arguments/input, unsupported configuration or an unavailable prerequisite prevented execution. |
| `130` | Interactive execution was cancelled with Ctrl-C. |

A passing synthetic fixture retains `SIMULATED`. `OBSERVED_LIVE`, `SIMULATED`,
`UNTESTED` and `BLOCKED` labels are never upgraded by installing or executing this
package. Blocking every read cannot satisfy functional acceptance, and zero
eligible reads cannot produce 100% coverage. Viewing a failed report exits `0`
because viewing completed; use `check` for a CI gate.

## Privacy boundary

Protected RPC reads and chain-ID probes run in the existing browser lab through a
real verified worker or fail closed. The terminal launcher sends no RPC reads,
offers no Node `fetch` fallback and treats a failed launch as unavailable.
Passthrough is not protected traffic; direct comparisons require explicit
consent in the browser. Worker bootstrap is separately disclosed as non-anonymous,
and an RPC endpoint can still read JSON-RPC payloads.

The CLI adds no telemetry, payment/signing operations, codemods, application
scaffolding or arbitrary-project scanner. Offline checks and terminal tests do not
accept [MN-014's live integration gate](https://github.com/Dijo-404/monolith/issues/14)
or replace the core release's evidence review.

## Validation and release checklist

Run the existing workspace checks and the standalone test explicitly:

```sh
pnpm check
pnpm exec vitest run tests/e2e/cli/portable.test.mjs
```

The portable test builds and packs the real package, installs it offline in a
fresh temporary consumer outside the checkout, invokes its installed executable,
checks JSON/error/exit behavior and exercises real-terminal Ctrl-C restoration on
POSIX. Its measurements are synthetic, and its browser-launch checks establish
no network privacy claim.

Before an npm release, the owner should review the exact source commit/version,
standalone install results, tarball file list, bundled dependency notices and
documented privacy limits; confirm ownership/availability of the package name;
and select the intended registry/access policy. Publishing is a separate owner
action. A prepared tarball is not a published release or accepted live evidence.
