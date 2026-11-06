/** Public synthetic intent, independent of fresh observer/report/wire identities. */
export const LIVE_SCENARIO = {
  schemaVersion: 1,
  scenarioId: 'monolith.synthetic-balance-widget.v1',
  seed: 'monolith-zero-address-balance-v1',
  chainId: '10',
  method: 'eth_getBalance',
  addressFixture: 'synthetic-zero-address',
  blockTag: 'latest',
  callsite: 'lab.widget',
  functionalAssertions: ['balance-read-completes', 'canonical-hex-quantity-returned'],
} as const;

const fixture = {
  scenarioId: LIVE_SCENARIO.scenarioId,
  seed: LIVE_SCENARIO.seed,
  chainId: LIVE_SCENARIO.chainId,
  method: LIVE_SCENARIO.method,
  addressFixture: LIVE_SCENARIO.addressFixture,
  blockTag: LIVE_SCENARIO.blockTag,
  callsite: LIVE_SCENARIO.callsite,
  privacyRequired: true,
} as const;

export const LIVE_WIDGET_FIXTURES = {
  leak: { ...fixture, route: 'direct-debug' },
  repair: { ...fixture, route: 'anon-nym' },
} as const;

/** A fixture configuration diff, not a claim that source or live evidence was accepted. */
export const LIVE_FIXTURE_PATCH = {
  schemaVersion: 1,
  format: 'application/json-patch+json',
  before: LIVE_WIDGET_FIXTURES.leak,
  after: LIVE_WIDGET_FIXTURES.repair,
  operations: [
    { op: 'test', path: '', value: LIVE_WIDGET_FIXTURES.leak },
    { op: 'replace', path: '/route', value: 'anon-nym' },
  ],
  sourceAnchors: {
    before: { file: 'apps/dashboard/src/features/lab/live-controller.ts', anchor: 'MN014_WIDGET_BEFORE' },
    after: { file: 'apps/dashboard/src/features/lab/live-controller.ts', anchor: 'MN014_WIDGET_AFTER' },
    intent: { file: 'apps/dashboard/src/features/lab/scenario.ts', anchor: 'LIVE_SCENARIO' },
  },
} as const;
