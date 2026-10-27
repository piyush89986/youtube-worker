/**
 * =========================================================================
 * AI YouTube Shorts - Background Processing Worker (Render Web Service)
 * =========================================================================
 * Render's Free Web Service tier requires binding to an HTTP port (process.env.PORT)
 * within 15 minutes, otherwise it throws "Port scan timeout reached".
 * This script runs a dummy Express HTTP server solely for health checks,
 * while running your actual background processing logic asynchronously.
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const env = require('./config/env');
const connectDB = require('./config/db');

const app = express();
const PORT = process.env.PORT || env.PORT || 10000;

// -------------------------------------------------------------------------
// 1. DUMMY EXPRESS SERVER (Solely to satisfy Render Port-Scan & Health Checks)
// -------------------------------------------------------------------------

app.use(express.json());

// CORS headers to allow status checks from frontend/backend
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Primary Health Check for Render
app.get('/', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  console.log(`[HTTP Server] Health check ping received (${new Date().toLocaleTimeString()})`);
  res.status(200).json({
    status: 'healthy',
    service: 'youtube-worker',
    environment: env.NODE_ENV || 'production',
    uptime: `${Math.floor(process.uptime())}s`,
    database: dbStatus,
    redisConfigured: Boolean(env.REDIS_URL),
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start listening immediately so Render detects the open port
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP Server] Health check server active on port ${PORT} (0.0.0.0)`);
});

// -------------------------------------------------------------------------
// 2. BACKGROUND WORKER PROCESS (Runs Asynchronously Alongside)
// -------------------------------------------------------------------------

const startWorker = async () => {
  console.log('[WORKER] Initializing AI YouTube Shorts Video Processing Worker...');

  try {
    // Connect to MongoDB
    await connectDB();
    console.log('[WORKER] MongoDB connection established for background worker.');

    if (env.REDIS_URL) {
      console.log(`[WORKER] Connecting BullMQ worker to Redis: ${env.REDIS_URL}`);
      const redisConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

      const worker = new Worker(
        'video-processing',
        async (job) => {
          console.log(`[WORKER] Processing BullMQ job ${job.id} for task: ${job.name}`);
          // Drop-in your pipeline execution here:
          // e.g., await executeJob(job.data.jobId);
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

      let checkCount = 0;
      // Polling interval for persistent database jobs (runs every 15s)
      setInterval(async () => {
        try {
          checkCount++;
          if (mongoose.connection.readyState === 1) {
            const count = await mongoose.connection.db
              .collection('processingjobs')
              .countDocuments({ status: 'queued' });

            if (count > 0) {
              console.log(`[WORKER:Queue] 🔔 Detected ${count} queued job(s) awaiting processing.`);
            } else if (checkCount % 2 === 0) {
              // Log heartbeat every 30 seconds so logs are visibly active on Render
              console.log(`[WORKER:Heartbeat] Worker active & healthy | MongoDB connected | 0 queued jobs (${new Date().toLocaleTimeString()})`);
            }
          }
        } catch (err) {
          console.error('[WORKER:Monitor] Queue check error:', err.message);
        }
      }, 15000);
    }
  } catch (error) {
    console.error('[WORKER:FATAL] Worker initialization error:', error.message);
  }
};

// Start background operations asynchronously (non-blocking)
startWorker();

// -------------------------------------------------------------------------
// 3. GRACEFUL SHUTDOWN (Clean exit on Render redeploys / restarts)
// -------------------------------------------------------------------------

const shutdown = async (signal) => {
  console.log(`[System] Received ${signal}. Gracefully stopping worker and HTTP server...`);
  server.close(async () => {
    console.log('[HTTP Server] Stopped listening for connections.');
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        console.log('[Database] MongoDB connection closed.');
      }
    } catch (e) {
      // ignore
    }
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
