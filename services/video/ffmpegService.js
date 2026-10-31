const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

// Set paths safely cross-platform
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
} else if (ffmpegInstaller && ffmpegInstaller.path) {
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}

if (process.env.FFPROBE_PATH) {
  ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
} else if (ffprobeInstaller && ffprobeInstaller.path) {
  ffmpeg.setFfprobePath(ffprobeInstaller.path);
}

/**
 * Probe video metadata using ffprobe
 */
const probeVideo = (filePathOrUrl) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePathOrUrl, (err, metadata) => {
      if (err) {
        return reject(new Error(`FFprobe failed: ${err.message}`));
      }

      const videoStream = (metadata.streams || []).find((s) => s.codec_type === 'video') || {};
      const duration = parseFloat(metadata.format?.duration || videoStream.duration || 0);
      const width = videoStream.width || 1920;
      const height = videoStream.height || 1080;
      const fps = eval(videoStream.r_frame_rate || '30/1') || 30;

      resolve({
        duration,
        width,
        height,
        fps: Math.round(fps),
        bitrate: metadata.format?.bit_rate || videoStream.bit_rate || null,
        format: metadata.format?.format_name || 'mp4',
      });
    });
  });
};

/**
 * Create a 9:16 vertical Short with speaker center-crop and optional subtitles
 */
const createVerticalShort = ({
  inputPath,
  outputPath,
  startTime = 0,
  duration = 60,
  targetWidth = 1080,
  targetHeight = 1920,
  subtitlesPath = null,
  onProgress = null,
}) => {
  return new Promise((resolve, reject) => {
    // Ensure parent directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Video filter for 9:16: Scale to height 1920 maintaining aspect ratio, then crop 1080 wide centered
    let videoFilter = `scale=-1:${targetHeight},crop=${targetWidth}:${targetHeight}:(iw-${targetWidth})/2:0`;

    if (subtitlesPath && fs.existsSync(subtitlesPath)) {
      // Escape Windows backslashes for FFmpeg subtitles filter
      const escapedSrt = subtitlesPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      // Alignment=2 (bottom center), MarginV=45 (bottom margin), FontSize=16 (clean unobtrusive size)
      videoFilter += `,subtitles='${escapedSrt}':force_style='Alignment=2,MarginV=45,FontSize=16,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,BorderStyle=3,Outline=1'`;
    }

    let command = ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(duration)
      .videoFilters(videoFilter)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('128k')
      .outputOptions([
        '-threads 1', // Crucial: limit to 1 thread so memory stays < 200MB on Render 512MB RAM Free tier
        '-preset ultrafast', // Fastest rendering time
        '-crf 26',
        '-movflags +faststart', // Web playback optimization
        '-pix_fmt yuv420p',
      ])
      .output(outputPath);

    if (onProgress) {
      command.on('progress', (progress) => {
        const percent = Math.min(100, Math.round(progress.percent || 0));
        onProgress(percent);
      });
    }

    command
      .on('end', () => {
        logger.info(`Vertical Short rendered: ${outputPath} (${duration}s)`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error(`FFmpeg render error: ${err.message}`);
        reject(err);
      });

    command.run();
  });
};

/**
 * Calculate uniform segments for fixed-length clipping mode
 */
const generateFixedSegments = (totalDuration, segmentDuration = 60) => {
  const segments = [];
  const maxShortDuration = Math.min(segmentDuration, 180); // YouTube Shorts max 180s
  let currentStart = 0;

  while (currentStart + 15 <= totalDuration) {
    const end = Math.min(currentStart + maxShortDuration, totalDuration);
    const duration = end - currentStart;

    segments.push({
      startTime: Math.round(currentStart),
      endTime: Math.round(end),
      duration: Math.round(duration),
      title: `Part ${segments.length + 1} (${Math.round(currentStart)}s - ${Math.round(end)}s)`,
    });

    currentStart += maxShortDuration;
  }

  return segments;
};

/**
 * Extract compact mono MP3 audio track from video for speech transcription
 */
const extractAudio = (videoPath, audioOutputPath) => {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(audioOutputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('48k')
      .audioChannels(1)
      .audioFrequency(16000) // 16kHz is native for Whisper AI & keeps 24min audio under 9MB
      .outputOptions(['-threads 1'])
      .output(audioOutputPath)
      .on('end', () => {
        logger.info(`Extracted compact audio track to: ${audioOutputPath}`);
        resolve(audioOutputPath);
      })
      .on('error', (err) => {
        logger.error(`Audio extraction error: ${err.message}`);
        reject(err);
      })
      .run();
  });
};

module.exports = {
  probeVideo,
  createVerticalShort,
  generateFixedSegments,
  extractAudio,
};

