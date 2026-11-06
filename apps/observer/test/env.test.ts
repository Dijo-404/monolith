import { describe, expect, it } from 'vitest';

import { parseObserverConfig, parseObserverEnv } from '../src/composition/env.js';

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

const endpoint = {
  endpointId: 'ethereum-demo',
  chainId: '1',
  rpcUrl: 'https://rpc.example.invalid',
  calls: [{ to: '0x1111111111111111111111111111111111111111', selector: '0x70a08231', dataBytes: 36 }],
};
const labRun = {
  runId: 'run-7b9377ea-cb1b-4b12-a8ca-ded37e8b66f0',
  baselineRpcId: 'rpc-b54f28e1-a70a-467f-804c-e74f7c2d75e9',
};
const configurationError = 'Observer configuration is invalid.';

describe('observer operator configuration', () => {
  it('defaults to no destinations, no runs and unknown source topology', () => {
    expect(parseObserverConfig({ OPERATOR_PRIVATE_KEY: 'do-not-retain-this' })).toEqual({
      endpoints: [],
      sourcePolicy: { mode: 'unknown', trustedProxies: [] },
      labRuns: [],
    });
  });

  it('projects validated endpoints and synthetic lab registrations only', () => {
    const configuration = parseObserverConfig({
      MONOLITH_OBSERVER_ENDPOINTS: JSON.stringify([endpoint]),
      MONOLITH_OBSERVER_SOURCE_MODE: 'direct',
      MONOLITH_OBSERVER_LAB_RUNS: JSON.stringify([labRun]),
      OPERATOR_PRIVATE_KEY: 'do-not-retain-this',
      MONOLITH_PUBLIC_EXTRA: 'do-not-retain-this',
    });
    expect(configuration).toEqual({
      endpoints: [endpoint],
      sourcePolicy: { mode: 'direct', trustedProxies: [] },
      labRuns: [labRun],
    });
    expect(JSON.stringify(configuration)).not.toContain('do-not-retain-this');
  });

  it('requires explicit edge IPs for proxy mode and accepts IPv4/IPv6 peers', () => {
    expect(parseObserverConfig({
      MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy',
      MONOLITH_OBSERVER_TRUSTED_PROXIES: '127.0.0.1, ::1, ::ffff:192.0.2.10',
    }).sourcePolicy).toEqual({
      mode: 'trusted-proxy', trustedProxies: ['127.0.0.1', '::1', '::ffff:192.0.2.10'],
    });
  });

  it.each([
    { MONOLITH_OBSERVER_SOURCE_MODE: 'true' },
    { MONOLITH_OBSERVER_SOURCE_MODE: '' },
    { MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy' },
    { MONOLITH_OBSERVER_TRUSTED_PROXIES: '127.0.0.1' },
    { MONOLITH_OBSERVER_SOURCE_MODE: 'direct', MONOLITH_OBSERVER_TRUSTED_PROXIES: '127.0.0.1' },
    { MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy', MONOLITH_OBSERVER_TRUSTED_PROXIES: '*' },
    { MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy', MONOLITH_OBSERVER_TRUSTED_PROXIES: '10.0.0.0/8' },
    { MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy', MONOLITH_OBSERVER_TRUSTED_PROXIES: 'localhost' },
    { MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy', MONOLITH_OBSERVER_TRUSTED_PROXIES: '127.0.0.1:3001' },
    { MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy', MONOLITH_OBSERVER_TRUSTED_PROXIES: '127.0.0.1,' },
    { MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy', MONOLITH_OBSERVER_TRUSTED_PROXIES: '127.0.0.1,127.0.0.1' },
    { MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy', MONOLITH_OBSERVER_TRUSTED_PROXIES: 'fe80::1%eth0' },
  ])('rejects ambiguous or blanket proxy trust %#', (input) => {
    expect(() => parseObserverConfig(input)).toThrow(configurationError);
  });

  it.each([
    '{', 'null', '{}', '[null]',
    JSON.stringify([{ ...endpoint, rpcUrl: 'https://127.0.0.1' }]),
    JSON.stringify([{ ...endpoint, rpcUrl: 'https://localhost' }]),
    JSON.stringify([{ ...endpoint, rpcUrl: 'http://rpc.example.invalid' }]),
    JSON.stringify([{ ...endpoint, rpcUrl: 'https://username:password@rpc.example.invalid' }]),
    JSON.stringify([{ ...endpoint, rpcUrl: 'https://rpc.example.invalid/${API_KEY}' }]),
    JSON.stringify([{ ...endpoint, rpcUrl: 'https://rpc.example.invalid:8443' }]),
    JSON.stringify([{ ...endpoint, chainId: '0x1' }]),
    JSON.stringify([{ ...endpoint, chainId: '01' }]),
    JSON.stringify([{ ...endpoint, endpointId: 'wallet@example.invalid' }]),
    JSON.stringify([{ ...endpoint, headers: { authorization: 'secret' } }]),
    JSON.stringify([{ ...endpoint, calls: undefined }]),
    JSON.stringify([endpoint, endpoint]),
  ])('rejects malformed, unsafe or ambiguous destinations %#', (value) => {
    expect(() => parseObserverConfig({ MONOLITH_OBSERVER_ENDPOINTS: value })).toThrow(configurationError);
  });

  it.each([
    { to: 'not-an-address', selector: '0x70a08231', dataBytes: 36 },
    { to: endpoint.calls[0]!.to, selector: '0x70a082', dataBytes: 36 },
    { to: endpoint.calls[0]!.to, selector: '0x70a08231', dataBytes: 3 },
    { to: endpoint.calls[0]!.to, selector: '0x70a08231', dataBytes: 4097 },
    { to: endpoint.calls[0]!.to, selector: '0x70a08231', dataBytes: 36.5 },
    { to: endpoint.calls[0]!.to, selector: '0x70a08231', dataBytes: '36' },
    { ...endpoint.calls[0]!, value: '0x0' },
  ])('rejects invalid or extended call rules %#', (call) => {
    expect(() => parseObserverConfig({
      MONOLITH_OBSERVER_ENDPOINTS: JSON.stringify([{ ...endpoint, calls: [call] }]),
    })).toThrow(configurationError);
  });

  it('rejects duplicate calls even when their target or selector uses different hex case', () => {
    const call = { ...endpoint.calls[0]!, selector: '0xAbCdEf01' };
    expect(() => parseObserverConfig({
      MONOLITH_OBSERVER_ENDPOINTS: JSON.stringify([{ ...endpoint, calls: [call, { ...call, selector: '0xabcdef01' }] }]),
    })).toThrow(configurationError);
  });

  it.each([
    'null', '{}', '[null]',
    JSON.stringify([{ ...labRun, runId: 'run-stable-user-identifier' }]),
    JSON.stringify([{ ...labRun, baselineRpcId: 'rpc-stable-order-identifier' }]),
    JSON.stringify([{ ...labRun, baselineRpcId: 'rpc-b54f28e1-a70a-167f-804c-e74f7c2d75e9' }]),
    JSON.stringify([{ ...labRun, baselineRpcId: 'rpc-b54f28e1-a70a-467f-004c-e74f7c2d75e9' }]),
    JSON.stringify([{ ...labRun, route: 'anon-nym' }]),
    JSON.stringify([labRun, labRun]),
    JSON.stringify([labRun, { ...labRun, runId: 'run-cb8f9375-ccec-44ba-b5a2-0fb5d2f1a346' }]),
  ])('rejects nonsynthetic, duplicate or extended run registration %#', (value) => {
    expect(() => parseObserverConfig({ MONOLITH_OBSERVER_LAB_RUNS: value })).toThrow(configurationError);
  });

  it('bounds operator arrays and total UTF-8 configuration bytes', () => {
    for (const input of [
      { MONOLITH_OBSERVER_ENDPOINTS: JSON.stringify(Array(65).fill(endpoint)) },
      { MONOLITH_OBSERVER_ENDPOINTS: JSON.stringify([{ ...endpoint, calls: Array(65).fill(endpoint.calls[0]) }]) },
      { MONOLITH_OBSERVER_LAB_RUNS: JSON.stringify(Array(129).fill(labRun)) },
      { MONOLITH_OBSERVER_SOURCE_MODE: 'trusted-proxy', MONOLITH_OBSERVER_TRUSTED_PROXIES: Array(33).fill('127.0.0.1').join(',') },
      { MONOLITH_OBSERVER_ENDPOINTS: `${' '.repeat(65_537)}[]` },
      { MONOLITH_OBSERVER_ENDPOINTS: JSON.stringify(['é'.repeat(32_769)]) },
    ]) {
      expect(() => parseObserverConfig(input)).toThrow(configurationError);
    }
  });

  it('does not expose endpoint credentials or malformed JSON in startup failures', () => {
    const input = { MONOLITH_OBSERVER_ENDPOINTS: '["https://secret:credential@rpc.example.invalid"' };
    try {
      parseObserverConfig(input);
      expect.fail('Expected configuration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(configurationError);
      expect(String(error)).not.toContain('credential');
    }
  });
});
