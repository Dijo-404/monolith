#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedRead } from './controller.mjs';
import { executeTrial, verifyEvidenceBundle } from './runner.mjs';
import { HarnessError, LIMITS } from './policy.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HELP = 'Run: node scripts/agent-harness/main.mjs run --mode simulated|live --output <new-directory> --browser-tools <directory> --allow-direct-regression [--patch <file>] [--worker-unavailable]\nVerify artifacts: node scripts/agent-harness/main.mjs verify --input <directory>\nExit: 0 accepted/verified, 1 acceptance failed, 2 invalid input, 3 execution unavailable, 130 cancelled.\n';
const lifetime = new AbortController();
const cancel = () => lifetime.abort();
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
let exitCode = 2;
try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.length === 1 && args[0] === '--help') {
    process.stdout.write(HELP); exitCode = 0;
  } else if (args[0] === 'verify' && args.length === 3 && args[1] === '--input') {
    await verifyEvidenceBundle(resolve(args[2]));
    process.stdout.write(JSON.stringify({ schemaVersion: 1, status: 'verified', evidenceAuthentication: false }) + '\n'); exitCode = 0;
  } else {
    if (args.shift() !== 'run') throw new HarnessError('INVALID_INPUT');
    const options = { repository, signal: lifetime.signal };
    const keys = { '--mode': 'mode', '--output': 'outputDirectory', '--patch': 'patchFile', '--browser-tools': 'browserTools' };
    const seen = new Set();
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (seen.has(key)) throw new HarnessError('INVALID_INPUT');
      seen.add(key);
      if (key === '--allow-direct-regression') options.allowDirectRegression = true;
      else if (key === '--worker-unavailable') options.workerUnavailable = true;
      else if (keys[key] && args[index + 1] && !args[index + 1].startsWith('--')) options[keys[key]] = args[++index];
      else throw new HarnessError('INVALID_INPUT');
    }
    if (options.patchFile) options.patch = new TextDecoder('utf-8', { fatal: true }).decode(await boundedRead(resolve(options.patchFile), LIMITS.patchBytes));
    const result = await executeTrial(options);
    process.stdout.write(JSON.stringify(result) + '\n'); exitCode = result.exitCode;
  }
} catch (error) {
  const code = error instanceof HarnessError ? error.code : 'INVALID_INPUT';
  process.stdout.write(JSON.stringify({ schemaVersion: 1, status: 'invalid', evidence: 'UNTESTED', errorCode: code }) + '\n');
} finally {
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); process.exitCode = exitCode;
}
