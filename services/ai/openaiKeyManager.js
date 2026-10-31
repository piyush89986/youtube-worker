const OpenAI = require('openai');
const fs = require('fs');
const logger = require('../../utils/logger');

class OpenAIKeyManager {
  constructor() {
    this.keys = this._loadKeysFromEnv();
    this.currentIndex = 0;
    this.rotationStats = {
      totalRotations: 0,
      keyFailures: {},
      keySuccesses: {},
    };

    logger.info(`[OpenAIKeyManager] Initialized with ${this.keys.length} unique OpenAI API keys in the rotation pool.`);
    if (this.keys.length > 0) {
      logger.info(`[OpenAIKeyManager] Active Primary Key: #${this.currentIndex + 1} (${this._maskKey(this.keys[this.currentIndex])})`);
    } else {
      logger.warn('[OpenAIKeyManager] No OpenAI API keys found in environment.');
    }
  }

  /**
   * Discovers and deduplicates all OPENAI_API_KEY* variables from environment
   * (e.g. OPENAI_API_KEY, OPENAI_API_KEY1, OPENAI_API_KEY2, OPENAI_API_KEY3, etc.)
   */
  _loadKeysFromEnv() {
    const rawKeys = [];

    // Check OPENAI_API_KEY primary
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
      rawKeys.push(process.env.OPENAI_API_KEY.trim());
    }

    // Check OPENAI_API_KEY1 through OPENAI_API_KEY20 or any dynamically named OPENAI_API_KEY*
    Object.keys(process.env)
      .filter((k) => k !== 'OPENAI_API_KEY' && k.startsWith('OPENAI_API_KEY'))
      .sort((a, b) => {
        const numA = parseInt(a.replace('OPENAI_API_KEY', ''), 10) || 0;
        const numB = parseInt(b.replace('OPENAI_API_KEY', ''), 10) || 0;
        return numA - numB;
      })
      .forEach((k) => {
        const val = process.env[k]?.trim();
        if (val) rawKeys.push(val);
      });

