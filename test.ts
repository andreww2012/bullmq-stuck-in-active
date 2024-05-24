import {createBullBoard} from '@bull-board/api';
import {BullMQAdapter} from '@bull-board/api/bullMQAdapter.js';
import {ExpressAdapter} from '@bull-board/express';
import {
  type DefaultJobOptions,
  Queue,
  type QueueBaseOptions,
  QueueEvents,
  type QueueEventsListener,
  Worker,
} from 'bullmq';
import express from 'express';

/* UTILS */

const s = (valueMs: number) => Math.round(valueMs / 1000);

/* CONSTANTS */

const QUEUE_NAME = 'JobBatchHandling';

const connectionOptions: QueueBaseOptions = {
  connection: {
    db: 1,
    host: 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT || '', 10) || 6379,
  },
  prefix: 'b',
};

console.log('🔵 Connecting to redis:', JSON.stringify(connectionOptions));

const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: Number.MAX_SAFE_INTEGER,
  backoff: {
    type: 'exponential',
    delay: s(300000), // 5m
  },
};

/* QUEUE */

const queue = new Queue(QUEUE_NAME, {
  ...connectionOptions,
  defaultJobOptions: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 10,
    removeOnFail: {age: s(300000)},
    removeOnComplete: {age: s(300000)},
  },
});

const queueEvents = new QueueEvents(QUEUE_NAME, connectionOptions);
// prettier-ignore
for (const event of [
  // Job events
  'added', 'active', 'completed', 'progress', 'failed', 'removed', 'duplicated', 'retries-exhausted', 'stalled',
  // Queue events
  'paused', 'resumed', 'cleaned', 'drained', 'error',
] as const) {
  queueEvents.on(
    event,
    (...payload: Parameters<QueueEventsListener[keyof QueueEventsListener]>) => {
      console.log(`[queue] ${event.toUpperCase()}`, ...payload);
    },
  );
}

/* WORKER */

const queueWorker = new Worker<never>(
  QUEUE_NAME,
  async (job) => {
    console.log(`job name=${job.name} ID=${job.id} started with data:`, job.data);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    console.log(`job name=${job.name} ID=${job.id} completed`);
  },
  {
    ...connectionOptions,
    concurrency: 3,
    limiter: {
      duration: 300,
      max: 1,
    },
    skipStalledCheck: true,
  },
);

for (const event of ['closing', 'closed', 'ready', 'paused', 'resumed', 'stalled'] as const) {
  queueWorker.on(event, (...payload: any[]) => {
    console.log(`[worker] ${event.toUpperCase()}`, ...payload);
  });
}

/* UI */

const expressApp = express();

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/');
createBullBoard({
  queues: [queue].map((q) => new BullMQAdapter(q)),
  serverAdapter,
});

expressApp.use('/', serverAdapter.getRouter());

const UI_PORT = Number.parseInt(process.env.UI_PORT || '', 10) || 5678;
expressApp.listen(UI_PORT, () => {
  console.log(`🔵 UI is running on http://localhost:${UI_PORT}`);
});

/* NEW JOB */

console.log('Adding a new job with id _12');
queue.add(
  'fetch-upd-jobbatch',
  {},
  {
    jobId: '_12',
  },
);
