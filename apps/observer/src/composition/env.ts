import { isIP } from 'node:net';

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
