const mongoose = require('mongoose');

const processingJobSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    jobType: {
      type: String,
      enum: ['video_transcription', 'clip_extraction', 'metadata_generation', 'youtube_publish', 'batch_clipping'],
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ['SourceVideo', 'ShortClip', 'PublishingSchedule'],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['queued', 'active', 'completed', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    stage: {
      type: String,
      default: 'Initializing',
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    logs: [
      {
        timestamp: { type: Date, default: Date.now },
        message: String,
        level: { type: String, default: 'info' },
      },
    ],
    startedAt: {
      type: Date,
      default: null,
    },
    finishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ProcessingJob', processingJobSchema);
