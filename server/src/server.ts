import { createApp } from './app';
import { assertConceptAutoArchiveConfigAtStartup } from './config/conceptAutoArchiveGuard';
import { connectDatabase, disconnectDatabase } from './config/database';
import { closeRedis } from './config/redis';
import { env } from './config/env';
import { startEmailWorker } from './services/email.service';
import { startReminderWorker } from './services/reminder.service';
import { startNotificationWorker } from './services/notificationQueue.service';
import { startConceptGenerationWorker } from './services/conceptGenerationQueue.service';
import { logger } from './utils/logger';

const assertNodeVersion = () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(major) && major < 22 && env.NODE_ENV !== 'test') {
    logger.error(
      { node: process.version },
      'Node.js 22+ is required for FluentAI Interview. Use `fnm use 22` or upgrade Node, then restart.',
    );
    process.exit(1);
  }
};

const bootstrap = async () => {
  assertNodeVersion();
  assertConceptAutoArchiveConfigAtStartup();

  if (!env.GROQ_API_KEY && !env.OPENAI_API_KEY) {
    logger.warn('No GROQ_API_KEY or OPENAI_API_KEY set — interview AI will use weak fallbacks.');
  }
  if (!env.ELEVENLABS_API_KEY && !env.SARVAM_API_KEY) {
    logger.warn('No TTS API key set — interviewer voice will use browser speechSynthesis fallback.');
  }

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`Server running on http://0.0.0.0:${env.PORT}`);
  });

  const workers: Array<{ close: () => Promise<unknown> }> = [];
  let dependenciesStarted = false;

  const startDependencies = async () => {
    if (dependenciesStarted) return;

    try {
      await connectDatabase();
      if (env.NODE_ENV !== 'test') {
        workers.push(
          startEmailWorker(),
          startReminderWorker(),
          startNotificationWorker(),
          startConceptGenerationWorker(),
        );
      }
      dependenciesStarted = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Startup dependency failed; retrying');
      const retry = setTimeout(startDependencies, 10000);
      retry.unref?.();
    }
  };

  void startDependencies();

  const shutdown = async () => {
    logger.info('Shutting down server');
    server.close();
    await Promise.all(workers.map((worker) => worker.close()));
    await closeRedis();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

bootstrap().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Server failed to start');
  process.exit(1);
});
