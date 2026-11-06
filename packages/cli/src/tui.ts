import { emitKeypressEvents } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

interface TerminalIO {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface Key {
  name?: string;
  ctrl?: boolean;
}

type Execute = (argv: readonly string[]) => Promise<CommandResult>;
const actions = [
  { label: 'Doctor: inspect local prerequisites', args: ['doctor'] },
  { label: 'Check: analyze a local input file', args: ['check', '--input'] },
  { label: 'Report: inspect a local report file', args: ['report'] },
  { label: 'Lab: open the existing browser application', args: ['lab', '--url'] },
] as const;

// Command handlers supply sanitized projections. Also prevent terminal escape
// sequences in their display text from being interpreted as terminal commands.
const printable = (value: string) => {
  const point = value.codePointAt(0) ?? 0;
  return point >= 32 && (point < 127 || point > 159);
};
const terminalText = (value: string) => Array.from(stripVTControlCharacters(value))
  .filter((character) => character === '\t' || character === '\n' || printable(character))
  .join('').slice(0, 16_384);

/** A thin terminal adapter over the same handlers used by the noninteractive CLI. */
export async function runTui(io: TerminalIO, execute: Execute): Promise<number> {
  if (!io.input.isTTY || !io.output.isTTY) {
    io.output.write('Interactive mode requires a TTY. Use monolith --help for scripted commands.\n');
    return 2;
  }

  const wasRaw = Boolean(io.input.isRaw);
  // A fresh stdin has readableFlowing === null, while isPaused() is false.
  // Resuming that stream creates an event-loop handle which must be paused at
  // teardown just like an explicitly paused stream.
  const wasFlowing = io.input.readableFlowing;
  return new Promise<number>((resolve) => {
    let selected = 0;
    let prompt = false;
    let entry = '';
    let lastResult = '';
    let help = false;
    let busy = false;
    let closed = false;
    let rawChanged = false;
    let outputAvailable = true;

    function write(value: string): boolean {
      if (!outputAvailable) return false;
      try { return io.output.write(value); } catch {
        outputAvailable = false;
        finish(2);
        return false;
      }
    }

    function finish(code: number, message = '') {
      if (closed) return;
      closed = true;
      io.input.removeListener('keypress', onKey);
      io.input.removeListener('end', onEnd);
      io.input.removeListener('close', onEnd);
      io.input.removeListener('error', onError);
      io.output.removeListener('error', onOutputError);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      if (rawChanged) {
        try { io.input.setRawMode(wasRaw); } catch { /* The terminal may have closed. */ }
      }
      if (wasFlowing !== true) io.input.pause();
      write(`\u001b[?25h${message ? `\n${message}\n` : '\n'}`);
      resolve(code);
    }

    function render() {
      if (closed) return;
      const lines = [
        'Monolith',
        'Local analysis and a browser lab launcher',
        '',
        ...actions.map((action, index) => `${index === selected ? '>' : ' '} ${index + 1}. ${action.label}`),
        '',
      ];
      if (busy) lines.push('Working... Esc or Ctrl-C cancels this terminal session.');
      else if (prompt) {
        lines.push(selected === 3 ? 'Enter the configured dashboard URL.' : 'Enter the local file path.');
        lines.push(`Input hidden (${entry.length} characters). Enter runs; Esc returns to the menu.`);
      } else lines.push('Arrows or j/k select; Enter runs; 1-4 select; ? help; q/Esc quit.');
      if (help) lines.push(
        '',
        'Doctor, check and report operate locally. The lab opens in your browser.',
        'Protected reads stay in the browser through its verified worker or fail closed.',
        'Opening the lab does not execute or prove a successful private run.',
        'Reports retain their evidence labels. Viewing is not evidence verification.',
        'Input paths and URLs are not echoed. Ctrl-C exits with code 130.',
      );
      if (lastResult) lines.push('', 'Last result:', lastResult);
      write(`\u001b[2J\u001b[H${lines.join('\n')}\n`);
    }

    async function dispatch() {
      if (closed || busy) return;
      const action = actions[selected];
      if (!action) return;
      const argv: string[] = [...action.args];
      if (selected !== 0) {
        if (!entry.trim()) { lastResult = 'A file path or dashboard URL is required.'; render(); return; }
        argv.push(entry);
      }
      entry = '';
      prompt = false;
      busy = true;
      render();
      try {
        const result = await execute(argv);
        if (!closed) {
          const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
          lastResult = `Exit code: ${result.exitCode}\n${terminalText(text)}`;
        }
      } catch {
        if (!closed) lastResult = 'Command failed. No private run or successful analysis is implied.';
      } finally {
        busy = false;
        render();
      }
    }

    function onKey(text: string | undefined, key: Key = {}) {
      if (closed) return;
      if (key.ctrl && key.name === 'c') { finish(130); return; }
      if (busy) {
        if (key.name === 'escape') finish(130);
        return;
      }
      if (prompt) {
        if (key.name === 'escape') { prompt = false; entry = ''; render(); return; }
        if (key.name === 'return') { void dispatch(); return; }
        if (key.name === 'backspace') { entry = Array.from(entry).slice(0, -1).join(''); render(); return; }
        if (!key.ctrl && text && Array.from(text).every(printable)) {
          if (entry.length + text.length <= 4096) entry += text;
          else lastResult = 'Input is limited to 4096 characters.';
          render();
        }
        return;
      }
      if (key.name === 'escape' || text === 'q') { finish(0); return; }
      if (text === '?') { help = !help; render(); return; }
      if (key.name === 'up' || text === 'k') selected = (selected + actions.length - 1) % actions.length;
      else if (key.name === 'down' || text === 'j') selected = (selected + 1) % actions.length;
      else if (text && /^[1-4]$/u.test(text)) selected = Number(text) - 1;
      else if (key.name === 'return') {
        if (selected === 0) void dispatch();
        else { prompt = true; entry = ''; render(); }
        return;
      }
      render();
    }

    const onEnd = () => finish(0);
    const onError = () => finish(2, 'Terminal input became unavailable.');
    const onOutputError = () => { outputAvailable = false; finish(2); };
    const onInterrupt = () => finish(130);
    const onTerminate = () => finish(143);
    try {
      emitKeypressEvents(io.input);
      io.input.on('keypress', onKey);
      io.input.once('end', onEnd);
      io.input.once('close', onEnd);
      io.input.once('error', onError);
      io.output.once('error', onOutputError);
      process.once('SIGINT', onInterrupt);
      process.once('SIGTERM', onTerminate);
      io.input.setRawMode(true);
      rawChanged = true;
      io.input.resume();
      write('\u001b[?25l');
      render();
    } catch {
      finish(2, 'Interactive terminal could not be initialized.');
    }
  });
}
