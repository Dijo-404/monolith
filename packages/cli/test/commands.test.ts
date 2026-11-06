import { describe, expect, it, vi } from 'vitest';
import { executeCommand } from '../src/commands.js';
import type { CommandContext } from '../src/commands.js';

function context(value: unknown = undefined): CommandContext {
  return {
    nodeVersion: '24.22.2',
    readJson: vi.fn(async () => value),
    openLab: vi.fn(async () => true),
  };
}

describe('offline command and browser-launch boundaries', () => {
  it('doctor reports local readiness without reading files or opening a browser', async () => {
    const ctx = context();
    const result = await executeCommand(['doctor', '--json'], ctx);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ command: 'doctor', data: {
      evidence: 'UNTESTED', networkContacted: false, protectedReadsAvailableInNode: false,
    } });
    expect(ctx.readJson).not.toHaveBeenCalled();
    expect(ctx.openLab).not.toHaveBeenCalled();
  });

  it.each(['24.22.1', '24.21.0', '25.0.0', '26.12.1', 'private-runtime-string'])('doctor rejects unsupported runtime %s', async (version) => {
    const result = await executeCommand(['doctor', '--json'], { ...context(), nodeVersion: version });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).not.toContain(version);
    expect(JSON.parse(result.stdout).error.code).toBe('RUNTIME_UNAVAILABLE');
  });

  it('opens only an explicitly configured URL and keeps launch status untested', async () => {
    const ctx = { ...context(), configuredLabUrl: 'https://lab.example.com/' };
    const result = await executeCommand(['lab', '--json'], ctx);
    expect(ctx.openLab).toHaveBeenCalledExactlyOnceWith('https://lab.example.com/');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'launched', data: {
      evidence: 'UNTESTED', workerState: 'UNTESTED', runPerformed: false,
    } });
    expect(ctx.readJson).not.toHaveBeenCalled();
  });

  it('accepts explicit loopback HTTP development and lets flags override environment configuration', async () => {
    const ctx = { ...context(), configuredLabUrl: 'javascript:private-token' };
    const result = await executeCommand(['lab', '--url', 'http://127.0.0.1:4173/', '--json'], ctx);
    expect(result.exitCode).toBe(0);
    expect(ctx.openLab).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4173/');
    expect(result.stdout).not.toContain('private-token');
  });

  it.each([
    'http://external.example.com/', 'file:///etc/passwd', 'javascript:alert(1)',
    'https://user:private-secret@example.com/', 'https://example.com/#private-secret',
    'https://example.com/?key=private-secret', 'https://example.com/\nprivate-secret',
  ])('rejects unsafe destinations before launcher invocation', async (url) => {
    const ctx = context();
    const result = await executeCommand(['lab', '--url', url, '--json'], ctx);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).not.toContain('private-secret');
    expect(ctx.openLab).not.toHaveBeenCalled();
  });

  it('fails closed when the browser launcher fails or throws', async () => {
    for (const openLab of [async () => false, async (): Promise<boolean> => { throw new Error('private-launcher-error'); }]) {
      const ctx = { ...context(), openLab: vi.fn(openLab) };
      const result = await executeCommand(['lab', '--url', 'https://lab.example.com/', '--json'], ctx);
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'error', error: { code: 'LAB_UNAVAILABLE' } });
      expect(result.stdout).not.toContain('private-launcher-error');
      expect(ctx.openLab).toHaveBeenCalledTimes(1);
      expect(ctx.readJson).not.toHaveBeenCalled();
    }
  });

  it('projects reports without exporting unknown finding text or private identifiers', async () => {
    const value = {
      schemaVersion: 1, runId: 'private-run-sentinel', evidence: 'OBSERVED_LIVE',
      eligibleReads: 1, protectedReads: 0, successfulReads: 1, protectedCoverage: 0,
      findings: [{ code: 'private-finding-sentinel', callsite: '192.0.2.15', message: 'private-message' }],
      scope: { rpcOrigins: ['http://127.0.0.1'], scenarios: ['private-scenario'], bootstrapExclusions: [] },
    };
    for (const args of [['report', 'input.json', '--json'], ['report', 'input.json']]) {
      const result = await executeCommand(args, context(value));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('OBSERVED_LIVE');
      for (const privateText of ['private-', '192.0.2.15', '127.0.0.1']) expect(result.stdout).not.toContain(privateText);
    }
    const json = await executeCommand(['report', 'input.json', '--json'], context(value));
    expect(JSON.parse(json.stdout).data.findings).toEqual([{ code: 'UNRECOGNIZED_FINDING', count: 1 }]);
  });

  it.each([
    ['future version', 2, 'UNSUPPORTED_VERSION'],
    ['largest safe version', Number.MAX_SAFE_INTEGER, 'UNSUPPORTED_VERSION'],
    ['missing version', undefined, 'INVALID_INPUT'],
    ['null version', null, 'INVALID_INPUT'],
    ['zero version', 0, 'INVALID_INPUT'],
    ['negative version', -1, 'INVALID_INPUT'],
    ['fractional version', 1.5, 'INVALID_INPUT'],
    ['string version', '2', 'INVALID_INPUT'],
    ['unsafe integer version', Number.MAX_SAFE_INTEGER + 1, 'INVALID_INPUT'],
    ['malformed version-one payload', 1, 'INVALID_INPUT'],
  ] as const)('report and check classify %s on both output streams', async (_label, version, code) => {
    // Deliberately malformed private fields ensure version errors never project
    // submitted data, and a version-one envelope still requires valid content.
    const value = {
      ...(version === undefined ? {} : { schemaVersion: version }),
      input: 'private-input-sentinel', scope: 'private-scope-sentinel',
    };
    const message = code === 'UNSUPPORTED_VERSION'
      ? 'This input schema version is unsupported.'
      : 'Invalid command or input. Use monolith --help.';
    for (const command of ['report', 'check']) {
      for (const json of [false, true]) {
        const args = command === 'report' ? [command, 'private-file.json']
          : [command, '--input', 'private-file.json'];
        const ctx = context(value);
        const result = await executeCommand([...args, ...(json ? ['--json'] : [])], ctx);
        expect(result.exitCode).toBe(2);
        expect(ctx.readJson).toHaveBeenCalledExactlyOnceWith('private-file.json');
        expect(ctx.openLab).not.toHaveBeenCalled();
        expect(result.stdout + result.stderr).not.toContain('private-');
        if (json) {
          expect(result.stderr).toBe('');
          expect(JSON.parse(result.stdout)).toEqual({
            schemaVersion: 1, command, status: 'error', error: { code, message },
          });
        } else {
          expect(result.stdout).toBe('');
          expect(result.stderr).toBe(`${message}\n`);
        }
      }
    }
  });

  it('sanitizes unknown commands, repeated flags and file errors on the documented streams', async () => {
    const ctx = context();
    ctx.readJson = vi.fn(async () => { throw new Error('192.0.2.88 private-key-sentinel'); });
    for (const args of [
      ['check', '--input', 'private-file.json'], ['private-command', '--json'],
      ['doctor', '--json', '--json'], ['report', '--input', 'private-file.json'],
    ]) {
      const result = await executeCommand(args, ctx);
      expect(result.exitCode).toBe(2);
      for (const text of ['private-file', 'private-command', '192.0.2.88', 'private-key']) {
        expect(result.stdout + result.stderr).not.toContain(text);
      }
      if (args.includes('--json')) { expect(result.stderr).toBe(''); expect(() => JSON.parse(result.stdout)).not.toThrow(); }
      else expect(result.stdout).toBe('');
    }
  });
});
