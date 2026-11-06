import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Operator-only signing boundary; the key must resolve outside this checkout. */
export async function loadImporterSigningKey(checkoutRoot: string): Promise<string> {
  const file = process.env['ARKIV_PUBLISHER_KEY_FILE'];
  if (!file || process.env['DEBUG']) throw new Error('SIGNER_CONFIGURATION_INVALID');
  const path = await realpath(resolve(file));
  const within = relative(await realpath(checkoutRoot), path);
  const outside = within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within);
  if (!outside) throw new Error('KEY_MUST_BE_OUTSIDE_CHECKOUT');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 128 || metadata.mode & 0o077
      || typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error('KEY_PERMISSIONS_INVALID');
    const key = (await handle.readFile('utf8')).trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('SIGNER_CONFIGURATION_INVALID');
    return key;
  } finally { await handle.close(); }
}
