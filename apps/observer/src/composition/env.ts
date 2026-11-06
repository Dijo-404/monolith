import { isIP } from 'node:net';
import {
  addressSchema,
  chainIdSchema,
  identifierSchema,
  publicHttpsUrlSchema,
} from '@monolith/shared';

import type { CallRule, LabRun, ObserverConfig, ObserverEndpoint } from '../domain/ports.js';

export type ObserverEnv = {
  host: string;
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
};

/** Read only observer settings; never retain arbitrary process environment values. */
export function parseObserverEnv(
  input: Readonly<Record<string, string | undefined>>,
): ObserverEnv {
  const host = input['MONOLITH_OBSERVER_HOST'] ?? '127.0.0.1';
  if (host !== 'localhost' && isIP(host) === 0) {
    throw new Error('MONOLITH_OBSERVER_HOST must be an IP address or localhost.');
  }

  const rawPort = input['MONOLITH_OBSERVER_PORT'] ?? '3001';
  if (!/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65_535) {
    throw new Error('MONOLITH_OBSERVER_PORT must be an integer from 1 to 65535.');
  }

  const nodeEnv = input['NODE_ENV'] ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  return { host, port: Number(rawPort), nodeEnv };
}

const CONFIG_ERROR = 'Observer configuration is invalid.';
const CONFIG_KEYS = [
  'MONOLITH_OBSERVER_ENDPOINTS',
  'MONOLITH_OBSERVER_SOURCE_MODE',
  'MONOLITH_OBSERVER_TRUSTED_PROXIES',
  'MONOLITH_OBSERVER_LAB_RUNS',
] as const;
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const RUN_ID = new RegExp(`^run-${UUID_V4}$`, 'i');
const RPC_ID = new RegExp(`^rpc-${UUID_V4}$`, 'i');

function rejectConfig(): never {
  throw new Error(CONFIG_ERROR);
}

function exactObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) rejectConfig();
  if (Object.keys(input).length !== keys.length || !keys.every((key) => Object.hasOwn(input, key))) {
    rejectConfig();
  }
  return input as Record<string, unknown>;
}

function arrayValue(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || input.length > maximum) rejectConfig();
  return input;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function parseCall(input: unknown): CallRule {
  const value = exactObject(input, ['to', 'selector', 'dataBytes']);
  const to = addressSchema.safeParse(value['to']);
  const selector = value['selector'];
  const dataBytes = value['dataBytes'];
  if (!to.success || typeof selector !== 'string' || !/^0x[0-9a-fA-F]{8}$/.test(selector)
    || typeof dataBytes !== 'number' || !Number.isInteger(dataBytes) || dataBytes < 4 || dataBytes > 4_096) {
    rejectConfig();
  }
  return { to: to.data, selector, dataBytes };
}

function parseEndpoint(input: unknown): ObserverEndpoint {
  const value = exactObject(input, ['endpointId', 'chainId', 'rpcUrl', 'calls']);
  const endpointId = identifierSchema.safeParse(value['endpointId']);
  const chainId = chainIdSchema.safeParse(value['chainId']);
  const rpcUrl = publicHttpsUrlSchema.safeParse(value['rpcUrl']);
  if (!endpointId.success || !chainId.success || !rpcUrl.success) rejectConfig();
  const calls = arrayValue(value['calls'], 64).map(parseCall);
  const callKeys = calls.map((call) => `${call.to.toLowerCase()}:${call.selector.toLowerCase()}:${call.dataBytes}`);
  if (!unique(callKeys)) rejectConfig();
  return { endpointId: endpointId.data, chainId: chainId.data, rpcUrl: rpcUrl.data, calls };
}

function parseLabRun(input: unknown): LabRun {
  const value = exactObject(input, ['runId', 'baselineRpcId']);
  const runId = identifierSchema.safeParse(value['runId']);
  const baselineRpcId = identifierSchema.safeParse(value['baselineRpcId']);
  if (!runId.success || !baselineRpcId.success || !RUN_ID.test(runId.data) || !RPC_ID.test(baselineRpcId.data)) {
    rejectConfig();
  }
  return { runId: runId.data, baselineRpcId: baselineRpcId.data };
}

/** Project only approved operator configuration; never echo JSON or process environment on failure. */
export function parseObserverConfig(
  input: Readonly<Record<string, string | undefined>>,
): ObserverConfig {
  try {
    if (CONFIG_KEYS.reduce((bytes, key) => bytes + Buffer.byteLength(input[key] ?? '', 'utf8'), 0) > 64 * 1_024) {
      rejectConfig();
    }
    const endpoints = arrayValue(JSON.parse(input['MONOLITH_OBSERVER_ENDPOINTS'] ?? '[]'), 64).map(parseEndpoint);
    const labRuns = arrayValue(JSON.parse(input['MONOLITH_OBSERVER_LAB_RUNS'] ?? '[]'), 128).map(parseLabRun);
    if (!unique(endpoints.map(({ endpointId }) => endpointId))
      || !unique(labRuns.map(({ runId }) => runId.toLowerCase()))
      || !unique(labRuns.map(({ baselineRpcId }) => baselineRpcId.toLowerCase()))) rejectConfig();

    const mode = input['MONOLITH_OBSERVER_SOURCE_MODE'] ?? 'unknown';
    if (mode !== 'unknown' && mode !== 'direct' && mode !== 'trusted-proxy') rejectConfig();
    const proxyInput = input['MONOLITH_OBSERVER_TRUSTED_PROXIES'] ?? '';
    const trustedProxies = proxyInput === '' ? [] : proxyInput.split(',').map((value) => value.trim());
    if (trustedProxies.length > 32 || trustedProxies.some((value) => value.includes('%') || isIP(value) === 0)
      || !unique(trustedProxies.map((value) => value.toLowerCase()))) rejectConfig();
    if ((mode === 'trusted-proxy') !== (trustedProxies.length > 0)) rejectConfig();

    return { endpoints, sourcePolicy: { mode, trustedProxies }, labRuns };
  } catch {
    // JSON parser/validator errors may carry operator endpoint URLs or other submitted configuration.
    return rejectConfig();
  }
}
