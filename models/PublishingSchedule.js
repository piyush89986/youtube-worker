const mongoose = require('mongoose');

const publishingScheduleSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clip: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ShortClip',
      required: true,
      index: true,
    },
    youtubeAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YouTubeAccount',
      required: true,
    },
    scheduledTime: {
      type: Date,
      required: true,
      index: true,
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
    privacyStatus: {
      type: String,
      enum: ['public', 'private', 'unlisted'],
      default: 'public',
    },
    frequency: {
      type: String,
      enum: ['once', 'daily_slot'],
      default: 'once',
    },
    status: {
      type: String,
      enum: ['pending', 'locked', 'publishing', 'completed', 'failed', 'paused', 'cancelled'],
      default: 'pending',
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    maxRetries: {
      type: Number,
      default: 3,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    youtubeVideoId: {
      type: String,
      default: null,
    },
    errorLog: [
      {
        attempt: Number,
        timestamp: { type: Date, default: Date.now },
        message: String,
        code: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('PublishingSchedule', publishingScheduleSchema);
