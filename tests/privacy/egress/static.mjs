import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireRoot = createRequire(join(repository, 'package.json'));
const ts = requireRoot('typescript');
const NETWORK = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'eval', 'Function']);

function literal(node) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literal(node.left); const right = literal(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

/** Conservative review rule for browser network primitives and direct RPC SDK imports. */
export function inspectBrowserSource(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations = [];
  const positions = new Set();
  function add(node, reason) {
    if (positions.has(node.pos)) return;
    positions.add(node.pos);
    const point = tree.getLineAndCharacterOfPosition(node.getStart(tree));
    violations.push({ file: filename, line: point.line + 1, column: point.character + 1, reason });
  }
  function visit(node) {
    if (ts.isIdentifier(node) && NETWORK.has(node.text)) add(node, 'Browser network primitive requires a reviewed adapter.');
    if (ts.isElementAccessExpression(node) && NETWORK.has(literal(node.argumentExpression))) {
      add(node, 'Computed browser network primitive requires a reviewed adapter.');
    }
    if (ts.isComputedPropertyName(node) && NETWORK.has(literal(node.expression))) {
      add(node, 'Computed network destructuring requires a reviewed adapter.');
    }
    if (ts.isCallExpression(node) && node.arguments.length >= 2 && NETWORK.has(literal(node.arguments[1]))) {
      const expression = node.expression;
      const reflection = ts.isPropertyAccessExpression(expression) && expression.expression.getText(tree) === 'Reflect' && expression.name.text === 'get'
        || ts.isElementAccessExpression(expression) && expression.expression.getText(tree) === 'Reflect' && literal(expression.argumentExpression) === 'get';
      if (reflection && ['globalThis', 'window', 'self'].includes(node.arguments[0].getText(tree))) {
        add(node, 'Reflected browser network primitive requires a reviewed adapter.');
      }
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      && /^(viem|ethers|web3)(\/|$)/.test(literal(node.moduleSpecifier) ?? '')) {
      add(node, 'Direct RPC SDK import requires a reviewed adapter.');
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && /^(viem|ethers|web3)(\/|$)/.test(literal(node.arguments[0]) ?? '')) {
      add(node, 'Dynamic direct RPC SDK import requires a reviewed adapter.');
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
}

export async function checkRpcEgress(root = repository) {
  const pins = JSON.parse(await readFile(join(root, 'tests/privacy/egress/reviewed-adapters.json'), 'utf8'));
  const violations = [];
  const seen = new Set();
  let files = 0;
  async function walk(directory) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
        files++;
        const bytes = await readFile(join(root, path));
        if (Object.hasOwn(pins.files, path)) {
          seen.add(path);
          if (createHash('sha256').update(bytes).digest('hex') !== pins.files[path].sha256) {
            violations.push({ file: path, line: 1, column: 1, reason: 'Reviewed network adapter changed; explicit boundary re-review and pin update required.' });
          }
        } else violations.push(...inspectBrowserSource(bytes.toString('utf8'), path));
      }
    }
  }
  for (const directory of ['apps/dashboard/src', 'packages/transport/src/adapters/browser']) await walk(directory);
  for (const file of Object.keys(pins.files)) if (!seen.has(file)) {
    violations.push({ file, line: 1, column: 1, reason: 'Reviewed adapter missing from scanned scope.' });
  }
  return { evidence: 'SIMULATED', files, violations, passed: violations.length === 0,
    scope: 'Dashboard source and transport browser adapters; explicit whole-file pins for reviewed worker/bootstrap/direct-control/registry metadata boundaries. Not a universal JavaScript proof.' };
}
