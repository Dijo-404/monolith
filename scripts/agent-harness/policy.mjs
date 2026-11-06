// The first supported repair is deliberately small enough to enforce structurally.
export const APP_PATH = 'examples/agent-harness/app.mjs';
export const ORIGINAL_APP = `// SPDX-License-Identifier: MIT
// This original, fixed example deliberately starts with one privacy regression.
export async function readBalance({ privateRead, regressionRead }) {
  void privateRead;
  void regressionRead;
  return regressionRead();
}
`;
export const REPAIRED_APP = ORIGINAL_APP.replace('return regressionRead();', 'return privateRead();');
export const APPROVED_PATCH = `--- a/${APP_PATH}
+++ b/${APP_PATH}
@@ -1,7 +1,7 @@
 // SPDX-License-Identifier: MIT
 // This original, fixed example deliberately starts with one privacy regression.
 export async function readBalance({ privateRead, regressionRead }) {
   void privateRead;
   void regressionRead;
-  return regressionRead();
+  return privateRead();
 }
`;
export const LIMITS = Object.freeze({ patchBytes: 8192, fileBytes: 4 * 1024 * 1024, sourceBytes: 64 * 1024 * 1024,
  files: 4096, timeoutMs: 240_000, outputBytes: 1024 * 1024, attempts: 2 });
export const TRUSTED_PATHS = Object.freeze([
  'scripts/agent-harness/', 'examples/agent-harness/', 'tests/e2e/agent-harness/',
  'tests/fixtures/agent-harness/', 'docs/agent-harness.md',
  'packages/shared/src/', 'packages/shared/dist/', 'packages/shared/package.json',
  'packages/transport/src/', 'packages/transport/dist/', 'packages/transport/package.json',
  'packages/privacy-analyzer/src/', 'packages/privacy-analyzer/dist/', 'packages/privacy-analyzer/package.json',
  'packages/cli/src/', 'packages/cli/dist/', 'packages/cli/package.json',
  'tests/privacy/egress/', 'package.json', 'pnpm-lock.yaml',
]);
export const DIAGNOSTICS = Object.freeze({
  DIRECT_BYPASS: { path: APP_PATH, line: 6, repair: 'Use the supplied privateRead capability for the useful balance read.' },
  WORKER_UNAVAILABLE: { path: null, line: null, repair: 'Restore the approved worker; never add a direct fallback.' },
});
export class HarnessError extends Error {
  constructor(code) { super(code); this.name = 'HarnessError'; this.code = code; }
}
