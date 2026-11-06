# Public observer demo

This explicit composition starts the existing observer with fresh synthetic run
allocation enabled. Its ordinary registry API queries the accepted public Arkiv
reader. Its only upstream mapping is `lab_optimism` → chain `10` →
`https://mainnet.optimism.io/`. No transaction signing key is used.

Only this public lab opts into a 120-second registry-generation lifetime; the
normal reader's 30-second default is unchanged. Actual storage, publisher,
current-block and DNS checks still run on each query, and the publisher's true
content deadline clamps every generated window. Existing received generations
are never retimestamped or extended. This explicit policy covers measured worker
latency and the lab's bounded operations. The separately configured browser lab
uses a 60-second chain-probe validation lifetime and still checks authority before
and after each asynchronous exchange. Historical blocked attempts using the
30-second policy remain blocked.

Build with the repository's pinned Node 24.22.2 and pnpm 12.18.0, then run:

```sh
/absolute/node deploy/observer/start.mjs \
  --ssh /absolute/ssh \
  --known-hosts /absolute/previously-reviewed-known_hosts \
  --status /absolute/new-status.json
```

For the deployment's optional server-only Rabdi authentication, append
`--arkiv-env-file /absolute/private-server.env`. That regular file must have
owner-only permissions (0600 recommended) and exactly one literal `ARKIV_ACCESS_KEY` assignment. Only that
named value is selected; other environment assignments are ignored. Missing,
duplicate, malformed, linked or unsafe-mode key files fail before startup.
No file is loaded implicitly, and an explicitly configured key never falls back
to the anonymous endpoint on rejection. The existing public default remains
available to independent consumers that do not select a key.

