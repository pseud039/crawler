import '../env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { jobRoutes } from './routes/jobs.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(jobRoutes);

// Health check
app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

const PORT = parseInt(process.env.API_PORT ?? '3000');

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[api] listening on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
