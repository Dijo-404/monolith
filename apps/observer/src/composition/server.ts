import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { makeError } from '@monolith/shared';
import type { RegistryQuery } from '@monolith/registry';
import { createObserveRead, requestId, rpcFailure } from '../application/observe-read.js';
import { createLabRun } from '../application/create-lab-run.js';
import { DiagnosticsStore } from '../domain/diagnostics.js';
import { endpointMap } from '../domain/observer-policy.js';
import type { ObserverConfig, UpstreamReader } from '../domain/ports.js';
import { normalizePeer } from '../adapters/http/peer.js';
import { registerObserver } from '../adapters/http/observer.js';
import { registerRegistry } from '../adapters/http/registry.js';
import { createUpstreamReader } from '../adapters/upstream/https-reader.js';

export type ObserverServerOptions = {
  config?: ObserverConfig;
  upstream?: UpstreamReader;
  nowMs?: () => number;
  requestsPerMinute?: number;
  maxConcurrent?: number;
  registry?: RegistryQuery;
  /** Explicit opt-in; allocation conveys no source or anonymity success claim. */
  publicLabRuns?: boolean;
};

export function buildServer(options: ObserverServerOptions = {}) {
  const config = options.config ?? { endpoints: [], sourcePolicy: { mode: 'unknown', trustedProxies: [] }, labRuns: [] };
  const sourcePolicy = { ...config.sourcePolicy, trustedProxies: [...config.sourcePolicy.trustedProxies] };
  const requestsPerMinute = options.requestsPerMinute ?? 60;
  const maxConcurrent = options.maxConcurrent ?? 16;
  if (!['unknown', 'direct', 'trusted-proxy'].includes(sourcePolicy.mode)
    || sourcePolicy.trustedProxies.length > 32 || sourcePolicy.trustedProxies.some((peer) => !normalizePeer(peer))
    || sourcePolicy.mode === 'trusted-proxy' && sourcePolicy.trustedProxies.length === 0
    || !Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 10_000
    || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 128
    || options.publicLabRuns !== undefined && typeof options.publicLabRuns !== 'boolean') throw new Error('Invalid observer configuration.');
  const endpoints = endpointMap(config.endpoints);
  const nowMs = options.nowMs ?? Date.now;
  const diagnostics = new DiagnosticsStore({ nowMs, scheduleExpiry: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  } });
  if (config.labRuns.length > 128) throw new Error('Invalid observer configuration.');
  for (const run of config.labRuns) {
    if (!diagnostics.register(run.runId, run.baselineRpcId).ok) throw new Error('Invalid observer configuration.');
  }
  const server = Fastify({
    logger: false, trustProxy: false, requestIdHeader: false, bodyLimit: 16 * 1024,
    requestTimeout: 10_000, connectionTimeout: 10_000, handlerTimeout: 10_000,
    routerOptions: { maxParamLength: 128 },
  });
  // Never serialize framework exceptions, submitted URLs, headers or request bodies.
  server.setErrorHandler((error, request, reply) => {
    const failure = error as { statusCode?: number; code?: string };
    const status = failure.statusCode === 413 ? 413 : failure.statusCode === 415 ? 415
      : failure.code === 'FST_ERR_HANDLER_TIMEOUT' ? 504 : 400;
    if (request.url.split('?')[0] === '/api/observer/read') {
      const result = rpcFailure(requestId(request.body), status === 504 ? 'UPSTREAM_TIMEOUT' : 'INVALID_INPUT', status);
      void reply.code(status).send(result.body);
    } else {
      void reply.code(status).send({ schemaVersion: 1, ok: false, error: makeError('INVALID_INPUT') });
    }
  });
  server.setNotFoundHandler((_request, reply) => reply.code(404).send({
    schemaVersion: 1, ok: false, error: makeError('TARGET_DENIED'),
  }));
  server.get('/api/health', () => ({
    schemaVersion: 1, ok: true,
    value: { service: 'observer', status: endpoints.size ? 'configured' : 'scaffold' },
  }));
  registerObserver(server, {
    observe: createObserveRead({ endpoints, diagnostics, nowMs, upstream: options.upstream ?? createUpstreamReader() }),
    diagnostics, sourcePolicy, nowMs, requestsPerMinute, maxConcurrent,
    ...(options.publicLabRuns === true ? { allocateRun: createLabRun({ diagnostics, nowMs, uuid: randomUUID }) } : {}),
  });
  registerRegistry(server, {
    registry: options.registry ?? { query: async () => ({ ok: false, error: makeError('REGISTRY_UNAVAILABLE') }) },
    nowMs, requestsPerMinute, maxConcurrent,
  });
  return server;
}
