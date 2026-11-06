import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import {
  jsonRpcRequestSchema,
  makeError,
  publicHttpsUrlSchema,
  validateRpcResponse,
} from '@monolith/shared';
import type { ErrorCode, JsonRpcRequest, JsonRpcSuccess, Result } from '@monolith/shared';
import type { ObserverEndpoint, UpstreamReader } from '../../domain/ports.js';
import { isPublicAddress } from './public-address.js';
import { resolveHost } from './dns-resolver.js';
import type { DnsResolver, ResolvedAddress } from './dns-resolver.js';
export type { DnsResolver, ResolvedAddress } from './dns-resolver.js';

export type UpstreamReaderOptions = {
  resolve?: (hostname: string, signal?: AbortSignal) => Promise<readonly ResolvedAddress[]>;
  resolverFactory?: () => DnsResolver;
  request?: (options: RequestOptions, onResponse: (response: IncomingMessage) => void) => ClientRequest;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REQUEST_BYTES = 16 * 1024;

function failure(code: ErrorCode): Result<JsonRpcSuccess> {
  return { ok: false, error: makeError(code) };
}

/** Server-only adapter; endpoint authorization/method policy precedes this port. */
export function createUpstreamReader(options: UpstreamReaderOptions = {}): UpstreamReader {
  const resolve = options.resolve ?? ((hostname: string, signal?: AbortSignal) => resolveHost(hostname, signal, options.resolverFactory));
  const request = options.request ?? ((settings, onResponse) => httpsRequest(settings, onResponse));
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) {
    throw new Error('Invalid upstream resource limits.');
  }

  return {
    async read(endpoint: ObserverEndpoint, input: JsonRpcRequest, outerSignal?: AbortSignal): Promise<Result<JsonRpcSuccess>> {
      const urlCheck = publicHttpsUrlSchema.safeParse(endpoint.rpcUrl);
      if (!urlCheck.success) return failure('TARGET_DENIED');
      const parsed = jsonRpcRequestSchema.safeParse(input);
      if (!parsed.success) return failure('INVALID_INPUT');
      const rpc = parsed.data;
      const body = JSON.stringify(rpc);
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) return failure('INVALID_INPUT');
      if (outerSignal?.aborted) return failure('UPSTREAM_UNAVAILABLE');
      const target = new URL(urlCheck.data);
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      outerSignal?.addEventListener('abort', cancel, { once: true });
      let stopWaiting: (() => void) | undefined;
      const aborted = new Promise<Result<JsonRpcSuccess>>((resolveAbort) => {
        stopWaiting = () => resolveAbort(failure(timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE'));
        controller.signal.addEventListener('abort', stopWaiting, { once: true });
      });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const operation = async (): Promise<Result<JsonRpcSuccess>> => {
          const addresses = await resolve(target.hostname, controller.signal);
          if (controller.signal.aborted) return failure(timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
          if (addresses.length === 0 || addresses.length > 64 || addresses.some((entry) => (
            ![4, 6].includes(entry.family) || isIP(entry.address) !== entry.family || !isPublicAddress(entry.address)
          ))) return failure('TARGET_DENIED');
          const selected = addresses[0];
          if (!selected) return failure('TARGET_DENIED');
          return await new Promise<Result<JsonRpcSuccess>>((resolveResponse) => {
            let pending: ClientRequest | undefined;
            let response: IncomingMessage | undefined;
            let complete = false;
            const finish = (result: Result<JsonRpcSuccess>) => {
              if (complete) return;
              complete = true;
              controller.signal.removeEventListener('abort', onAbort);
              resolveResponse(result);
              if (!result.ok) {
                response?.destroy();
                pending?.destroy();
              }
            };
            const destroy = () => {
              response?.destroy();
              pending?.destroy();
            };
            const onAbort = () => {
              finish(failure(timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE'));
              destroy();
            };
            controller.signal.addEventListener('abort', onAbort, { once: true });
            if (controller.signal.aborted) {
              onAbort();
              return;
            }
            try {
              pending = request({
                protocol: 'https:',
                hostname: target.hostname,
                port: 443,
                path: `${target.pathname}${target.search}`,
                method: 'POST',
                agent: false,
                family: selected.family,
                servername: target.hostname,
                rejectUnauthorized: true,
                signal: controller.signal,
                // Return only the already checked address; never invoke another resolver.
                lookup: (hostname, lookupOptions, callback) => {
                  if (controller.signal.aborted || hostname !== target.hostname) {
                    callback(new Error('Destination lookup was rejected.'), '', 0);
                  } else if (lookupOptions.all) {
                    callback(null, [selected]);
                  } else {
                    callback(null, selected.address, selected.family);
                  }
                },
                headers: {
                  'content-type': 'application/json',
                  accept: 'application/json',
                  'accept-encoding': 'identity',
                  'content-length': Buffer.byteLength(body),
                },
              }, (incoming) => {
                response = incoming;
                if (complete || controller.signal.aborted) {
                  incoming.destroy();
                  return;
                }
                incoming.on('error', () => finish(failure('UPSTREAM_UNAVAILABLE')));
                incoming.on('aborted', () => finish(failure('UPSTREAM_UNAVAILABLE')));
                if (!incoming.statusCode || incoming.statusCode < 200 || incoming.statusCode >= 300) {
                  finish(failure(incoming.statusCode === 429 ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE'));
                  destroy();
                  return;
                }
                const encoding = incoming.headers['content-encoding'];
                const contentType = incoming.headers['content-type'];
                const declared = incoming.headers['content-length'];
                if ((encoding !== undefined && encoding !== 'identity')
                  || typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(contentType)
                  || (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxResponseBytes))) {
                  finish(failure('RPC_RESPONSE_INVALID'));
                  destroy();
                  return;
                }
                let size = 0;
                const chunks: Buffer[] = [];
                incoming.on('data', (chunk: Buffer) => {
                  if (complete) return;
                  size += chunk.length;
                  if (size > maxResponseBytes) {
                    finish(failure('RPC_RESPONSE_INVALID'));
                    destroy();
                    return;
                  }
                  chunks.push(chunk);
                });
                incoming.on('end', () => {
                  if (complete) return;
                  if (controller.signal.aborted) {
                    onAbort();
                    return;
                  }
                  try {
                    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
                    finish(validateRpcResponse(decoded, rpc.id));
                  } catch {
                    finish(failure('RPC_RESPONSE_INVALID'));
                  }
                });
                incoming.on('close', () => {
                  if (!incoming.complete) finish(failure('UPSTREAM_UNAVAILABLE'));
                });
              });
              pending.on('error', () => finish(failure(controller.signal.aborted && timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE')));
              pending.end(body);
            } catch {
              finish(failure('UPSTREAM_UNAVAILABLE'));
              destroy();
            }
          });
        };
        return await Promise.race([operation().catch(() => failure('UPSTREAM_UNAVAILABLE')), aborted]);
      } finally {
        clearTimeout(timer);
        outerSignal?.removeEventListener('abort', cancel);
        if (stopWaiting) controller.signal.removeEventListener('abort', stopWaiting);
      }
    },
  };
}
