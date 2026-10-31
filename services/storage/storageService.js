const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../utils/logger');

// Configure Cloudinary if credentials provided
if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  logger.info('Cloudinary SDK configured for direct uploads');
}

/**
 * Generate signed upload parameters for client-side direct upload
 * Prevents routing 1-hour large video binaries through Express server memory!
 */
const generateSignedUpload = (filename, contentType) => {
  logger.info(`[StorageService] Generating signed upload request for file: "${filename}" (${contentType || 'unknown type'})`);
  const isCloudinaryReady = Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
  );

  const storageKey = `shorts_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

  if (isCloudinaryReady) {
    logger.info(`[StorageService] Cloudinary active (Cloud: ${env.CLOUDINARY_CLOUD_NAME}). Creating signed direct upload credentials.`);
    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = 'yt_source_videos';

    // Generate Cloudinary SHA-1 signature
    const paramsToSign = {
      folder,
      public_id: storageKey,
      timestamp,
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      env.CLOUDINARY_API_SECRET
    );

    const result = {
      uploadMode: 'cloudinary',
      uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/video/upload`,
      uploadFields: {
        api_key: env.CLOUDINARY_API_KEY,
        timestamp,
        signature,
        folder,
        public_id: storageKey,
      },
      storageKey: `${folder}/${storageKey}`,
    };
    logger.info(`[StorageService] Signed upload ready for key: ${result.storageKey}`);
    return result;
  }

  // Fallback direct storage mode for local testing
  logger.info(`[StorageService] Cloudinary credentials not detected. Falling back to local direct upload mode.`);
  return {
    uploadMode: 'direct',
    uploadUrl: '/api/videos/upload-direct',
    uploadFields: {},
    storageKey,
  };
};

const fs = require('fs');

/**
 * Upload a local media file (rendered video clip or audio) to Cloudinary
 */
const uploadFileToCloudinary = async (localFilePath, folder = 'yt_shorts_clips') => {
  const isCloudinaryReady = Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
  );

  if (!isCloudinaryReady) {
    logger.warn('[StorageService] Cloudinary credentials not configured. Skipping cloud upload.');
    return null;
  }

  if (!fs.existsSync(localFilePath)) {
    logger.warn(`[StorageService] Local file not found for Cloudinary upload: ${localFilePath}`);
    return null;
  }

  try {
    const stats = fs.statSync(localFilePath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    logger.info(`[StorageService:Cloudinary] Uploading media file (${sizeMb} MB) to Cloudinary folder "${folder}": ${localFilePath}...`);

    // Use upload_large for chunked streaming to support 100MB+ files and prevent HTTP 413
    const isLarge = stats.size > 20 * 1024 * 1024;
    let result;

    if (isLarge) {
      logger.info(`[StorageService:Cloudinary] File is ${sizeMb} MB (>20MB). Using chunked upload_large (6MB chunks)...`);
      result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_large(
          localFilePath,
          {
            resource_type: 'video',
            folder,
            chunk_size: 6000000, // 6MB chunks to strictly avoid HTTP 413 limits
            timeout: 300000,
          },
          (err, res) => {
            if (err) return reject(err);
            resolve(res);
          }
        );
      });
    } else {
      result = await cloudinary.uploader.upload(localFilePath, {
        resource_type: 'video',
        folder,
        timeout: 180000,
      });
    }

    logger.info(`[StorageService:Cloudinary] Clip upload successful! URL: ${result.secure_url} (Public ID: ${result.public_id})`);
    return {
      secureUrl: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
      duration: result.duration,
    };
  } catch (err) {
    logger.error(`[StorageService:Cloudinary] Failed to upload clip to Cloudinary: ${err.message}`);
    return null;
  }
};

module.exports = {
  generateSignedUpload,
  uploadFileToCloudinary,
  cloudinary,
};
