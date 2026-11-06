import { describe, expect, it } from 'vitest';

import { parseObserverEnv } from '../src/composition/env.js';

describe('observer environment', () => {
  it('uses loopback defaults without reading unrelated environment values', () => {
    expect(parseObserverEnv({ OPERATOR_PRIVATE_KEY: 'do-not-retain-this' })).toEqual({
      host: '127.0.0.1',
      port: 3001,
      nodeEnv: 'development',
    });
  });

  it.each(['127.0.0.1', '0.0.0.0', '::1', '::', 'localhost'])(
    'accepts an explicitly configured binding %s',
    (host) => {
      expect(
        parseObserverEnv({
          MONOLITH_OBSERVER_HOST: host,
          MONOLITH_OBSERVER_PORT: '65535',
          NODE_ENV: 'production',
        }),
      ).toEqual({ host, port: 65535, nodeEnv: 'production' });
    },
  );

  it.each(['', 'https://rpc.example', '127.0.0.1:3001', 'secret-host-value', ' 127.0.0.1'])(
    'rejects invalid binding %j without echoing its value',
    (host) => {
      expect(() => parseObserverEnv({ MONOLITH_OBSERVER_HOST: host })).toThrow(
        'MONOLITH_OBSERVER_HOST must be an IP address or localhost.',
      );
    },
  );

  it.each(['', '0', '-1', '65536', '3.5', '3001x', '1e3', ' 3001', '03001'])(
    'rejects invalid port %j',
    (port) => {
      expect(() => parseObserverEnv({ MONOLITH_OBSERVER_PORT: port })).toThrow(
        'MONOLITH_OBSERVER_PORT must be an integer from 1 to 65535.',
      );
    },
  );

  it('accepts the lowest valid port and test mode', () => {
    expect(parseObserverEnv({ MONOLITH_OBSERVER_PORT: '1', NODE_ENV: 'test' })).toEqual({
      host: '127.0.0.1',
      port: 1,
      nodeEnv: 'test',
    });
  });

  it('rejects unsupported NODE_ENV values with a fixed error message', () => {
    expect(() => parseObserverEnv({ NODE_ENV: 'private-environment-value' })).toThrow(
      'NODE_ENV must be development, test, or production.',
    );
  });
});
