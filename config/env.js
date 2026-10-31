require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 10000,
  CLIENT_URL: (process.env.CLIENT_URL || 'https://youtubfr.vercel.app').replace(/\/+$/, ''),
  BACKEND_URL: (process.env.BACKEND_URL || 'https://youtubeback-osll.onrender.com').replace(/\/+$/, ''),
  INTERNAL_WORKER_SECRET: process.env.INTERNAL_WORKER_SECRET || 'shorts_internal_secure_worker_token_2026',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/yt_shorts_automation',
  REDIS_URL: process.env.REDIS_URL || '',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'https://youtubeback-osll.onrender.com/api/youtube/oauth2callback',
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
};

module.exports = env;
