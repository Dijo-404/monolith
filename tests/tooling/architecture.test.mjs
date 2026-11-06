import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function errors(file, source) {
  const [result] = await eslint.lintText(source, { filePath: path.join(root, file) });
  return result.messages.filter((message) => message.severity === 2);
}

describe('clean architecture lint boundaries', () => {
  it.each([
    ['packages/cli/src/commands.ts', "import '@monolith/transport/adapters/browser';"],
    ['packages/cli/src/commands.ts', "import '@monolith/privacy-analyzer/src/analyze.js';"],
    ['packages/cli/src/commands.ts', "import '../../../apps/dashboard/src/composition/lab.js';"],
    ['packages/transport/src/domain/policy.ts', "import 'fastify';"],
    ['packages/registry/src/application/query.ts', "import '@arkiv-network/sdk';"],
    ['packages/privacy-analyzer/src/index.ts', "import 'node:fs';"],
    ['packages/transport/src/domain/policy.ts', "import 'fs/promises';"],
    ['packages/transport/src/domain/policy.ts', "import '../adapters/browser/worker.js';"],
    ['packages/transport/src/index.ts', "import '../../../apps/observer/src/composition/server.js';"],
    ['apps/dashboard/src/App.tsx', "import '../../../packages/shared/src/index.js';"],
    ['apps/dashboard/src/App.tsx', "import '@monolith/transport/src/worker';"],
    ['apps/dashboard/src/App.tsx', "import 'node:fs';"],
    ['packages/shared/src/index.ts', "import '@monolith/registry';"],
    ['apps/observer/src/composition/server.ts', "import('@monolith/transport');"],
  ])('rejects a forbidden import in %s: %s', async (file, source) => {
    expect((await errors(file, source)).some((error) => error.ruleId === 'monolith/imports')).toBe(true);
  });

  it.each([
    ['packages/cli/src/commands.ts', "import '@monolith/shared';"],
    ['packages/cli/src/commands.ts', "import '@monolith/privacy-analyzer';"],
    ['apps/dashboard/src/App.tsx', "import '@monolith/transport';"],
    ['packages/transport/src/domain/policy.ts', "import '@monolith/shared';"],
    ['packages/registry/src/adapters/arkiv/reader.ts', "import '@arkiv-network/sdk';"],
    ['apps/observer/src/composition/server.ts', "import 'fastify';"],
  ])('permits an intended boundary in %s: %s', async (file, source) => {
    expect(await errors(file, source)).toEqual([]);
  });

  it('rejects direct environment/network access in application code', async () => {
    const result = await errors('packages/transport/src/application/read.ts', 'process.cwd(); fetch("https://example.com");');
    expect(result.filter((error) => error.ruleId === 'no-restricted-globals')).toHaveLength(2);
  });

  it('prevents core code reaching its own adapters through a public facade', async () => {
    const result = await errors('packages/transport/src/domain/policy.ts', "import '@monolith/transport/adapters/browser';");
    expect(result.some((error) => error.message.includes('own public facade or adapters'))).toBe(true);
  });
});
