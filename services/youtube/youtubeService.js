const { google } = require('googleapis');
const env = require('../../config/env');
const YouTubeAccount = require('../../models/YouTubeAccount');
const { encrypt, decrypt } = require('../cryptoService');
const logger = require('../../utils/logger');

// Least privilege scopes as required
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
];

/**
 * Creates a configured OAuth2 client instance
 */
const createOAuth2Client = () => {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
};

/**
 * Generate Google OAuth consent URL with state
 */
const getAuthUrl = (userId) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials not configured in environment.');
  }

  const oauth2Client = createOAuth2Client();
  const state = Buffer.from(JSON.stringify({ userId, timestamp: Date.now() })).toString('base64');

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // Ensures refresh token is always returned
    scope: SCOPES,
    state,
  });
};

/**
 * Handle OAuth callback, exchange code, fetch channel info, encrypt tokens at rest
 */
const handleOAuthCallback = async (code, userId) => {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Fetch YouTube channel details
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const channelRes = await youtube.channels.list({
    part: ['snippet', 'statistics', 'brandingSettings'],
    mine: true,
  });

  const items = channelRes.data.items;
  if (!items || items.length === 0) {
    throw new Error('No YouTube channel found associated with this Google account.');
  }

  const channel = items[0];
  const channelId = channel.id;
  const channelTitle = channel.snippet?.title || 'Unknown Channel';
  const customUrl = channel.snippet?.customUrl || '';
  const thumbnailUrl = channel.snippet?.thumbnails?.medium?.url || channel.snippet?.thumbnails?.default?.url || '';
  const subscriberCount = parseInt(channel.statistics?.subscriberCount || '0', 10);
  const videoCount = parseInt(channel.statistics?.videoCount || '0', 10);

  // Encrypt tokens at rest using AES-256-GCM
  const encryptedAccessToken = encrypt(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
  const tokenExpiry = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

  let existingAccount = await YouTubeAccount.findOne({ user: userId, channelId });

  if (existingAccount) {
    existingAccount.channelTitle = channelTitle;
    existingAccount.customUrl = customUrl;
    existingAccount.thumbnailUrl = thumbnailUrl;
    existingAccount.subscriberCount = subscriberCount;
    existingAccount.videoCount = videoCount;
    existingAccount.encryptedAccessToken = encryptedAccessToken;
    if (encryptedRefreshToken) {
      existingAccount.encryptedRefreshToken = encryptedRefreshToken;
    }
    existingAccount.tokenExpiry = tokenExpiry;
    existingAccount.isConnected = true;
    existingAccount.scopes = SCOPES;
    await existingAccount.save();
    return existingAccount;
  }

  if (!encryptedRefreshToken) {
    throw new Error('Google did not return a refresh token. Please revoke access in Google Account permissions and retry.');
  }

  const newAccount = await YouTubeAccount.create({
    user: userId,
    channelId,
    channelTitle,
    customUrl,
    thumbnailUrl,
    subscriberCount,
    videoCount,
    encryptedAccessToken,
    encryptedRefreshToken,
    tokenExpiry,
    scopes: SCOPES,
    isConnected: true,
  });

  logger.info(`YouTube channel connected: ${channelTitle} (${channelId}) for user: ${userId}`);
  return newAccount;
};

/**
 * Get authenticated Google OAuth2 client with auto-refreshing tokens
 */
const getAuthenticatedClient = async (channelIdOrId, userId) => {
  const query = { user: userId, isConnected: true };
  if (channelIdOrId && /^[0-9a-fA-F]{24}$/.test(String(channelIdOrId))) {
    query.$or = [{ _id: channelIdOrId }, { channelId: String(channelIdOrId) }];
  } else if (channelIdOrId) {
    query.channelId = String(channelIdOrId);
  }

  const account = await YouTubeAccount.findOne(query).select('+encryptedAccessToken +encryptedRefreshToken');

  if (!account) {
    throw new Error('Connected YouTube account not found or access was revoked.');
  }

  const oauth2Client = createOAuth2Client();
  const accessToken = decrypt(account.encryptedAccessToken);
  const refreshToken = decrypt(account.encryptedRefreshToken);

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: account.tokenExpiry.getTime(),
  });

  // Check if token is expired or expiring in next 5 minutes
  const isExpiring = Date.now() >= (account.tokenExpiry.getTime() - 5 * 60 * 1000);

  if (isExpiring) {
    logger.info(`Access token expired for channel ${account.channelTitle}. Refreshing...`);
    try {
      const refreshed = await oauth2Client.refreshAccessToken();
      const newTokens = refreshed.credentials;
      
      account.encryptedAccessToken = encrypt(newTokens.access_token);
      if (newTokens.refresh_token) {
        account.encryptedRefreshToken = encrypt(newTokens.refresh_token);
      }
      account.tokenExpiry = new Date(newTokens.expiry_date || Date.now() + 3600 * 1000);
      await account.save();

      oauth2Client.setCredentials(newTokens);
      logger.info(`Successfully refreshed token for channel: ${account.channelTitle}`);
    } catch (refreshErr) {
      logger.error(`Failed to refresh token: ${refreshErr.message}`);
      account.lastError = 'Token refresh failed. Please re-authenticate.';
      await account.save();
      throw new Error('YouTube authorization expired. Please reconnect your channel.');
    }
  }

  return { oauth2Client, account };
};

/**
 * Disconnect YouTube Channel and revoke tokens with Google
 */
const revokeChannelAccess = async (channelId, userId) => {
  const query = { user: userId };
  if (channelId && /^[0-9a-fA-F]{24}$/.test(channelId)) {
    query.$or = [{ channelId }, { _id: channelId }];
  } else {
    query.channelId = channelId;
  }

  const account = await YouTubeAccount.findOne(query).select('+encryptedAccessToken +encryptedRefreshToken');

  if (!account) {
    throw new Error('Channel not found');
  }

  try {
    if (account.encryptedAccessToken) {
      const accessToken = decrypt(account.encryptedAccessToken);
      const oauth2Client = createOAuth2Client();
      await oauth2Client.revokeToken(accessToken);
    }
  } catch (err) {
    logger.warn(`Could not revoke token directly with Google: ${err.message}`);
  }

  // Delete channel record so reconnecting starts completely fresh
  await YouTubeAccount.findByIdAndDelete(account._id);

  logger.info(`Channel disconnected successfully: ${account.channelTitle} (${account.channelId})`);
  return account;
};

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  getAuthenticatedClient,
  revokeChannelAccess,
};
