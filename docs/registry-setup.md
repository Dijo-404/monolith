# Reproduce the public Arkiv registry query

The [independent CLI](../scripts/registry-query-example.ts) queries the public
Arkiv Rabdi node through the public `@monolith/registry/reader` export. It needs
no Monolith backend, dashboard, signing key, test tokens or running observer.
This is an ordinary direct metadata request: the Arkiv node sees the caller's
connection and public chain filter. It does not query a user's wallet or contact
the discovered RPC destination.

Use Node **24.22.2** and pnpm **12.18.0**, as pinned in
[package.json](../package.json). From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @monolith/shared build
pnpm --filter @monolith/registry build
pnpm exec tsx scripts/registry-query-example.ts --help
env -u DEBUG -u ARKIV_PUBLISHER_KEY_FILE -u ARKIV_PUBLISHER_PRIVATE_KEY \
  pnpm exec tsx scripts/registry-query-example.ts --chain-id 10 \
  > /tmp/monolith-independent-registry-query.json
```

The explicit `pnpm exec tsx` command uses the existing foundation dependencies.
There is no `registry:query` package script. No manifest or lockfile change is
needed. `--chain-id` is required; only canonical decimal IDs in the accepted
100-network subset are allowed. For example, `10` selects OP Mainnet. Duplicate,
unknown, URL, wallet and signing flags are rejected before network activity.
`DEBUG` must be unset to prevent SDK debug output. The pinned SDK may print a
public-endpoint rate-limit notice on stderr; successful stdout is JSON only.

Exit **0** means a fresh matching public storage observation; **1** means blocked
storage/trust/expiry or changed references; **2** means invalid input. Failures
emit a fixed `BLOCKED` JSON error on stderr. Provider exceptions and raw network
diagnostics are never copied into the report. An unavailable/expired deployment
does not fall back to a saved result. Each chain query has a 20-second reader
deadline, 5-second SDK requests with no automatic retries, and bounded cursor
pages/rows/block drift. A failed query should be rerun explicitly after checking
service availability; do not replace it with the sample below.

## Trust configuration and expiry

The example intentionally pins the accepted MN-008 import. It verifies SHA-256
of the import manifest, selected-record file, source catalog and retained MIT
notice before creating a client. These local files supply **trust references**;
returned entities always come from a new Arkiv query. No local record is returned
on an outage. Publisher and source configuration are public:

| Configuration | Accepted value |
| --- | --- |
| Storage network | Rabdi, chain ID `7794095` |
| Public storage RPC | `https://rpc.rabdi.db-chain.testnet.arkiv.network` |
| Creator and owner | `0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4` |
| Dataset | `https://github.com/ethereum-lists/chains` |
| Immutable source revision | `e17474286275730fb6b0490b1d7ea1c64a36ed9e` |
| Source catalog SHA-256 | `2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952` |
| MIT notice SHA-256 | `1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685` |

The SDK reader verifies the production schema, creator **and** owner, complete
typed fields and readonly flags. The CLI additionally compares every returned
record field, entity key and expiry against the hash-pinned accepted import.
Missing, extra, duplicate, modified and simulated rows are rejected. It checks
current engine block height and the publisher's separate UTC content deadline
after the read, rejecting equality at either expiry boundary. A schema name or
matching source commit alone never establishes trust.

The accepted rows expire by UTC content deadline between
**2026-11-07T13:42:00.547Z** and **2026-11-07T13:43:58.245Z**, and independently
at engine block heights **336579–336637**. Block heights are not Unix timestamps.
Reproduction after expiry requires a separately reviewed fresh import and
explicitly updated reference files/pins. This CLI never refreshes, writes,
discovers a new publisher or expands trust automatically.

The script returns storage metadata with `endpointValidation: UNTESTED`.
It performs no candidate DNS admission, health request, protected `eth_chainId`
probe or anonymity test. It does not re-fetch the upstream Git source at query
time. The endpoint URL remains a discovery candidate, with `status: candidate`
and empty `measured_chain_id`. Required-privacy browser reads must use the
separate deployment origin policy and verified worker. Do not feed this JSON
directly into a routing fallback.

## Reproduce source and import accounting

