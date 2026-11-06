# Simulated contract fixtures

Every JSON case in this directory is **SIMULATED** test data for MN-002. No file is an observed worker result, Arkiv query, payment receipt, or production evidence. Reserved example domains, documentation IPs, repeated hashes and addresses are intentional synthetic values.

`manifest.json` lists the cases and fixes the evaluation clock at `2030-01-01T00:01:00Z`; expiry checks must use that supplied time rather than the machine clock. Each case wraps its payload with a fixture version, evidence label, description, contract name and expected result. A negative test may deliberately contain a false `OBSERVED_LIVE` claim inside its payload; its outer label remains `SIMULATED` and the parser must reject the claim.

Consume `payload` through the matching public `@monolith/shared` schema. `valid`/`invalid` describe structural validation. `UNSUPPORTED_VERSION` and `REGISTRY_EXPIRED` name expected boundary failures from `parseContract` or `validateRegistryManifest`. RPC error envelopes can be structurally valid while `validateRpcResponse` returns a sanitized `RPC_ERROR` failure.

The fixture-driven tests live in `packages/shared/test/contracts.test.ts` and run through `pnpm test`. They import the package's public exports, so build the shared package first when invoking a single test directly. `pnpm check` already performs that dependency build.

Keep fixtures here, never in `evidence/`. Add new cases to the catalog; the tests reject unlisted JSON files and missing simulation labels.
