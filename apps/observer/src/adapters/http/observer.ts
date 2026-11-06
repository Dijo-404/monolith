import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { identifierSchema, makeError } from '@monolith/shared';
import { getDiagnostics } from '../../application/get-diagnostics.js';
import { createObserveRead, requestId, rpcFailure } from '../../application/observe-read.js';
import type { DiagnosticsStore } from '../../domain/diagnostics.js';
import type { SourcePolicy } from '../../domain/ports.js';
import { resolvePeer } from './peer.js';

export function registerObserver(server: FastifyInstance, options: {
  observe: ReturnType<typeof createObserveRead>;
  diagnostics: DiagnosticsStore;
  sourcePolicy: SourcePolicy;
  nowMs: () => number;
  requestsPerMinute: number;
  maxConcurrent: number;
}) {
  let windowStarted = options.nowMs();
  let accepted = 0;
  let concurrent = 0;
  const shutdown = new AbortController();
  server.addHook('onClose', async () => { shutdown.abort(); options.diagnostics.clear(); });
  server.addHook('preClose', async () => { shutdown.abort(); });
  server.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path === '/api/observer/read' || path?.startsWith('/api/observer/runs/')) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cache-Control', 'no-store');
    }
  });
  const preflight = (method: string) => async (request: FastifyRequest, reply: FastifyReply) => {
    const requestedMethod = request.headers['access-control-request-method'];
    const requestedHeaders = request.headers['access-control-request-headers'];
    if (requestedMethod !== method || typeof requestedHeaders !== 'undefined' && (
      typeof requestedHeaders !== 'string' || requestedHeaders.length > 256
      || requestedHeaders.split(',').some((header) => !['content-type', 'x-monolith-run', 'x-monolith-case'].includes(header.trim().toLowerCase()))
    )) return reply.code(403).send({ schemaVersion: 1, ok: false, error: makeError('POLICY_DENIED') });
    return reply.header('Access-Control-Allow-Methods', method)
      .header('Access-Control-Allow-Headers', 'content-type,x-monolith-run,x-monolith-case').code(204).send();
  };
  server.options('/api/observer/read', preflight('POST'));
  server.options('/api/observer/runs/:runId', preflight('GET'));
  server.post('/api/observer/read', async (request, reply) => {
    const id = requestId(request.body);
    const fail = (code: Parameters<typeof rpcFailure>[1], status: number) => {
      const result = rpcFailure(id, code, status);
      return reply.code(result.statusCode).send(result.body);
    };
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).length !== 1 || typeof query['endpointId'] !== 'string'
      || !identifierSchema.safeParse(query['endpointId']).success) return fail('INVALID_INPUT', 400);
    const runId = request.headers['x-monolith-run'];
    const caseLabel = request.headers['x-monolith-case'];
    const countHeader = (header: string) => request.raw.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === header).length;
    if (runId !== undefined && (typeof runId !== 'string' || countHeader('x-monolith-run') !== 1)
      || caseLabel !== undefined && (typeof caseLabel !== 'string' || !['baseline', 'protected', 'outage'].includes(caseLabel)
        || countHeader('x-monolith-case') !== 1)) return fail('INVALID_INPUT', 400);
    const now = options.nowMs();
    if (now - windowStarted >= 60_000 || now < windowStarted) { windowStarted = now; accepted = 0; }
    if (accepted >= options.requestsPerMinute || concurrent >= options.maxConcurrent) return fail('RATE_LIMITED', 429);
    accepted++;
    concurrent++;
    const client = new AbortController();
    const aborted = () => client.abort();
    const closed = () => { if (!reply.raw.writableFinished) client.abort(); };
    request.raw.once('aborted', aborted);
    reply.raw.once('close', closed);
    // Fastify 5.12.8 aborts request.signal on IncomingMessage 'close', including
    // normal completed POST bodies. Own this deadline to distinguish disconnects.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 10_000);
    timer.unref();
    const signal = AbortSignal.any([deadline.signal, shutdown.signal, client.signal]);
    const peer = resolvePeer(options.sourcePolicy, request.raw.socket.remoteAddress, request.raw.rawHeaders);
    try {
      const result = await options.observe(query['endpointId'], request.body, {
        ...(runId === undefined ? {} : { runId }), ...(peer === undefined ? {} : { peer }), signal,
      });
      return reply.code(result.statusCode).send(result.body);
    } finally {
      concurrent--;
      clearTimeout(timer);
      request.raw.removeListener('aborted', aborted);
      reply.raw.removeListener('close', closed);
    }
  });
  server.get('/api/observer/runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const result = getDiagnostics(options.diagnostics, runId);
    return reply.code(result.statusCode).send(result.body);
  });
}
