import { startShimServer } from './server';
import { initializeServices } from '../effect/services';
import { setServices } from '../effect/bridge/services-instance';

export async function runShim(): Promise<void> {
  // Initialize services for shim mode
  const services = await initializeServices({ mode: 'shim' });
  if (services instanceof Error) {
    throw new Error(`Failed to initialize services: ${services.message}`);
  }
  setServices(services);

  const serverResult = await startShimServer();
  if (serverResult instanceof Error) {
    throw new Error(`Failed to start shim server: ${serverResult.message}`);
  }
  const server = serverResult;

  const cleanup = () => {
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

if (import.meta.main) {
  runShim().catch((error) => {
    console.error('Failed to start shim:', error);
    process.exit(1);
  });
}
