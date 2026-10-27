
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const env = require('./config/env');
const connectDB = require('./config/db');

console.log('[WORKER] Initializing AI YouTube Shorts Video Processing Worker...');

const startWorker = async () => {
  await connectDB();

  if (env.REDIS_URL) {
    console.log(`[WORKER] Connecting BullMQ worker to Redis: ${env.REDIS_URL}`);
    const redisConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

    const worker = new Worker(
      'video-processing',
      async (job) => {
        console.log(`[WORKER] Processing BullMQ job ${job.id} for task: ${job.name}`);
        // Worker pipeline execution
      },
      { connection: redisConnection, concurrency: 2 }
    );

    worker.on('completed', (job) => {
      console.log(`[WORKER] Job ${job.id} completed successfully`);
    });

    worker.on('failed', (job, err) => {
      console.error(`[WORKER] Job ${job?.id} failed: ${err.message}`);
    });
  } else {
    console.log('[WORKER] Standalone worker standby: monitoring persistent database jobs queue...');
    // Polling interval for persistent database jobs
    setInterval(async () => {
      try {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState === 1) {
          const count = await mongoose.connection.db.collection('processingjobs').countDocuments({ status: 'queued' });
          if (count > 0) {
            console.log(`[WORKER:Monitor] Detected ${count} queued job(s) awaiting processing.`);
          }
        }
      } catch (err) {
        // silent monitor
      }
    }, 15000);
  }
};

startWorker();
