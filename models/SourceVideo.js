const mongoose = require('mongoose');

const transcriptSegmentSchema = new mongoose.Schema(
  {
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    text: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const sourceVideoSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Video title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    originalFilename: {
      type: String,
      required: true,
    },
    storageProvider: {
      type: String,
      enum: ['cloudinary', 's3', 'local'],
      default: 'cloudinary',
    },
    storageKey: {
      type: String,
      required: true,
    },
    storageUrl: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number, // in bytes
      required: true,
    },
    duration: {
      type: Number, // in seconds
      default: 0,
    },
    format: {
      type: String,
      default: 'mp4',
    },
    resolution: {
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
    },
    fps: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'uploaded', 'processing', 'transcribing', 'clipping', 'completed', 'failed'],
      default: 'uploaded',
      index: true,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    transcript: {
      type: [transcriptSegmentSchema],
      default: [],
    },
    transcriptRaw: {
      type: String,
      default: '',
    },
    clipsCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('SourceVideo', sourceVideoSchema);
