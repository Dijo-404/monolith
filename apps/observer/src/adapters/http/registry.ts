import type { FastifyInstance } from 'fastify';
import { makeError, validateRegistryManifest } from '@monolith/shared';
import type { ErrorCode, RegistryManifest, Result } from '@monolith/shared';
import type { RegistryQuery } from '@monolith/registry';

function failure(code: ErrorCode): Result<RegistryManifest> {
  return { ok: false, error: makeError(code) };
}

/** This route accepts public network identifiers only, never user-specific query inputs. */
export function registerRegistry(server: FastifyInstance, options: {
  registry: RegistryQuery;
  nowMs: () => number;
  requestsPerMinute: number;
  maxConcurrent: number;
  timeoutMs?: number;
}): void {
  const timeoutMs = options.timeoutMs ?? 9_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 9_000) {
    throw new Error('Invalid registry resource limits.');
  }
  let windowStarted = options.nowMs();
  let accepted = 0;
  let concurrent = 0;
  let closing = false;
  server.addHook('preClose', async () => { closing = true; });
  server.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/api/registry/chains') {
      reply.header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'no-store');
    }
  });
  server.options('/api/registry/chains', async (request, reply) => {
    const headers = request.headers['access-control-request-headers'];
    if (request.headers['access-control-request-method'] !== 'GET'
      || headers !== undefined && (typeof headers !== 'string' || headers.length > 128
        || headers.split(',').some((header) => header.trim().toLowerCase() !== 'content-type'))) {
      return reply.code(403).send({ schemaVersion: 1, ...failure('POLICY_DENIED') });
    }
    return reply.header('Access-Control-Allow-Methods', 'GET')
      .header('Access-Control-Allow-Headers', 'content-type').code(204).send();
  });
  server.get('/api/registry/chains', { exposeHeadRoute: false }, async (request, reply) => {
    // Check the original spelling, before a query parser can normalize duplicate,
    // encoded or nested parameters into a different apparent request.
    const match = /^\/api\/registry\/chains\?chainId=(0|[1-9][0-9]{0,77})$/.exec(request.url);
    const chainId = match?.[1];
    if (chainId === undefined) return reply.code(400).send({ schemaVersion: 1, ...failure('INVALID_INPUT') });
    const now = options.nowMs();
    if (!Number.isFinite(now) || closing) return reply.code(503).send({ schemaVersion: 1, ...failure('REGISTRY_UNAVAILABLE') });
    if (now < windowStarted || now - windowStarted >= 60_000) { accepted = 0; windowStarted = now; }
    if (accepted >= options.requestsPerMinute || concurrent >= options.maxConcurrent) {
      return reply.code(429).send({ schemaVersion: 1, ...failure('RATE_LIMITED') });
    }
    accepted++;
    concurrent++;
    // An unresponsive injected service keeps its resource slot until it settles.
    // An HTTP deadline must not permit unlimited abandoned background operations.
    const operation = Promise.resolve().then(() => options.registry.query(chainId))
      .catch(() => failure('REGISTRY_UNAVAILABLE')).finally(() => { concurrent--; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([operation, new Promise<Result<RegistryManifest>>((resolve) => {
        timer = setTimeout(() => resolve(failure('REGISTRY_UNAVAILABLE')), timeoutMs);
      })]);
      if (closing) return reply.code(503).send({ schemaVersion: 1, ...failure('REGISTRY_UNAVAILABLE') });
      if (result.ok) {
        const validated = validateRegistryManifest(result.value, new Date(options.nowMs()).toISOString());
        if (!validated.ok || validated.value.endpoints.some((endpoint) => endpoint.chainId !== chainId)) {
          return reply.code(503).send({ schemaVersion: 1, ...failure('REGISTRY_UNAVAILABLE') });
        }
        return reply.code(200).send({ schemaVersion: 1, ...validated });
      }
      // Project only fixed shared errors. A service cannot export an SDK message,
      // URL, credential or arbitrary retry flag through an error response.
      const code = result.error.code;
      const status = code === 'REGISTRY_EXPIRED' ? 410 : code === 'REGISTRY_UNTRUSTED'
        || code === 'ENDPOINT_REJECTED' || code === 'TARGET_DENIED' || code === 'POLICY_DENIED' ? 403
        : code === 'RATE_LIMITED' ? 429 : 503;
      const safeCode = status === 503 ? 'REGISTRY_UNAVAILABLE' : code;
      return reply.code(status).send({ schemaVersion: 1, ...failure(safeCode) });
    } catch {
      return reply.code(503).send({ schemaVersion: 1, ...failure('REGISTRY_UNAVAILABLE') });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  });
}
