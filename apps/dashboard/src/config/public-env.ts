export const DEFAULT_OBSERVER_URL = 'http://127.0.0.1:3001';

export type PublicConfig = Readonly<{
  observerUrl: string;
}>;

const INVALID_OBSERVER_URL =
  'MONOLITH_PUBLIC_OBSERVER_URL must be an HTTP(S) origin without credentials, path, query or fragment.';

/** Project only documented browser configuration; never return the input environment. */
export function parsePublicEnv(input: Readonly<Record<string, unknown>>): PublicConfig {
  const value = input['MONOLITH_PUBLIC_OBSERVER_URL'] ?? DEFAULT_OBSERVER_URL;

  if (typeof value !== 'string' || value !== value.trim()) {
    throw new Error(INVALID_OBSERVER_URL);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(INVALID_OBSERVER_URL);
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(INVALID_OBSERVER_URL);
  }

  return Object.freeze({ observerUrl: url.origin });
}

/** Exact replacements keep similarly prefixed or server-only values out of the bundle. */
export function publicEnvDefinitions(input: Readonly<Record<string, unknown>>) {
  const config = parsePublicEnv(input);

  return {
    'import.meta.env.MONOLITH_PUBLIC_OBSERVER_URL': JSON.stringify(config.observerUrl),
  };
}