The reader sends the credential only as `X-API-KEY` to the fixed Rabdi URL and
rejects redirects on authenticated requests.
The SDK chain metadata retains public URLs. The key is never placed in a URL,
browser configuration, child-process argument/environment, status/evidence field
or hash. Status records only `serverAccessKeyConfigured`. The pinned SDK's public
chain helper can print its public-metadata warning even with transport-header
authentication configured; use the explicit status flag and actual trusted query
result to assess the selected runtime. See the [official access-key documentation](https://stage.docs.arkiv.network/start-here/access-keys/)
for supported header authentication and quotas. Never include the credential file
or its hash in a source/runtime evidence bundle.

The anonymous SSH default remains unchanged. After registering a dedicated
public key with a free localhost.run account, the operator may explicitly append
both `--ssh-identity /absolute/private-identity` and `--ssh-user monolith-demo`.
The login is a bounded lowercase ASCII name and cannot be `nokey`; the destination
is still fixed to localhost.run on port22. One option without the other fails
before startup. The selected identity must be an absolute regular non-symlink
file owned by the current user, owner-readable and inaccessible to other users.
Selected and resolved paths reject OpenSSH percent/environment expansion syntax.
The launcher checks only file metadata: OpenSSH alone reads the key contents.
No private identity path, content or hash enters status/evidence; status adds only
the `sshAuthenticationMode` enum. Dedicated mode disables IdentityAgent and keeps
BatchMode, IdentitiesOnly and all existing host-pin/forwarding guards. Rejected
authentication closes the backend without falling back to anonymous mode.
Free registered authentication does not establish permanent hostname availability
and does not authorize billing activation or a paid/custom domain.

All three flags are required. The status file must be new. The launcher never
enrolls or replaces an SSH identity. Use the explicitly reviewed public host pin
from [MN009's provider observation](../../tests/privacy/live-observer/observed-localhost-run-provider-help-2026-11-06.json).
Initial enrollment was TOFU; strict pinning subsequently rejects a changed key.
The actual server help supported `--proxy-protocol-v2`; older website flag names
were rejected. The anonymous temporary SSH tunnel requires no paid resource, payer,
localhost.run account or private SSH key.

For a session-independent demo process on this Linux workstation, the operator
can invoke the same command using `systemd-run --user --unit
monolith-public-observer --property=KillMode=control-group
--property=TimeoutStopSec=10s`, followed by the absolute Node/script/flag arguments.
Stop it with `systemctl --user stop monolith-public-observer.service`. This is a
transient user service, dependent on the workstation and user manager. Inspect
the sanitized JSON status rather than raw provider logs. The public origin comes
only from the accepted registration event; administrative output is discarded.

The launcher checks only health while waiting for public readiness. It does not
retry RPC calls, warm a worker or claim live privacy success. Normal termination,
startup failure, provider exit and cancellation close the child and local API.
The status snapshots include STARTING/READY/CLOSED, public tool/pin hashes and
bounded counters. A repeated termination signal can end the process before its
final snapshot is written, so READY alone is not current liveness evidence; use
the user-unit/cgroup state and bounded public health. A successful process start is separate from the
real browser verification described in [the deployment record](../../docs/observer-deployment.md).

The public edge accepts only:

- `GET /api/health`
- `GET`/`OPTIONS /api/registry/chains?chainId=10`
- `POST`/`OPTIONS /api/observer/runs`
- `GET`/`OPTIONS /api/observer/runs/run-<lowercase UUIDv4>`
- `POST`/`OPTIONS /api/observer/read?endpointId=lab_optimism&runId=run-<lowercase UUIDv4>`

The read query is diagnostic metadata. Its canonical spelling/order is required;
duplicates, extra fields, conflicts and alternate endpoint IDs are denied. Before
the private hop, the edge removes only the run query and supplies missing JSON
content type/run header. It preserves the RPC bytes and ID. A supplied case label
never proves a route or elects a baseline. The existing observer reserves the
server-generated baseline ID and rejects unknown/expired runs before upstream
work. IDs are public synthetic correlation, not authentication; unexpected rows
must fail inventory checks. The fixed five-minute store and global allocation
limits remain unchanged.

Source identity comes exclusively from a bounded PROXYv2 frame delivered over the
host-pinned SSH connection into loopback. Caller forwarding headers are discarded.
The private backend receives exactly one XFF derived from that socket. Both local
ports trust the operator's single-user host: another local process can forge a
frame or private-hop XFF. The provider and its TLS termination remain trusted.
The public hostname may rotate or disappear, provider retention is unverified,
and the destination still sees the JSON-RPC payload. This is temporary no-cost
demonstration hosting, without a permanent availability claim.

Limits include 64 sockets, 16 concurrent HTTP operations, 240 admitted operations
per minute across metadata and reads, 8 KiB headers/32 fields, 16 KiB request bodies
(128 bytes for allocation), 512 KiB responses, three-second prefix/header/body
deadlines, a twelve-second backend deadline and twenty-second socket lifetime.
One HTTP request is accepted per PROXY connection. Credentials/cookies, unsupported
application headers, ambiguous framing, Expect/Upgrade/CONNECT and arbitrary
routes are rejected. Counters contain numbers only; the denial counter counts
events and can count a timeout and subsequent error for the same request.

Offline tests use actual loopback sockets and explicitly simulated sources:

```sh
pnpm exec vitest run apps/observer/test/public-demo
pnpm exec vitest run --config deploy/observer/vitest.config.mjs
pnpm check
```

No old MN009 source/evidence, normal observer defaults, frontend or root package
manifest/lockfile is changed by this deployment task.

The [actual deployment record](evidence/2026-11-07/deployment-record.json) binds
runtime6 and the passing four-case MN014 browser capture. Its metadata/binding
copies remain byte-identical. This describes the capture-time runtime and is
not current availability proof. Follow the [latest operational updates](https://github.com/Dijo-404/monolith/issues/40)
and verify the current backend origin before final dashboard QA. The 12-hour cap
and unprivileged sleep/idle inhibitor do not guarantee provider or hostname lifetime.
