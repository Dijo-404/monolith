import { PassThrough } from 'node:stream';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { runTui } from '../src/tui.js';

function terminal(options: {
  inputTTY?: boolean; outputTTY?: boolean; initiallyRaw?: boolean; initiallyPaused?: boolean;
} = {}) {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  let raw = options.initiallyRaw ?? false;
  Object.defineProperty(input, 'isTTY', { value: options.inputTTY ?? true });
  Object.defineProperty(input, 'isRaw', { get: () => raw });
  Object.defineProperty(output, 'isTTY', { value: options.outputTTY ?? true });
  input.setRawMode = vi.fn((value: boolean) => { raw = value; return input; });
  let text = '';
  output.on('data', (value) => { text += String(value); });
  if (options.initiallyPaused !== false) input.pause();
  return {
    input, output,
    text: () => text,
    async keys(value: string) { input.emit('data', Buffer.from(value)); await setImmediate(); },
  };
}

const success = { exitCode: 0, stdout: 'SIMULATED: local check result\n', stderr: '' };

describe('terminal adapter uses the shared CLI handlers', () => {
  it('runs doctor through the injected handler and restores the terminal on quit', async () => {
    const io = terminal();
    const execute = vi.fn(async () => success);
    const priorSigint = process.listenerCount('SIGINT');
    const priorSigterm = process.listenerCount('SIGTERM');
    const done = runTui(io, execute);
    expect(io.input.isRaw).toBe(true);
    await io.keys('\r');
    expect(execute).toHaveBeenCalledExactlyOnceWith(['doctor']);
    expect(io.text()).toContain('SIMULATED: local check result');
    await io.keys('q');
    expect(await done).toBe(0);
    expect(io.input.isRaw).toBe(false);
    expect(io.input.isPaused()).toBe(true);
    expect(io.input.listenerCount('keypress')).toBe(0);
    expect(process.listenerCount('SIGINT')).toBe(priorSigint);
    expect(process.listenerCount('SIGTERM')).toBe(priorSigterm);
    expect(io.text()).toContain('\u001b[?25h');
  });

  it.each([
    ['j', '/tmp/private input.json', ['check', '--input', '/tmp/private input.json']],
    ['3', '/tmp/private report.json', ['report', '/tmp/private report.json']],
    ['4', 'https://lab.example.com/', ['lab', '--url', 'https://lab.example.com/']],
  ])('dispatches selected action %s without echoing its argument', async (selection, argument, argv) => {
    const io = terminal();
    const execute = vi.fn(async () => success);
    const done = runTui(io, execute);
    await io.keys(selection);
    await io.keys('\r');
    await io.keys(argument);
    await io.keys('\r');
    expect(execute).toHaveBeenCalledExactlyOnceWith(argv);
    expect(io.text()).not.toContain(argument);
    await io.keys('q');
    expect(await done).toBe(0);
  });

  it('supports arrow navigation, help, prompt cancellation and entry correction', async () => {
    const io = terminal();
    const execute = vi.fn(async () => success);
    const done = runTui(io, execute);
    await io.keys('?');
    expect(io.text()).toContain('Opening the lab does not execute or prove');
    await io.keys('\u001b[B\r');
    await io.keys('discard-this');
    await io.keys('\u001b');
    // readline distinguishes a lone Escape from the prefix of an arrow sequence.
    await setTimeout(550);
    await io.keys('\r');
    await io.keys('input.jso\u007f\u007fson');
    await io.keys('\r');
    expect(execute).toHaveBeenCalledExactlyOnceWith(['check', '--input', 'input.json']);
    expect(io.text()).not.toContain('discard-this');
    await io.keys('q');
    expect(await done).toBe(0);
  });

  it('refuses redirected input or output without entering raw mode', async () => {
    for (const options of [{ inputTTY: false }, { outputTTY: false }]) {
      const io = terminal(options);
      const execute = vi.fn(async () => success);
      expect(await runTui(io, execute)).toBe(2);
      expect(execute).not.toHaveBeenCalled();
      expect(io.input.setRawMode).not.toHaveBeenCalled();
      expect(io.text()).toContain('requires a TTY');
    }
  });

  it('cancels a pending command and prevents its late result from repainting the terminal', async () => {
    const io = terminal({ initiallyRaw: true });
    let complete: ((value: typeof success) => void) | undefined;
    const execute = vi.fn(() => new Promise<typeof success>((resolve) => { complete = resolve; }));
    const done = runTui(io, execute);
    await io.keys('\r');
    await io.keys('\u0003');
    expect(await done).toBe(130);
    expect(io.input.isRaw).toBe(true);
    const afterClose = io.text();
    complete?.(success);
    await setImmediate();
    expect(io.text()).toBe(afterClose);
  });

  it.each(['q', '\u0003'])('releases a fresh, previously unstarted stdin on exit %j', async (key) => {
    const io = terminal({ initiallyPaused: false });
    expect(io.input.readableFlowing).toBe(null);
    expect(io.input.isPaused()).toBe(false);
    const done = runTui(io, async () => success);
    await io.keys(key);
    expect(await done).toBe(key === 'q' ? 0 : 130);
    expect(io.input.isPaused()).toBe(true);
    expect(io.input.isRaw).toBe(false);
  });

  it('sanitizes handler exceptions and terminal control sequences, then remains usable', async () => {
    const io = terminal();
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('private token must not appear'))
      .mockResolvedValueOnce({ ...success, stdout: '\u001b]52;c;secret\u0007SIMULATED\u001b[2J' });
    const done = runTui(io, execute);
    await io.keys('\r');
    expect(io.text()).toContain('Command failed');
    expect(io.text()).not.toContain('private token');
    await io.keys('\r');
    expect(io.text()).not.toContain('52;c;secret');
    expect(io.text()).toContain('SIMULATED');
    await io.keys('q');
    expect(await done).toBe(0);
    expect(io.input.isRaw).toBe(false);
  });

  it('restores raw mode and cursor when the input stream fails', async () => {
    const io = terminal();
    const done = runTui(io, async () => success);
    io.input.emit('error', new Error('private stream detail'));
    expect(await done).toBe(2);
    expect(io.input.isRaw).toBe(false);
    expect(io.text()).toContain('Terminal input became unavailable');
    expect(io.text()).not.toContain('private stream detail');
    expect(io.text()).toContain('\u001b[?25h');
  });

  it('restores raw mode if terminal output throws or emits an error', async () => {
    const failingWrite = terminal();
    failingWrite.output.write = vi.fn(() => { throw new Error('private output detail'); });
    expect(await runTui(failingWrite, async () => success)).toBe(2);
    expect(failingWrite.input.isRaw).toBe(false);
    expect(failingWrite.input.listenerCount('keypress')).toBe(0);

    const failingStream = terminal();
    const done = runTui(failingStream, async () => success);
    failingStream.output.emit('error', new Error('private output detail'));
    expect(await done).toBe(2);
    expect(failingStream.input.isRaw).toBe(false);
    expect(failingStream.text()).not.toContain('private output detail');
  });
});