The [accepted importer guide](../packages/registry/test/importer/README.md)
contains actual import, zero-write rerun, receipt and key-free readback evidence,
plus the protected operator-only write procedure. To independently inspect the
same source without a signing key:

```sh
git clone https://github.com/ethereum-lists/chains.git /tmp/monolith-chains-source
git -C /tmp/monolith-chains-source checkout --detach e17474286275730fb6b0490b1d7ea1c64a36ed9e
env -u DEBUG pnpm registry:import preview \
  --source /tmp/monolith-chains-source \
  --revision e17474286275730fb6b0490b1d7ea1c64a36ed9e \
  --max-networks 100 --out /tmp/monolith-source-preview-new
```

Use a fresh output directory; the importer does not overwrite prior artifacts.
The preview validates selected Git bytes and licensing, but makes no Arkiv write
and does not prove a live query. This task's independent CLI does not require
that clone; its public trust anchors are already checked into the repository.

The accepted import published **100 distinct network records in 10 transactions**,
then reused all 100 with zero writes. The initial 10-record write and subsequent
90-record extension are separate commands; the extension's manifest records
90 writes, 10 reuses and 9 transactions. The source contains 2,855 networks and
4,220 RPC entries, of which 2,942 were admitted as metadata, 1,277 rejected and
one deduplicated. These are recorded importer counts, not the number of rows
returned by a single chain-10 query. See [data quality](../arkiv/data-quality.md)
for exact accounting and limits.

