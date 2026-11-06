import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line monolith/imports -- Test the CLI-local operator boundary; it is not a package dependency.
import { loadImporterSigningKey } from '../../../../scripts/importer-key-file.js';

// SIMULATED: fresh random bytes in temporary files; no wallet, network or real signer access.
describe('importer signing-file boundary (SIMULATED)', () => {
  let temporary: string;
  let checkout: string;
  let synthetic: string;

  beforeEach(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'monolith-importer-key-test-'));
    checkout = join(temporary, 'checkout');
    synthetic = `0x${randomBytes(32).toString('hex')}`;
    await mkdir(checkout);
    vi.stubEnv('DEBUG', undefined);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(temporary, { recursive: true, force: true });
  });

  async function keyFile(path: string, contents = synthetic): Promise<string> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents + '\n', { mode: 0o600 });
    vi.stubEnv('ARKIV_PUBLISHER_KEY_FILE', path);
    return path;
  }

  it.each(['publisher.key', 'nested/publisher.key', '..publisher.key', '..keys/publisher.key'])(
    'rejects an actual checkout file at %s', async (name) => {
      await keyFile(join(checkout, name));
      await expect(loadImporterSigningKey(checkout)).rejects.toThrow('KEY_MUST_BE_OUTSIDE_CHECKOUT');
    },
  );

  it('rejects the checkout itself', async () => {
    vi.stubEnv('ARKIV_PUBLISHER_KEY_FILE', checkout);
    await expect(loadImporterSigningKey(checkout)).rejects.toThrow('KEY_MUST_BE_OUTSIDE_CHECKOUT');
  });

  it('loads an owner-only external file and trims its newline', async () => {
    await keyFile(join(temporary, 'outside', 'publisher.key'));
    expect(await loadImporterSigningKey(checkout)).toBe(synthetic);
  });

  it('allows an internal symlink whose actual file is outside the checkout', async () => {
    const outside = await keyFile(join(temporary, 'outside.key'));
    const link = join(checkout, 'publisher-link.key');
    await symlink(outside, link);
    vi.stubEnv('ARKIV_PUBLISHER_KEY_FILE', link);
    expect(await loadImporterSigningKey(checkout)).toBe(synthetic);
  });

  it('rejects an external symlink whose actual file is inside the checkout', async () => {
    const inside = await keyFile(join(checkout, '..keys', 'publisher.key'));
    const link = join(temporary, 'external-link.key');
    await symlink(inside, link);
    vi.stubEnv('ARKIV_PUBLISHER_KEY_FILE', link);
    await expect(loadImporterSigningKey(checkout)).rejects.toThrow('KEY_MUST_BE_OUTSIDE_CHECKOUT');
  });

  it('canonicalizes the checkout root as well as the file', async () => {
    await keyFile(join(checkout, '..publisher.key'));
    const alias = join(temporary, 'checkout-alias');
    await symlink(checkout, alias);
    await expect(loadImporterSigningKey(alias)).rejects.toThrow('KEY_MUST_BE_OUTSIDE_CHECKOUT');
  });

  it.each([0o640, 0o606, 0o644])('rejects external file permissions %s', async (mode) => {
    const path = await keyFile(join(temporary, 'outside.key'));
    await chmod(path, mode);
    await expect(loadImporterSigningKey(checkout)).rejects.toThrow('KEY_PERMISSIONS_INVALID');
  });

  it('rejects a file not owned by the process user', async () => {
    await keyFile(join(temporary, 'outside.key'));
    const uid = process.getuid!();
    vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);
    await expect(loadImporterSigningKey(checkout)).rejects.toThrow('KEY_PERMISSIONS_INVALID');
  });

  it('rejects an external directory and oversized file', async () => {
    vi.stubEnv('ARKIV_PUBLISHER_KEY_FILE', temporary);
    await expect(loadImporterSigningKey(checkout)).rejects.toThrow('KEY_PERMISSIONS_INVALID');
    await keyFile(join(temporary, 'oversized.key'), 'x'.repeat(129));
    await expect(loadImporterSigningKey(checkout)).rejects.toThrow('KEY_PERMISSIONS_INVALID');
  });

  it('rejects malformed bytes, missing configuration and debug mode', async () => {
    await keyFile(join(temporary, 'invalid.key'), 'not a signing key');
    await expect(loadImporterSigningKey(checkout)).rejects.toThrow('SIGNER_CONFIGURATION_INVALID');
    vi.stubEnv('ARKIV_PUBLISHER_KEY_FILE', undefined);
    await expect(loadImporterSigningKey(checkout)).rejects.toThrow('SIGNER_CONFIGURATION_INVALID');
    await keyFile(join(temporary, 'valid.key'));
    vi.stubEnv('DEBUG', '*');
    await expect(loadImporterSigningKey(checkout)).rejects.toThrow('SIGNER_CONFIGURATION_INVALID');
  });
});
