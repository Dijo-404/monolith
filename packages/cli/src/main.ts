import { commandError, executeCommand } from './commands.js';
import { nodeContext } from './node.js';
import { runTui } from './tui.js';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const context = nodeContext();
  if ((argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY) || argv[0] === 'tui') {
    if (argv.length > 1) {
      const result = commandError('tui', 'INVALID_INPUT', argv.includes('--json'));
      process.stdout.write(result.stdout); process.stderr.write(result.stderr);
      return result.exitCode;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      const result = commandError('tui', 'TTY_REQUIRED', false);
      process.stderr.write(result.stderr);
      return result.exitCode;
    }
    return runTui({ input: process.stdin, output: process.stdout }, (args) => executeCommand(args, context));
  }
  const result = await executeCommand(argv, context);
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  return result.exitCode;
}

main().then((code) => { process.exitCode = code; }).catch(() => {
  process.stderr.write('The command could not complete.\n');
  process.exitCode = 2;
});