The upstream [immutable MIT license](https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/LICENSE)
and [retained notice](../packages/registry/src/adapters/source/LICENSE.ethereum-lists-chains)
apply to the mirrored dataset; [Monolith's MIT license](../LICENSE) covers the
project. An RPC URL's inclusion is not permission to disregard that provider's
terms. No separately curated Whitechain documentation was imported here.

## Evidence documents and the public API

The five Arkiv documents describe the
[production schema](../arkiv/schema.md),
[observed SDK friction](../arkiv/friction.md),
[demonstrated reach](../arkiv/reach.md),
[reason for using Arkiv](../arkiv/why-arkiv.md) and
[actual data quality](../arkiv/data-quality.md).

The separate [registry API guide](../packages/registry/test/reader/README.md)
documents `MONOLITH_REGISTRY_CONFIG`, explicit allowed origins and
`GET /api/registry/chains?chainId=10`. That API performs current DNS admission
and publishes a short-lived discovery manifest. It is disabled by default and
is not a dependency of this CLI. Neither API nor CLI expands the observer's
operator-controlled upstream map. No external adoption, production deployment
or sponsor acceptance is established by this example.

## Validation

```sh
pnpm check
pnpm exec eslint scripts/registry-query-example.ts --max-warnings 0
pnpm exec tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --module NodeNext --moduleResolution NodeNext --target ES2023 --types node \
  --skipLibCheck scripts/registry-query-example.ts
pnpm exec tsx scripts/registry-query-example.ts --self-test
```

On the task branch based on accepted main `88add0f`, the frozen install and
`pnpm check` passed: **917 tests in 23 files**, lint, public-package type checks
and production builds. The separate strict CLI TypeScript and ESLint commands
passed after the final CLI edits. `--self-test` passed **23** offline CLI
trust/projection checks with **zero network calls**. Its synthetic fixed-clock
fixtures exercise the acceptance branch, but its output is explicitly
`SIMULATED`; they are not live Arkiv or privacy proof. Independent read-only
review also passed **39** adversarial verifier checks and **9** executable
argument/debug checks, all offline. These additional one-off reviewer checks
are distinct from the committed, reproducible 23-case self-test.

```json
{"schemaVersion":1,"sourceTask":"MN-015","evidence":"SIMULATED","passed":23,"networkCalls":0}
```

## Actual independent consumer observation

The final-source query ran **2026-11-06T15:32:32.290Z–15:32:33.862Z**, returning
one OP Mainnet entity at Arkiv block **296692**. It used a fresh process with
only public `PATH` environment, Node **24.22.2**, no backend/dashboard process,
and no signing environment. The separate guard below recorded exactly five
requests, all to the fixed public Rabdi RPC: two `eth_chainId`, two
`eth_blockNumber` and one `arkiv_query`. These chain/block methods inspect the
**Arkiv storage chain**, not the discovered OP RPC. No Monolith API or candidate
RPC request occurred at this process's global fetch boundary. This scoped
observation does not audit arbitrary other host traffic or native network APIs.

The stdout SHA-256, including final LF, is
`65b5311bdb8691e74386a4c98de6bc18c423a40ed536f338fe81c78215331edc`. The full recorded stdout follows unchanged.
It is **historical evidence at this timestamp**, not current route authority.

<details>
<summary>Actual CLI stdout JSON</summary>

```json
{
  "schemaVersion": 1,
  "evidence": "OBSERVED_LIVE",
  "sourceTask": "MN-015",
  "operation": "independent-public-storage-query",
  "startedAt": "2026-11-06T15:32:32.290Z",
  "completedAt": "2026-11-06T15:32:33.862Z",
  "network": {
    "name": "Arkiv Rabdi",
    "chainId": "7794095",
    "rpcUrl": "https://rpc.rabdi.db-chain.testnet.arkiv.network"
  },
  "query": {
    "chainId": "10",
    "creator": "0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4",
    "owner": "0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4",
    "sourceRevision": "e17474286275730fb6b0490b1d7ea1c64a36ed9e",
    "snapshotSha256": "2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952"
  },
  "references": {
    "hashes": {
      "import-full100.json": "38728e8d02c845ab545b0bf83e450b04256bda5bb00b49cf09cb7e080cc85bb6",
      "selected-records.json": "4fed832c98adfe2f30d43e84cc69042656a7a0d63ae527bdb7c6a382f204ffeb",
      "source-catalog.json": "2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952",
      "LICENSE.ethereum-lists-chains": "1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685"
    },
    "source": {
      "repository": "https://github.com/ethereum-lists/chains",
      "revision": "e17474286275730fb6b0490b1d7ea1c64a36ed9e",
      "snapshotSha256": "2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952",
      "retrievedAt": "2026-11-06T13:41:58.596Z",
      "licenseUrl": "https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/LICENSE",
      "licenseSha256": "1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685"
    },
    "acceptedSelectedNetworks": 100,
    "acceptedSelectedRecords": 100
  },
  "observedAt": "2026-11-06T15:32:33.862Z",
  "blockNumber": "296692",
  "found": 1,
  "entities": [
    {
      "entityKey": "0xc8d33bed907f23f9cddcf19fb151318dbe7758c5880a6378e8f6a50826010f07",
      "creator": "0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4",
      "owner": "0x93D1A42655F2B0BCFa126e3D2a33e4ab60a74CA4",
      "readonly": true,
      "permissionlessExtension": false,
      "expiresAtBlock": "336579",
      "contentExpiresAt": "2026-11-07T13:42:00.547Z",
      "record": {
        "record_id": "6f661b1c6c9d0ee9f7b37c559a2285dd470a19f3378d7d610b8ec823f197a130",
        "chain_id": "10",
        "chain_name": "OP Mainnet",
        "rpc_host": "https://mainnet.optimism.io/",
        "network_type": "evm",
        "status": "candidate",
        "source_url": "https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/_data/chains/eip155-10.json",
        "source_commit": "e17474286275730fb6b0490b1d7ea1c64a36ed9e",
        "source_license": "https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/LICENSE",
        "license_sha256": "1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685",
        "snapshot_sha256": "2180efb0c0b38e76578ebd8d6470d1acbabb7f90463dd4134e7c6d90a692c952",
        "measured_chain_id": "",
        "importer_version": "monolith-import-v1",
        "observed_at": "2026-11-06T13:41:58.596Z"
      }
    }
  ],
  "independence": {
    "monolithApiUsed": false,
    "dashboardCacheUsed": false,
    "signingKeyUsed": false,
    "candidateRpcContacted": false
  },
  "endpointValidation": "UNTESTED",
  "limits": "Public storage discovery only. The Arkiv node sees this direct metadata query. Source strings are publisher metadata; this command does not re-fetch upstream Git. No DNS admission, endpoint health, protected chain probe, anonymity or sponsor eligibility is established. No stale fallback; expired or unavailable records fail."
}
```

</details>

To reproduce the guarded invocation, save the following temporary guard as
`/tmp/monolith-mn015-live-guard-final.mjs`, choose a fresh output path in its
exclusive-create write, and run from the built workspace:

```sh
env -i PATH="$PATH" node --import /tmp/monolith-mn015-live-guard-final.mjs \
  --import tsx scripts/registry-query-example.ts --chain-id 10 \
  > /tmp/monolith-independent-registry-query-new.json
```

This invokes the same CLI directly under Node; the ordinary `pnpm exec tsx`
command above needs no guard. The guard adds no SDK/signing API and records
method names only. It denies every other fetch destination/method and disables
redirects; it never stores request parameters, raw headers or source addresses.
Its SHA-256 is `02cdbddc3fbfb0b757ea3e0c9465ffe0cfd0e524beb4114f4ee36f7ec2d34db5`.

<details>
<summary>Executed fetch guard and observed request summary</summary>

```js
import { writeFileSync } from 'node:fs';
const allowed = 'https://rpc.rabdi.db-chain.testnet.arkiv.network/';
const observations = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const request = new Request(input, init);
  if (request.url !== allowed || request.method !== 'POST') throw new Error('Unexpected metadata network destination.');
  const body = await request.clone().json();
  const methods = (Array.isArray(body) ? body : [body]).map(item => item.method);
  if (!methods.length || methods.some(method => !['eth_chainId', 'eth_blockNumber', 'arkiv_query'].includes(method))) throw new Error('Unexpected metadata method.');
  observations.push({ destination: allowed, methods });
  return originalFetch(new Request(request, { redirect: 'error', credentials: 'omit' }));
};
process.on('exit', () => writeFileSync('/tmp/monolith-mn015-network-final.json', JSON.stringify({
  evidence: 'OBSERVED_LIVE', scope: 'Process-global fetch boundary in this fresh CLI process; fixed public Rabdi destination only; redirects disabled',
  observations, requestCount: observations.length, monolithApiRequests: 0, candidateRpcRequests: 0
}, null, 2) + '\n', { flag: 'wx' }));
```

```json
{
  "evidence": "OBSERVED_LIVE",
  "scope": "Process-global fetch boundary in this fresh CLI process; fixed public Rabdi destination only; redirects disabled",
  "observations": [
    {
      "destination": "https://rpc.rabdi.db-chain.testnet.arkiv.network/",
      "methods": [
        "eth_chainId"
      ]
    },
    {
      "destination": "https://rpc.rabdi.db-chain.testnet.arkiv.network/",
      "methods": [
        "eth_blockNumber"
      ]
    },
    {
      "destination": "https://rpc.rabdi.db-chain.testnet.arkiv.network/",
      "methods": [
        "arkiv_query"
      ]
    },
    {
      "destination": "https://rpc.rabdi.db-chain.testnet.arkiv.network/",
      "methods": [
        "eth_chainId"
      ]
    },
    {
      "destination": "https://rpc.rabdi.db-chain.testnet.arkiv.network/",
      "methods": [
        "eth_blockNumber"
      ]
    }
  ],
  "requestCount": 5,
  "monolithApiRequests": 0,
  "candidateRpcRequests": 0
}
```

</details>

All **77** source/build/manifest/lock inputs below were hashed before and after
that successful process and matched byte-for-byte. They bind the actual CLI,
registry/shared source and compiled exports to this observation. Third-party
versions/integrities are pinned by the unchanged lockfile. These checks bind
local execution inputs; they do not independently verify the public node's
responses with cryptographic proofs or re-fetch the upstream Git catalog.

<details>
<summary>Recorded execution command and input hashes</summary>

```json
{
  "evidence": "OBSERVED_LIVE",
  "sourceTask": "MN-015",
  "command": [
    "node",
    "--import",
    "/tmp/monolith-mn015-live-guard-final.mjs",
    "--import",
    "tsx",
    "scripts/registry-query-example.ts",
    "--chain-id",
    "10"
  ],
  "nodeVersion": "v24.22.2",
  "sourceAndBuildUnchanged": true,
  "sha256": {
    "package.json": "c158c7ef05c9156de189606cf1a5c4a748ccfdba2c72409c6b8f985c92c74023",
    "packages/registry/dist/adapters/arkiv/reader.d.ts": "bd8dc12e15e35a252fbbc813449e13263231375884a188c8142d047a57f213db",
    "packages/registry/dist/adapters/arkiv/reader.js": "0244f290fe6f478e46f666e60545b42cefb1ba6cc5abb3f13a8aa098ddac30eb",
    "packages/registry/dist/adapters/arkiv/schema.d.ts": "17f1858d989adf01b7c7b4cc7b860e4b77d0c0b2e0e7b5ee8f5bbab918024bee",
    "packages/registry/dist/adapters/arkiv/schema.js": "c8553e55cd25390c4386392616bd56a2b12f8a1362d1cf5e00164daf9100f25d",
    "packages/registry/dist/adapters/arkiv/writer.d.ts": "3a1df4e5ce483728201e1fc66b736505c25cf7513f14481e7031ca5a386f0e8f",
    "packages/registry/dist/adapters/arkiv/writer.js": "629335c396e3327f37a7154ba04fb09bcea2006b3dc2dc237229f775370e6e0f",
    "packages/registry/dist/adapters/source/git-snapshot.d.ts": "9a4573ce6a47db668f0247267c98060955f41c9b2f31429c71e7c9e46dab7a61",
    "packages/registry/dist/adapters/source/git-snapshot.js": "bcaac54c9408e3e61d034be73c23cd675f80b0bb8f2ec184c975e1c98bc932cd",
    "packages/registry/dist/application/import-registry.d.ts": "971899b5ae35fb0159463d491d91f3afd804b63627a05bed628d3ac742c0f0eb",
    "packages/registry/dist/application/import-registry.js": "524bf905e85c80b92e905a0dd35a8d99f424eb7aeff46e60bacec5822e90ed3c",
    "packages/registry/dist/application/query-registry.d.ts": "c47affacbb00051e279eabd10840a0389dcc1f383df06805a255c7176bb3d271",
    "packages/registry/dist/application/query-registry.js": "88919d56525c158b6af840d5190f601dccdc6073035c05256880a8513a1e98e0",
    "packages/registry/dist/domain/endpoint-policy.d.ts": "2cbd0cd50f7c4cf917391aa53373de161e5429eefac5505bfa22a2da1d01917c",
    "packages/registry/dist/domain/endpoint-policy.js": "57e820b1e916d6ec5f64765218123969a0015a183063b7ad58923f97f07c9413",
    "packages/registry/dist/domain/freshness.d.ts": "4a4accea41dfcb7087428d9d61a81704cc156055a20336eda71f41b6d54d7bc2",
    "packages/registry/dist/domain/freshness.js": "46006e40ffad003b34c1137a8414b9720c0b0fb6d50323991a1285b496da04ce",
    "packages/registry/dist/domain/publisher-policy.d.ts": "55de4cc6fd9daf801a912d42f1e9a6c0308d90ccdeb706aba556af885d409d0c",
    "packages/registry/dist/domain/publisher-policy.js": "9e726086c8ca1e42effdc09ba812cd9761b53840a608fa03bd9861a99e08c9cd",
    "packages/registry/dist/domain/source-policy.d.ts": "615cd5bdf962c3507441a2fa0b0011ab5e193bb65b749fcfb60041c9b51a1255",
    "packages/registry/dist/domain/source-policy.js": "82cfbf66a2c5ce5957fbbc3ba79d326a27502a0ba0f50134598e44835dbdf2e7",
    "packages/registry/dist/index.d.ts": "416d8f7aed428f9ef73246be9cffb3b47f8514343b0a0e7cd9b60410176dc10d",
    "packages/registry/dist/index.js": "8e12012506b77ebb5b68f44afd7e16fe82ea3967cea1fab44263789454306a23",
    "packages/registry/dist/ports/entity-reader.d.ts": "30c33751a7fc6126ad1ceafee743414762ee228a0337f203743b69f899e50e27",
    "packages/registry/dist/ports/entity-reader.js": "8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881",
    "packages/registry/dist/ports/entity-writer.d.ts": "30a2dbbda7cd6cb013dd4fd0019a213f7755e76a2710aa12cc28db1ae52cdf0b",
    "packages/registry/dist/ports/entity-writer.js": "8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881",
    "packages/registry/dist/ports/source-snapshot.d.ts": "b14af61d49a34eb79e0b223dbc660f96b2d68d3636c57800b2f83e3f168e046a",
    "packages/registry/dist/ports/source-snapshot.js": "8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881",
    "packages/registry/package.json": "54872e0473eb1173f141e14e2ec92bd40c843b61bde719960bd1ef4449d9ef4b",
    "packages/registry/src/adapters/arkiv/reader.ts": "7223cc90aca68ac78f7f846d545eb83cd5d68007007909b89419a0de8549f487",
    "packages/registry/src/adapters/arkiv/schema.ts": "c30d5efff75c03a9434c5a5e96919c78727ec9631360094d11187978e11a39f6",
    "packages/registry/src/adapters/arkiv/writer.ts": "5944186cb3355d960cf2e8664623e881d856c63d62b5b739c5fb7f0079c0f4c6",
    "packages/registry/src/adapters/source/git-snapshot.ts": "4acaadc371151ef9499969a38ed21023d3e153898157f39d88e2fa68183d477b",
    "packages/registry/src/application/import-registry.ts": "9cb3f6f911242723623f5f4803a2ab2fcdaaeee0b9b8a889b3ed903d378590c8",
    "packages/registry/src/application/query-registry.ts": "c6eaa43f113abc0d9f862e91e52e9cef4aea684f5cc434c049d586cfee55e229",
    "packages/registry/src/domain/endpoint-policy.ts": "05164cd74bbb9427b796fb47bea45186028adf4df70cdad41adde8f5169a7331",
    "packages/registry/src/domain/freshness.ts": "6dbdfc1f820040dce99bea61afb726dd8cd7d4a8ee43f29b1282b7c88d08f246",
    "packages/registry/src/domain/publisher-policy.ts": "3df32e3a496fad1d5aa9948f3695caf3fc1b8ce47b9ccc7d78bf6a9b1e59c33d",
    "packages/registry/src/domain/source-policy.ts": "806e3ae099c1a4576c4fb787a74d688f58a0ab7a82a2ee123978c241f1cbe8b7",
    "packages/registry/src/index.ts": "50b5f65abb4bfe2ce7bf11487d453d0b8aa04125d294189c8add8f21aaf7e80f",
    "packages/registry/src/ports/entity-reader.ts": "16f209e497b007ca42d4ca03ec30237fb9793fcb6b7271c991de592c33022d8f",
    "packages/registry/src/ports/entity-writer.ts": "d6aec13478b0f8bb28b8524bd764cb68f88dfe595f9178aeeb7bcb86d46dbd21",
    "packages/registry/src/ports/source-snapshot.ts": "88c83204ee4b1d21209b75fc53d449026ff4c8b5e24a2ea144764ee62fe36630",
    "packages/shared/dist/errors.d.ts": "c6d37cb082fe64fe05c50a676f872504f1eed41d7393bfdb46a8fcbc6dd2e854",
    "packages/shared/dist/errors.js": "75613d3a466c17efe0baa7d475cc970d44e4e85e32c00832c4a6e794d1fafe3a",
    "packages/shared/dist/evidence.d.ts": "d91f6acfaeeb8b73fa4947dd6804342d7f350eca33c399b6b16990300c42c350",
    "packages/shared/dist/evidence.js": "4d0139e1af30a657512a68288c34bbac9384820cd05c773b83b4f22facb4cdd3",
    "packages/shared/dist/index.d.ts": "1dc6846a228aec3a98867bd7026d2299d343ddee6c564fe08bdaa939127bf3c1",
    "packages/shared/dist/index.js": "39998d7079cb0bb342c5c6a9fb12492bd46e44680ae0e272e1fd943db58912c5",
    "packages/shared/dist/observer.d.ts": "94a524391e02a06fb02df8366e1c53e128336828391fd53a6029c470c41e7d50",
    "packages/shared/dist/observer.js": "f62d974b571f35f79c7ae8617b58632e342115cfa1bf2cc59aa3eca0086bac39",
    "packages/shared/dist/payment.d.ts": "e729d05ed171ff0491afd15bb3cd3b5a266517d7a8b7ba4520f63024473a219e",
    "packages/shared/dist/payment.js": "8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881",
    "packages/shared/dist/primitives.d.ts": "f1d961d5e452a9a7e09843d97c928a62801b20dd4085f084def0a58a7e5575df",
    "packages/shared/dist/primitives.js": "3256ed2dfbfaacc6f5c6f211d59a468df1191c6dafda9b9131209e8d8d702066",
    "packages/shared/dist/registry.d.ts": "2e7b3f9df2c411617a64109ae568cf5686d6ebfd4892bc99c6e3bc7dc905d6a2",
    "packages/shared/dist/registry.js": "4f1bbc750e74c63d6cdb2d1e38ff45a1f7b9b117d05acd84d8e2502172e917d4",
    "packages/shared/dist/report.d.ts": "bd0449a42ac781472a159c3dc8efb6853c6343e2cb685dccefe14d3265c2e695",
    "packages/shared/dist/report.js": "c2f14ebd9d65b22181806868fcff9b7e7237bb6836c94bc8af1157c3a5a7de1e",
    "packages/shared/dist/rpc.d.ts": "30ad0667713881e6843323d5c6774d73fa2755c68092887dfbbc3c7a8dd050d3",
    "packages/shared/dist/rpc.js": "fc668598722144e4c691bf8cb88e0b548c57885ac2bec2d5a3fc75900723f93a",
    "packages/shared/dist/transport.d.ts": "6e9e04881027fc74365af0164a70d6b7f7c4ccd8c974819f03d95ea9ab509cb9",
    "packages/shared/dist/transport.js": "17e2698dad1daf0d5bdf105d633c72163f39a971e4e24953828de09ae3675ef6",
    "packages/shared/package.json": "33d66246d3d06435c922a6cfe10f6ad9a3922d8738d51b5d5aba433672837fbf",
    "packages/shared/src/errors.ts": "973b400706d57af5eced5d9a0128d9beb040ae9e650f81751e7526404940d68b",
    "packages/shared/src/evidence.ts": "c757c4c3f528fde7256300e39d76ae315e7f057b238d74ce374c2766ac4a4f4a",
    "packages/shared/src/index.ts": "0cd9e827a3a7bed3efffdbaef7db7d410793298e10610e64c32d1a17261acbb0",
    "packages/shared/src/observer.ts": "02f986594b59a423fe22a0639e3d6089548c3ed63dc9729e316e89d7dfe7acd2",
    "packages/shared/src/payment.ts": "50d44c0e6f87afa59d0a4b989b0de4272f2d26ef8f26a30095d75b8201b59b88",
    "packages/shared/src/primitives.ts": "01659721028e687f20e856ad09eb8964f7f098fc3cf271843f64ccd5f5d84cdc",
    "packages/shared/src/registry.ts": "58a5605b6b05f45afa202fd999b71ff05651d9c54517308bfbcf8d27cf7fdde1",
    "packages/shared/src/report.ts": "a21b73f81d9e76d6020d3de7f6b10fa65fbe8cb20005634f5ec9e34f4f96001b",
    "packages/shared/src/rpc.ts": "bba2f58302254b1463469e4dbe12d0704cf2a5afb6a9dc1862a98d899bdebbd4",
    "packages/shared/src/transport.ts": "c87baaf8c74efc2c9bc7969c2328b957dfa24dc188d60d6b21a4c0c7b5e494d4",
    "pnpm-lock.yaml": "524520d2960a9baf77dca1d0512a34543cb9d83a32b7cfebc27db42a806f8224",
    "scripts/registry-query-example.ts": "08b9233a71d9fb311522305e6a80cd5e9d719da26501619cb297105bd0110fb5"
  },
  "stdoutSha256": "65b5311bdb8691e74386a4c98de6bc18c423a40ed536f338fe81c78215331edc",
  "networkGuardSha256": "02cdbddc3fbfb0b757ea3e0c9465ffe0cfd0e524beb4114f4ee36f7ec2d34db5"
}
```

</details>
