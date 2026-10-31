const mongoose = require('mongoose');

const youtubeAccountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    channelId: {
      type: String,
      required: [true, 'Channel ID is required'],
      trim: true,
    },
    channelTitle: {
      type: String,
      required: [true, 'Channel title is required'],
      trim: true,
    },
    customUrl: {
      type: String,
      default: '',
    },
    thumbnailUrl: {
      type: String,
      default: '',
    },
    subscriberCount: {
      type: Number,
      default: 0,
    },
    videoCount: {
      type: Number,
      default: 0,
    },
    // Encrypted at rest via cryptoService
    encryptedAccessToken: {
      type: String,
      required: true,
      select: false,
    },
    encryptedRefreshToken: {
      type: String,
      required: true,
      select: false,
    },
    tokenExpiry: {
      type: Date,
      required: true,
    },
    scopes: {
      type: [String],
      default: [],
    },
    isConnected: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure one record per user and channel
youtubeAccountSchema.index({ user: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.model('YouTubeAccount', youtubeAccountSchema);
