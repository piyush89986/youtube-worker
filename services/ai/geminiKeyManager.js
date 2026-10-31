const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../../utils/logger');

class GeminiKeyManager {
  constructor() {
    this.keys = this._loadKeysFromEnv();
    this.currentIndex = 0;
    this.rotationStats = {
      totalRotations: 0,
      keyFailures: {},
      keySuccesses: {},
    };

    logger.info(`[GeminiKeyManager] Initialized with ${this.keys.length} unique Gemini API keys in the rotation pool.`);
    if (this.keys.length > 0) {
      logger.info(`[GeminiKeyManager] Active Primary Key: #${this.currentIndex + 1} (${this._maskKey(this.keys[this.currentIndex])})`);
    } else {
      logger.warn('[GeminiKeyManager] No Gemini API keys found in environment.');
    }
  }

  /**
   * Discovers and deduplicates all GEMINI_API_KEY* variables from environment
   */
  _loadKeysFromEnv() {
    const rawKeys = [];

    // Check GEMINI_API_KEY primary
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
      rawKeys.push(process.env.GEMINI_API_KEY.trim());
    }

    // Check GEMINI_API_KEY1 through GEMINI_API_KEY20 or any dynamically named GEMINI_API_KEY_*
    Object.keys(process.env)
      .filter((k) => k !== 'GEMINI_API_KEY' && k.startsWith('GEMINI_API_KEY'))
      // Sort numerically if suffixed (GEMINI_API_KEY1, GEMINI_API_KEY2, etc.)
      .sort((a, b) => {
        const numA = parseInt(a.replace('GEMINI_API_KEY', ''), 10) || 0;
        const numB = parseInt(b.replace('GEMINI_API_KEY', ''), 10) || 0;
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
   * Helper to mask keys for secure logging (e.g., AIzaSyDN...gOw)
   */
  _maskKey(key) {
    if (!key || key.length < 10) return '***';
    return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
  }

  /**
   * Returns current active key
   */
  getActiveKey() {
    if (this.keys.length === 0) return null;
    return this.keys[this.currentIndex];
  }

  /**
   * Rotates to next available key in the pool
   */
  rotateKey(reason = '') {
    if (this.keys.length <= 1) {
      logger.warn(`[GeminiKeyManager] Only 1 key available in pool. Cannot rotate.`);
      return this.getActiveKey();
    }

    const previousIndex = this.currentIndex;
    const failedKeyMasked = this._maskKey(this.keys[previousIndex]);
    
    // Increment failure stat for this key
    this.rotationStats.keyFailures[failedKeyMasked] = (this.rotationStats.keyFailures[failedKeyMasked] || 0) + 1;
    this.rotationStats.totalRotations++;

    // Switch index
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    const newKeyMasked = this._maskKey(this.keys[this.currentIndex]);

    logger.warn(
      `\x1b[33m[GeminiKeyManager] KEY FAILOVER: Key #${previousIndex + 1} (${failedKeyMasked}) failed (${reason || 'Quota/RateLimit'}). Auto-switched to Key #${this.currentIndex + 1} (${newKeyMasked})\x1b[0m`
    );

    return this.keys[this.currentIndex];
  }

  /**
   * Generate content with automatic key rotation and failover
   */
  async generateContentWithFailover(prompt, generationConfig = {}, modelName = 'gemini-1.5-flash') {
    if (this.keys.length === 0) {
      throw new Error('No Gemini API keys configured in pool.');
    }

    const maxAttempts = this.keys.length;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const activeKey = this.getActiveKey();
      const maskedKey = this._maskKey(activeKey);

      try {
        logger.info(`[GeminiKeyManager] Attempt ${attempt}/${maxAttempts} using Key #${this.currentIndex + 1} (${maskedKey})...`);
        
        const candidateModels = [modelName, 'gemini-1.5-flash-latest', 'gemini-2.0-flash', 'gemini-1.5-pro'].filter((m, i, arr) => arr.indexOf(m) === i);
        let response = null;
        let lastModelErr = null;

        for (const candidate of candidateModels) {
          try {
            const genAI = new GoogleGenerativeAI(activeKey);
            const model = genAI.getGenerativeModel({ model: candidate });

            response = await model.generateContent({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig,
            });

            if (response) {
              if (candidate !== modelName) {
                logger.info(`[GeminiKeyManager] Successfully resolved with fallback model: "${candidate}"`);
              }
              break;
            }
          } catch (mErr) {
            lastModelErr = mErr;
            if (mErr.message?.includes('404')) {
              logger.warn(`[GeminiKeyManager] Model "${candidate}" returned 404. Attempting next candidate...`);
              continue;
            }
            throw mErr;
          }
        }

        if (!response && lastModelErr) {
          throw lastModelErr;
        }

        // Record success
        this.rotationStats.keySuccesses[maskedKey] = (this.rotationStats.keySuccesses[maskedKey] || 0) + 1;
        logger.info(`\x1b[32m[GeminiKeyManager] Key #${this.currentIndex + 1} (${maskedKey}) successfully generated content!\x1b[0m`);
        return response;
      } catch (err) {
        lastError = err;
        logger.warn(`[GeminiKeyManager] Error with Key #${this.currentIndex + 1} (${maskedKey}): ${err.message}`);

        // Rotate to next key if more attempts remaining
        if (attempt < maxAttempts) {
          this.rotateKey(err.message);
        }
      }
    }

    throw new Error(`All ${maxAttempts} Gemini API keys exhausted. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Get public telemetry and health status of key pool
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

// Export singleton
const geminiKeyManager = new GeminiKeyManager();
module.exports = geminiKeyManager;