    // Deduplicate while preserving order
    return Array.from(new Set(rawKeys));
  }

  /**
   * Helper to mask keys for secure logging (e.g., sk-proj-9E...qfkA)
   */
  _maskKey(key) {
    if (!key || key.length < 12) return '***';
    return `${key.substring(0, 10)}...${key.substring(key.length - 4)}`;
  }

  /**
   * Returns current active key
   */
  getActiveKey() {
    if (this.keys.length === 0) return null;
    return this.keys[this.currentIndex];
  }

  /**
   * Check if any keys are configured in pool
   */
  hasKeys() {
    return this.keys.length > 0;
  }

  /**
   * Get an OpenAI client instance with the active key
   */
  getClient() {
    const key = this.getActiveKey();
    if (!key) return null;
    return new OpenAI({ apiKey: key });
  }

  /**
   * Rotates to next available key in the pool
   */
  rotateKey(reason = '') {
    if (this.keys.length <= 1) {
      logger.warn(`[OpenAIKeyManager] Only 1 key available in pool. Cannot rotate.`);
      return this.getActiveKey();
    }

    const previousIndex = this.currentIndex;
    const failedKeyMasked = this._maskKey(this.keys[previousIndex]);

    this.rotationStats.keyFailures[failedKeyMasked] = (this.rotationStats.keyFailures[failedKeyMasked] || 0) + 1;
    this.rotationStats.totalRotations++;

    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    const newKeyMasked = this._maskKey(this.keys[this.currentIndex]);

    logger.warn(
      `\x1b[33m[OpenAIKeyManager] KEY FAILOVER: Key #${previousIndex + 1} (${failedKeyMasked}) failed (${reason || 'Quota/RateLimit'}). Auto-switched to Key #${this.currentIndex + 1} (${newKeyMasked})\x1b[0m`
    );

    return this.keys[this.currentIndex];
  }

  /**
   * Execute chat completion with automatic key rotation and failover
   */
  async createChatCompletionWithFailover(params) {
    if (this.keys.length === 0) {
      throw new Error('No OpenAI API keys configured in pool.');
    }

    const maxAttempts = this.keys.length;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const activeKey = this.getActiveKey();
      const maskedKey = this._maskKey(activeKey);

      try {
        logger.info(`[OpenAIKeyManager] ChatCompletion Attempt ${attempt}/${maxAttempts} using Key #${this.currentIndex + 1} (${maskedKey})...`);
        const client = new OpenAI({ apiKey: activeKey });
        const completion = await client.chat.completions.create(params);

        this.rotationStats.keySuccesses[maskedKey] = (this.rotationStats.keySuccesses[maskedKey] || 0) + 1;
        logger.info(`\x1b[32m[OpenAIKeyManager] Key #${this.currentIndex + 1} (${maskedKey}) successfully completed chat request!\x1b[0m`);
        return completion;
      } catch (err) {
        lastError = err;
        logger.warn(`[OpenAIKeyManager] Error with Key #${this.currentIndex + 1} (${maskedKey}): ${err.message}`);

        if (attempt < maxAttempts) {
          this.rotateKey(err.message);
        }
      }
    }

    throw new Error(`All ${maxAttempts} OpenAI API keys exhausted. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Execute Whisper audio transcription with automatic key rotation and failover
   */
  async createAudioTranscriptionWithFailover(filePath, options = {}) {
    if (this.keys.length === 0) {
      throw new Error('No OpenAI API keys configured in pool.');
    }

    const maxAttempts = this.keys.length;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const activeKey = this.getActiveKey();
      const maskedKey = this._maskKey(activeKey);

      try {
        logger.info(`[OpenAIKeyManager] Whisper Transcription Attempt ${attempt}/${maxAttempts} using Key #${this.currentIndex + 1} (${maskedKey})...`);
        const client = new OpenAI({ apiKey: activeKey });

        // Always create a fresh file read stream per attempt
        const fileStream = fs.createReadStream(filePath);
        const transcript = await client.audio.transcriptions.create({
          file: fileStream,
          model: options.model || 'whisper-1',
          response_format: options.response_format || 'verbose_json',
          timestamp_granularities: options.timestamp_granularities || ['segment'],
        });

        this.rotationStats.keySuccesses[maskedKey] = (this.rotationStats.keySuccesses[maskedKey] || 0) + 1;
        logger.info(`\x1b[32m[OpenAIKeyManager] Key #${this.currentIndex + 1} (${maskedKey}) successfully transcribed audio with Whisper!\x1b[0m`);
        return transcript;
      } catch (err) {
        lastError = err;
        logger.warn(`[OpenAIKeyManager] Error with Key #${this.currentIndex + 1} (${maskedKey}): ${err.message}`);

        if (attempt < maxAttempts) {
          this.rotateKey(err.message);
        }
      }
    }

    throw new Error(`All ${maxAttempts} OpenAI API keys exhausted for Whisper transcription. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Get public pool telemetry
   */
  getPoolStatus() {
    return {
      totalKeysConfigured: this.keys.length,
      currentActiveKeyIndex: this.currentIndex + 1,
      currentActiveKeyMasked: this.keys[this.currentIndex] ? this._maskKey(this.keys[this.currentIndex]) : 'None',
      totalRotations: this.rotationStats.totalRotations,
      stats: this.rotationStats,
      allKeysSummary: this.keys.map((k, idx) => ({
        index: idx + 1,
        masked: this._maskKey(k),
        isActive: idx === this.currentIndex,
        failures: this.rotationStats.keyFailures[this._maskKey(k)] || 0,
        successes: this.rotationStats.keySuccesses[this._maskKey(k)] || 0,
      })),
    };
  }
}

// Export singleton instance
const openaiKeyManager = new OpenAIKeyManager();
module.exports = openaiKeyManager;
