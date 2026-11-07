import { describe, expect, it } from 'vitest';
import { resolveView } from '../src/app/route.js';
import { highlight } from '../src/features/docs/highlight.js';

describe('dashboard views', () => {
  it.each([
    ['', 'live'],
    ['?mode=simulated', 'simulated'],
    ['?page=docs', 'docs'],
    ['?page=docs&mode=simulated', 'docs'],
    ['?page=other', 'live'],
    ['?mode=live', 'live'],
  ])('resolves %j to %s', (search, view) => {
    expect(resolveView(search)).toBe(view);
  });
});

describe('documentation highlighting', () => {
  it('preserves the exact source text', () => {
    const source = `import { createMonolithTransport } from '@monolith/transport';\n// fail closed\nconst n = 180_000;`;
    expect(highlight(source, 'ts').map((token) => token.text).join('')).toBe(source);
  });

  it('marks keywords, strings, comments and numbers in TypeScript', () => {
    const kinds = highlight(`const x = 'a'; // b\nawait 42`, 'ts')
      .filter((token) => token.kind !== 'plain' && token.kind !== 'punct')
      .map((token) => [token.kind, token.text.trim()]);
    expect(kinds).toEqual([
      ['keyword', 'const'], ['string', "'a'"], ['comment', '// b'], ['keyword', 'await'], ['number', '42'],
    ]);
  });

  it('marks commands and flags in shell snippets', () => {
    const tokens = highlight('monolith check --input run.json --json', 'sh');
    expect(tokens.map((token) => token.text).join('')).toBe('monolith check --input run.json --json');
    expect(tokens.filter((token) => token.kind === 'flag').map((token) => token.text)).toEqual(['--input', '--json']);
    expect(tokens[0]).toEqual({ kind: 'keyword', text: 'monolith' });
  });

  it('round-trips JSON and HTML', () => {
    const json = '{ "a": [1, true, null] }';
    const html = '<script type="module">x</script>';
    expect(highlight(json, 'json').map((token) => token.text).join('')).toBe(json);
    expect(highlight(html, 'html').map((token) => token.text).join('')).toBe(html);
  });
});
