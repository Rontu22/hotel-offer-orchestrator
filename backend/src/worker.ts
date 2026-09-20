import path from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NativeConnection, Worker } from '@temporalio/worker';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { HotelActivities, bindActivities } from './temporal/activities.js';

/**
 * Separate process from the API: the worker scales on workflow load, the API on
 * request load. Nest is booted headless purely to wire the activities' deps.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const connection = await NativeConnection.connect({
    address: config.get('TEMPORAL_ADDRESS', { infer: true }),
  });

  const worker = await Worker.create({
    connection,
    namespace: config.get('TEMPORAL_NAMESPACE', { infer: true }),
    taskQueue: config.get('TEMPORAL_TASK_QUEUE', { infer: true }),
    workflowsPath: path.join(import.meta.dirname, 'temporal/workflows.js'),
    activities: bindActivities(app.get(HotelActivities)),
  });

  logger.log(`Polling task queue "${worker.options.taskQueue}"`);
  await worker.run(); // Resolves once SIGTERM/SIGINT drains the worker.

  await connection.close();
  await app.close();
}

await bootstrap();
