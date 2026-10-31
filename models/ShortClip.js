const mongoose = require('mongoose');

const shortClipSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sourceVideo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SourceVideo',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Clip title is required'],
      trim: true,
      maxlength: [100, 'YouTube title cannot exceed 100 characters'],
    },
    description: {
      type: String,
      default: '',
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },
    tags: {
      type: [String],
      default: [],
    },
    startTime: {
      type: Number, // in seconds
      required: true,
    },
    endTime: {
      type: Number, // in seconds
      required: true,
    },
    duration: {
      type: Number, // in seconds (<= 180s)
      required: true,
    },
    aspectRatio: {
      type: String,
      default: '9:16',
    },
    resolution: {
      width: { type: Number, default: 1080 },
      height: { type: Number, default: 1920 },
    },
    clippingMode: {
      type: String,
      enum: ['fixed', 'ai_smart'],
      default: 'ai_smart',
    },
    hookScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 85,
    },
    hookSummary: {
      type: String,
      default: '',
    },
    subtitlesEnabled: {
      type: Boolean,
      default: true,
    },
    subtitleStyle: {
      fontSize: { type: Number, default: 24 },
      fontColor: { type: String, default: '#FFFFFF' },
      highlightColor: { type: String, default: '#FACC15' },
      position: { type: String, default: 'bottom' }, // top, middle, bottom
    },
    storageProvider: {
      type: String,
      enum: ['cloudinary', 's3', 'local'],
      default: 'cloudinary',
    },
    storageKey: {
      type: String,
      default: '',
    },
    storageUrl: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'ready', 'failed'],
      default: 'queued',
      index: true,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    // Publishing state
    publishingStatus: {
      type: String,
      enum: ['draft', 'scheduled', 'publishing', 'published', 'failed'],
      default: 'draft',
      index: true,
    },
    youtubeVideoId: {
      type: String,
      default: null,
    },
    youtubeUrl: {
      type: String,
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    suggestedPublishTime: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Virtual for formatted duration mm:ss
shortClipSchema.virtual('formattedDuration').get(function () {
  const mins = Math.floor(this.duration / 60);
  const secs = Math.floor(this.duration % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
});

module.exports = mongoose.model('ShortClip', shortClipSchema);
