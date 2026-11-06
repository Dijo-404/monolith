import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { CommandContext } from './commands.js';

export const MAX_INPUT_BYTES = 1_048_576;

export async function readJson(file: string): Promise<unknown> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('Invalid file.');
    const bytes = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let used = 0;
    while (used < bytes.length) {
      const read = await handle.read(bytes, used, bytes.length - used, null);
      if (read.bytesRead === 0) break;
      used += read.bytesRead;
    }
    if (used > MAX_INPUT_BYTES) throw new Error('Input exceeds limit.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used))) as unknown;
  } finally { await handle.close(); }
}

export function openLab(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const executable = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const child = spawn(executable, args, { stdio: 'ignore', shell: false });
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(success);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      child.unref();
      finish(false);
    }, 5_000);
    child.once('error', () => finish(false));
    child.once('close', (code) => finish(code === 0));
  });
}

export function nodeContext(): CommandContext {
  const configuredLabUrl = process.env['MONOLITH_LAB_URL'];
  return {
    readJson, openLab, nodeVersion: process.versions.node,
    ...(configuredLabUrl === undefined ? {} : { configuredLabUrl }),
  };
}
