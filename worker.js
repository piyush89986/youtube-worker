/**
 * =========================================================================
 * AI YouTube Shorts - Production Background Worker (Render Web Service)
 * =========================================================================
 * 1. Express HTTP Server: Responds immediately to Render port scan & health pings.
 * 2. HTTP Dispatch Endpoint (/api/jobs/process): Allows backend to trigger jobs directly.
 * 3. Database Poller: Continuously scans MongoDB for queued jobs (resilient to sleep/cold-start).
 * 4. BullMQ Integration: Optional Redis queue processor if REDIS_URL is configured.
 * 5. YouTube Scheduler: Automatically publishes scheduled shorts when due.
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const env = require('./config/env');
const connectDB = require('./config/db');
const { executeJob } = require('./services/queueService');
const { checkAndPublishScheduledClips } = require('./services/schedulerService');
const ProcessingJob = require('./models/ProcessingJob');
const PublishingSchedule = require('./models/PublishingSchedule');

const app = express();
const PORT = process.env.PORT || env.PORT || 10000;

// Track active jobs in memory
let activeProcessingJobs = new Set();
let lastProcessedJob = null;

// -------------------------------------------------------------------------
// 1. EXPRESS HTTP SERVER (Port-Scan, Health, and Backend Dispatch API)
// -------------------------------------------------------------------------

app.use(express.json());

// CORS headers to allow status checks from frontend/backend
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-worker-secret');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Primary Health Check for Render & Backend
app.get('/', async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  let queuedCount = 0;
  let activeCount = activeProcessingJobs.size;

  try {
    if (mongoose.connection.readyState === 1) {
      queuedCount = await ProcessingJob.countDocuments({ status: 'queued' });
    }
  } catch (e) {}

  res.status(200).json({
    status: 'healthy',
    service: 'youtube-worker',
    version: '2.0.0',
    environment: env.NODE_ENV || 'production',
    uptime: `${Math.floor(process.uptime())}s`,
    database: dbStatus,
    redisConfigured: Boolean(env.REDIS_URL),
    activeJobsCount: activeCount,
    queuedJobsCount: queuedCount,
    lastProcessedJob,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Keep-alive ping from Backend
app.post('/api/worker/ping', (req, res) => {
  console.log(`[RENDER-WORKER:PING] 📡 Keep-alive heartbeat received from Backend at ${new Date().toLocaleTimeString()}`);
  res.status(200).json({
    pong: true,
    service: 'youtube-worker',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Direct HTTP Job Dispatch from Backend API
app.post('/api/jobs/process', async (req, res) => {
  const { jobId, secret } = req.body;

  // Validate internal secret token if configured
  if (env.INTERNAL_WORKER_SECRET && secret && secret !== env.INTERNAL_WORKER_SECRET) {
    console.warn(`[RENDER-WORKER:SECURITY] ⚠️ Unauthorized job dispatch attempt for Job ID: ${jobId}`);
    return res.status(401).json({ success: false, message: 'Invalid worker secret' });
  }

  if (!jobId) {
    return res.status(400).json({ success: false, message: 'Missing jobId parameter' });
  }

  console.log(`\n\x1b[36m[RENDER-WORKER] ════════════════════════════════════════════════════════════════\x1b[0m`);
  console.log(`\x1b[32m[RENDER-WORKER] 🚀 NEW JOB RECEIVED VIA HTTP DISPATCH: ${jobId}\x1b[0m`);
  console.log(`\x1b[36m[RENDER-WORKER] ════════════════════════════════════════════════════════════════\x1b[0m\n`);

  // Respond immediately so backend HTTP request does not hang or timeout
  res.status(202).json({
    success: true,
    message: 'Job received and queued for execution in background worker',
    jobId,
    timestamp: new Date().toISOString(),
  });

  // Execute processing job asynchronously
  activeProcessingJobs.add(jobId);
  setImmediate(async () => {
    try {
      await executeJob(jobId);
      lastProcessedJob = { jobId, status: 'completed', finishedAt: new Date() };
    } catch (err) {
      console.error(`[RENDER-WORKER:ERROR] ❌ Job ${jobId} failed: ${err.message}`, err.stack);
      lastProcessedJob = { jobId, status: 'failed', error: err.message, finishedAt: new Date() };
    } finally {
      activeProcessingJobs.delete(jobId);
    }
  });
});

// Start listening immediately to satisfy Render Port-Scan
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\x1b[32m[RENDER-WORKER] 🟢 HTTP Server active on port ${PORT} (0.0.0.0)\x1b[0m`);
  console.log(`[RENDER-WORKER] Health check URL: http://0.0.0.0:${PORT}/health`);
});

// -------------------------------------------------------------------------
// 2. BACKGROUND WORKER ENGINE (Database Poller + BullMQ + YouTube Scheduler)
// -------------------------------------------------------------------------

const startWorkerEngine = async () => {
  console.log('\n\x1b[34m[RENDER-WORKER] ==========================================================\x1b[0m');
  console.log('\x1b[34m[RENDER-WORKER] 🚀 Initializing YouTube Shorts Background Worker Engine v2.0\x1b[0m');
  console.log(`\x1b[34m[RENDER-WORKER] 🔗 Backend URL: ${env.BACKEND_URL}\x1b[0m`);
  console.log('\x1b[34m[RENDER-WORKER] ==========================================================\x1b[0m\n');

  try {
    // 1. Establish persistent connection to MongoDB
    await connectDB();
    console.log('[RENDER-WORKER] 🍃 MongoDB connection established successfully.');

    // 2. Initialize BullMQ if REDIS_URL is configured
    if (env.REDIS_URL) {
      console.log(`[RENDER-WORKER:Redis] 🔌 Connecting BullMQ worker to Redis: ${env.REDIS_URL}`);
      try {
        const redisConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
        const bullWorker = new Worker(
          'video-processing',
          async (job) => {
            console.log(`[RENDER-WORKER:BullMQ] 📥 Processing BullMQ job ${job.id} (task: ${job.name}, entity: ${job.data?.jobId})`);
            if (job.data?.jobId) {
              await executeJob(job.data.jobId);
            }
          },
          { connection: redisConnection, concurrency: 2 }
        );

        bullWorker.on('completed', (job) => {
          console.log(`[RENDER-WORKER:BullMQ] ✅ BullMQ Job ${job.id} completed successfully`);
        });

        bullWorker.on('failed', (job, err) => {
          console.error(`[RENDER-WORKER:BullMQ] ❌ BullMQ Job ${job?.id} failed: ${err.message}`);
        });
      } catch (redisErr) {
        console.warn(`[RENDER-WORKER:Redis] Redis connection failed: ${redisErr.message}. Relying on MongoDB queue poller.`);
      }
    }

    // 3. Resilient Database Queue Poller (Dual Safety & Sleep Resiliency)
    // Runs every 10 seconds. Claims pending queued jobs from MongoDB atomically.
    let tickCount = 0;
    setInterval(async () => {
      try {
        tickCount++;

        if (mongoose.connection.readyState !== 1) return;

        // Atomically claim ONE queued job to prevent duplicate execution across instances
        const claimedJob = await ProcessingJob.findOneAndUpdate(
          { status: 'queued' },
          { status: 'active', startedAt: new Date(), stage: 'Claimed by Render Worker Poller' },
          { new: true, sort: { createdAt: 1 } }
        );

        if (claimedJob) {
          console.log(`\n\x1b[33m[RENDER-WORKER:DB-POLL] 🔔 CLAIMED QUEUED JOB FROM DATABASE: ${claimedJob._id} (${claimedJob.jobType})\x1b[0m`);
          activeProcessingJobs.add(claimedJob._id.toString());

          executeJob(claimedJob._id)
            .then(() => {
              lastProcessedJob = { jobId: claimedJob._id, status: 'completed', finishedAt: new Date() };
              console.log(`\x1b[32m[RENDER-WORKER:DB-POLL] ✅ Finished processing job ${claimedJob._id}\x1b[0m\n`);
            })
            .catch((err) => {
              console.error(`\x1b[31m[RENDER-WORKER:DB-POLL] ❌ Failed processing job ${claimedJob._id}: ${err.message}\x1b[0m\n`);
              lastProcessedJob = { jobId: claimedJob._id, status: 'failed', error: err.message, finishedAt: new Date() };
            })
            .finally(() => {
              activeProcessingJobs.delete(claimedJob._id.toString());
            });
        }

        // Heartbeat log every 30 seconds (every 3 ticks)
        if (tickCount % 3 === 0) {
          const queuedCount = await ProcessingJob.countDocuments({ status: 'queued' });
          const pendingSchedulesCount = await PublishingSchedule.countDocuments({
            status: 'pending',
            scheduledTime: { $lte: new Date() },
          });

          console.log(
            `[RENDER-WORKER:HEARTBEAT] 🟢 Worker active | MongoDB connected | Queued jobs: ${queuedCount} | Due shorts: ${pendingSchedulesCount} | Uptime: ${Math.floor(process.uptime())}s`
          );
        }
      } catch (pollErr) {
        console.error('[RENDER-WORKER:Monitor] Queue check error:', pollErr.message);
      }
    }, 10000);

    // 4. YouTube Publishing Scheduler (Runs every 60 seconds)
    // Ensures scheduled YouTube Shorts are uploaded on time even if backend was sleeping
    setInterval(async () => {
      try {
        if (mongoose.connection.readyState === 1) {
          await checkAndPublishScheduledClips();
        }
      } catch (schedErr) {
        console.error('[RENDER-WORKER:Scheduler] Publishing check error:', schedErr.message);
      }
    }, 60000);

  } catch (error) {
    console.error('[RENDER-WORKER:FATAL] Worker initialization error:', error.message);
  }
};

// Start background operations asynchronously
startWorkerEngine();

// -------------------------------------------------------------------------
// 3. GRACEFUL SHUTDOWN (Clean exit on Render redeploys / restarts)
// -------------------------------------------------------------------------

const shutdown = async (signal) => {
  console.log(`[RENDER-WORKER:System] Received ${signal}. Gracefully stopping worker and HTTP server...`);
  server.close(async () => {
    console.log('[RENDER-WORKER:System] HTTP server closed.');
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        console.log('[RENDER-WORKER:System] MongoDB connection closed cleanly.');
      }
    } catch (e) {}
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
