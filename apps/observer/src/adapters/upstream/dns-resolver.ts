import { Resolver } from 'node:dns/promises';

/** Adapter-local test seam. Each read receives a separate cancellable DNS resolver. */
export interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  cancel(): void;
}

export type ResolvedAddress = { address: string; family: number };

export async function resolveHost(
  hostname: string,
  signal?: AbortSignal,
  createResolver: () => DnsResolver = () => new Resolver(),
): Promise<readonly ResolvedAddress[]> {
  if (signal?.aborted) throw new Error('Destination lookup was cancelled.');
  const resolver = createResolver();
  let cancelled = false;
  let completed = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    resolver.cancel();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const query = async (family: 4 | 6): Promise<ResolvedAddress[]> => {
    if (signal?.aborted) throw new Error('Destination lookup was cancelled.');
    try {
      const addresses = await (family === 4 ? resolver.resolve4(hostname) : resolver.resolve6(hostname));
      return addresses.map((address) => ({ address, family }));
    } catch (error) {
      // A missing A/AAAA family is allowed; failure to check a family is not.
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENODATA') return [];
      throw error;
    }
  };
  try {
    const [ipv4, ipv6] = await Promise.all([query(4), query(6)]);
    if (signal?.aborted) throw new Error('Destination lookup was cancelled.');
    completed = true;
    return [...ipv4, ...ipv6];
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!completed) cancel();
  }
}
