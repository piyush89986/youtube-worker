const ShortClip = require('../models/ShortClip');
const PublishingSchedule = require('../models/PublishingSchedule');
const YouTubeAccount = require('../models/YouTubeAccount');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Format a Date to UTC YYYY-MM-DD string for day-based slot booking
 */
const formatDayKey = (date) => {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Intelligent Day-by-Day Auto-Scheduler Algorithm
 * Guarantees:
 * 1. Every extracted short clip is scheduled day-by-day (1 short per day).
 * 2. Starts from tomorrow at creator's default publishing hour (e.g. 18:00 = 6 PM).
 * 3. Inspects already booked future days so no collision occurs and no day is missed!
 *
 * @param {Array} clips - Array of ShortClip documents
 * @param {string|ObjectId} userId - Creator user ID
 * @returns {Promise<{scheduledCount: number, schedules: Array, reason?: string}>}
 */
const autoScheduleClips = async (clips, userId) => {
  try {
    if (!clips || clips.length === 0) {
      return { scheduledCount: 0, schedules: [] };
    }

    const user = await User.findById(userId);
    if (!user) {
      logger.warn(`[AutoScheduler] User record not found for ID: ${userId}`);
      return { scheduledCount: 0, schedules: [], reason: 'user_not_found' };
    }

    // Check if creator has worker / auto-scheduler toggled ON
    const isWorkerActive = user.settings?.workerActive !== false;
    const isAutoSchedulerEnabled = user.settings?.autoSchedulerEnabled !== false;

    if (!isWorkerActive || !isAutoSchedulerEnabled) {
      logger.info(`[AutoScheduler] Worker/Auto-scheduler is OFF for User: ${userId}. Clips remain as drafts for manual review.`);
      return { scheduledCount: 0, schedules: [], reason: 'worker_paused' };
    }

    // Find user's active connected YouTube Channel
    const channel = await YouTubeAccount.findOne({
      user: userId,
      isConnected: true,
    }).sort({ createdAt: -1 });

    if (!channel) {
      logger.warn(`[AutoScheduler] No connected YouTube channel found for User: ${userId}. Clips saved in library as drafts.`);
      return { scheduledCount: 0, schedules: [], reason: 'no_connected_channel' };
    }

    const defaultPublishingHour = Number(
      user.settings?.defaultPublishingHour !== undefined ? user.settings.defaultPublishingHour : 18
    );
    const timezone = user.settings?.defaultTimezone || 'UTC';

    logger.info(`[AutoScheduler] Initiating day-by-day scheduling for ${clips.length} clip(s). Target Hour: ${defaultPublishingHour}:00 (${timezone}), Channel: "${channel.channelTitle}"`);

    // Query all existing pending/publishing schedules in the future for this channel
    const existingSchedules = await PublishingSchedule.find({
      user: userId,
      youtubeAccount: channel._id,
      status: { $in: ['pending', 'locked', 'publishing'] },
      scheduledTime: { $gte: new Date(Date.now() - 3600000) }, // from 1 hour ago onwards
    }).select('scheduledTime');

    // Build a Set of calendar days that already have a short scheduled
    const bookedDays = new Set(existingSchedules.map((s) => formatDayKey(s.scheduledTime)));
    logger.info(`[AutoScheduler] Detected ${bookedDays.size} already booked future day slot(s) for channel "${channel.channelTitle}".`);

    // Candidate date begins TOMORROW at creator's default publishing hour
    const candidateDate = new Date();
    candidateDate.setUTCDate(candidateDate.getUTCDate() + 1);
    candidateDate.setUTCHours(defaultPublishingHour, 0, 0, 0);

    const createdSchedules = [];

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];

      // Skip if already scheduled or published
      if (clip.publishingStatus === 'scheduled' || clip.publishingStatus === 'published') {
        logger.info(`[AutoScheduler] Clip "${clip.title}" is already ${clip.publishingStatus}. Skipping.`);
        continue;
      }

      // Find the next calendar day that does NOT have a scheduled short yet
      let dayKey = formatDayKey(candidateDate);
      while (bookedDays.has(dayKey)) {
        candidateDate.setUTCDate(candidateDate.getUTCDate() + 1);
        dayKey = formatDayKey(candidateDate);
      }

      // Slot candidateDate for this clip
      const scheduledTime = new Date(candidateDate);
      const idempotencyKey = `auto_${clip._id}_${scheduledTime.getTime()}`;

      // Check if schedule already exists for this clip
      const existing = await PublishingSchedule.findOne({ clip: clip._id });
      if (existing) {
        logger.info(`[AutoScheduler] Schedule record already exists for clip ID: ${clip._id}`);
        continue;
      }

      const scheduleDoc = await PublishingSchedule.create({
        user: userId,
        clip: clip._id,
        youtubeAccount: channel._id,
        scheduledTime,
        timezone,
        privacyStatus: 'public',
        frequency: 'once',
        status: 'pending',
        idempotencyKey,
      });

      // Update ShortClip document status
      clip.publishingStatus = 'scheduled';
      clip.status = 'ready';
      await clip.save();

      // Mark this day as booked
      bookedDays.add(dayKey);
      createdSchedules.push(scheduleDoc);

      logger.info(
        `[AutoScheduler:Success] 🎯 Short #${i + 1} ("${clip.title}") auto-scheduled for ${scheduledTime.toDateString()} at ${defaultPublishingHour}:00 UTC (Day: ${dayKey}) on channel "${channel.channelTitle}"`
      );

      // Advance candidate date by 1 day for the next clip in the pipeline
      candidateDate.setUTCDate(candidateDate.getUTCDate() + 1);
    }

    logger.info(`[AutoScheduler:Complete] Successfully scheduled ${createdSchedules.length} of ${clips.length} clip(s) day-by-day.`);
    return {
      scheduledCount: createdSchedules.length,
      schedules: createdSchedules,
    };
  } catch (error) {
    logger.error(`[AutoScheduler:Error] Auto-scheduling failed: ${error.message}`, error.stack);
    return { scheduledCount: 0, schedules: [], error: error.message };
  }
};

/**
 * Backfill Auto-Schedule: If a user toggles Worker ON or connects a YouTube channel,
 * this scans for any un-scheduled ready clips and books them day-by-day.
 */
const backfillAutoSchedule = async (userId) => {
  try {
    const unScheduledClips = await ShortClip.find({
      user: userId,
      status: 'ready',
      publishingStatus: 'draft',
    }).sort({ createdAt: 1 });

    if (unScheduledClips.length > 0) {
      logger.info(`[AutoScheduler:Backfill] Found ${unScheduledClips.length} draft clip(s) for User: ${userId}. Queuing day-by-day auto-schedule...`);
      return await autoScheduleClips(unScheduledClips, userId);
    }
    return { scheduledCount: 0, schedules: [] };
  } catch (err) {
    logger.error(`[AutoScheduler:Backfill] Error during backfill: ${err.message}`);
    return { scheduledCount: 0, schedules: [], error: err.message };
  }
};

module.exports = {
  autoScheduleClips,
  backfillAutoSchedule,
};
