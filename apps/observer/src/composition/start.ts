import { parseObserverConfig, parseObserverEnv } from './env.js';
import { buildServer } from './server.js';

async function startObserver() {
  const { host, port } = parseObserverEnv(process.env);
  const server = buildServer({ config: parseObserverConfig(process.env) });

  const shutdown = () => {
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await server.listen({ host, port });
    console.info('Monolith observer is listening.');
  } catch (error) {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await server.close();
    throw error;
  }
}

void startObserver().catch(() => {
  // Underlying errors can contain environment values or deployment details.
  console.error('Observer could not start. Check its environment and port availability.');
  process.exitCode = 1;
});
