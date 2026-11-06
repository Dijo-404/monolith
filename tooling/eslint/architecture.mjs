import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const allowed = {
  cli: ['shared', 'privacy-analyzer'],
  dashboard: ['shared', 'transport', 'privacy-analyzer', 'registry'],
  observer: ['shared', 'registry'],
  relayer: ['shared'],
  shared: [],
  transport: ['shared'],
  'privacy-analyzer': ['shared'],
  registry: ['shared'],
};

function workspace(filename) {
  const parts = path.relative(root, filename).split(path.sep);
  if (!['apps', 'packages'].includes(parts[0]) || !parts[1]) return null;
  return { kind: parts[0], name: parts[1], parts };
}

function isCore(module) {
  return module.parts[2] === 'src' && (
    ['shared', 'privacy-analyzer'].includes(module.name)
    || ['domain', 'application', 'ports'].includes(module.parts[3])
  );
}

const infrastructure = /^(node:|react(?:-dom)?(?:\/|$)|fastify(?:\/|$)|viem(?:\/|$)|@anon-rpc\/|@arkiv-network\/)/;

export default {
  meta: { name: 'monolith-architecture' },
  rules: {
    imports: {
      meta: {
        type: 'problem',
        schema: [],
        messages: { boundary: '{{reason}}' },
      },
      create(context) {
        const filename = context.filename;
        const owner = workspace(filename);
        if (!owner) return {};

        function check(node, source) {
          if (typeof source !== 'string') return;
          const reject = (reason) => context.report({ node, messageId: 'boundary', data: { reason } });
          if (isCore(owner) && (isBuiltin(source) || infrastructure.test(source))) {
            reject('Domain/application code cannot import infrastructure; inject a port from a composition root.');
            return;
          }
          if (owner.name === 'dashboard' && owner.parts[2] === 'src' && isBuiltin(source)) {
            reject('Browser source cannot import Node builtins.');
            return;
          }
          if (source.startsWith('.')) {
            const target = workspace(path.resolve(path.dirname(filename), source));
            if (!target || target.kind !== owner.kind || target.name !== owner.name) {
              reject('Cross-workspace imports must use the public @monolith package export.');
            } else if (target && isCore(owner) && ['adapters', 'composition'].includes(target.parts[3])) {
              reject('Domain/application code cannot depend on adapters or composition roots.');
            }
            return;
          }
          if (!source.startsWith('@monolith/')) return;
          const [name, ...subpath] = source.slice('@monolith/'.length).split('/');
          if (isCore(owner) && name === owner.name) {
            reject('Domain/application code must use relative domain/port imports, not its own public facade or adapters.');
            return;
          }
          if (name !== owner.name && !allowed[owner.name]?.includes(name)) {
            reject(`The ${owner.name} workspace cannot depend on @monolith/${name}.`);
            return;
          }
          let manifest;
          try {
            manifest = JSON.parse(readFileSync(path.join(root, 'packages', name, 'package.json'), 'utf8'));
          } catch {
            reject('Only declared package exports may be imported; app modules are private.');
            return;
          }
          const key = subpath.length ? `./${subpath.join('/')}` : '.';
          if (!Object.hasOwn(manifest.exports ?? {}, key)) {
            reject('This package subpath is private; add and review a public export first.');
          }
        }

        return {
          ImportDeclaration: (node) => check(node, node.source.value),
          ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
          ExportAllDeclaration: (node) => check(node, node.source.value),
          ImportExpression: (node) => check(node, node.source.value),
        };
      },
    },
  },
};
