import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OBSERVER_URL,
  parsePublicEnv,
  publicEnvDefinitions,
} from '../src/config/public-env.js';

describe('public dashboard environment', () => {
  it('uses a local observer origin when none is configured', () => {
    expect(parsePublicEnv({})).toEqual({ observerUrl: DEFAULT_OBSERVER_URL });
  });

  it('normalizes an explicitly configured origin', () => {
    expect(parsePublicEnv({ MONOLITH_PUBLIC_OBSERVER_URL: 'https://observer.example/' })).toEqual({
      observerUrl: 'https://observer.example',
    });
  });

  it.each([
    '',
    'not a url',
    'ftp://observer.example',
    'javascript:alert(1)',
    'https://user:password@observer.example',
    'https://observer.example/api',
    'https://observer.example/?token=secret',
    'https://observer.example/#secret',
    ' https://observer.example',
    3001,
  ])('rejects an invalid observer origin without echoing its value', (value) => {
    expect(() => parsePublicEnv({ MONOLITH_PUBLIC_OBSERVER_URL: value })).toThrow(
      'MONOLITH_PUBLIC_OBSERVER_URL must be an HTTP(S) origin without credentials, path, query or fragment.',
    );
  });

  it('ignores server and unknown public keys', () => {
    const config = parsePublicEnv({
      MONOLITH_RELAYER_PRIVATE_KEY: 'server-sentinel',
      MONOLITH_PUBLIC_PRIVATE_KEY: 'public-prefix-sentinel',
      VITE_PRIVATE_KEY: 'vite-prefix-sentinel',
    });

    expect(config).toEqual({ observerUrl: DEFAULT_OBSERVER_URL });
    expect(Object.keys(config)).toEqual(['observerUrl']);
  });

  it('defines only the allowlisted browser variable', () => {
    const definitions = publicEnvDefinitions({
      MONOLITH_PUBLIC_OBSERVER_URL: 'https://observer.example',
      MONOLITH_RELAYER_PRIVATE_KEY: 'server-sentinel',
      MONOLITH_PUBLIC_PRIVATE_KEY: 'public-prefix-sentinel',
      VITE_PRIVATE_KEY: 'vite-prefix-sentinel',
    });

    expect(definitions).toEqual({
      'import.meta.env.MONOLITH_PUBLIC_OBSERVER_URL': '"https://observer.example"',
    });
    expect(JSON.stringify(definitions)).not.toContain('sentinel');
  });
});
