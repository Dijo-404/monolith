import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES, readJson } from '../src/node.js';

describe('bounded local JSON input', () => {
  it('accepts ordinary JSON and rejects oversized, non-UTF8, malformed and non-file input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'monolith-cli-input-'));
    try {
      const file = join(directory, 'input.json');
      await writeFile(file, '{"schemaVersion":1}');
      expect(await readJson(file)).toEqual({ schemaVersion: 1 });
      await writeFile(file, Buffer.alloc(MAX_INPUT_BYTES + 1, 0x20));
      await expect(readJson(file)).rejects.toThrow();
      await writeFile(file, Buffer.from([0x22, 0xff, 0x22]));
      await expect(readJson(file)).rejects.toThrow();
      await writeFile(file, '{malformed');
      await expect(readJson(file)).rejects.toThrow();
      await expect(readJson(directory)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO without waiting for an input producer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'monolith-cli-fifo-'));
    try {
      const file = join(directory, 'input.pipe');
      execFileSync('mkfifo', [file]);
      await expect(readJson(file)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
