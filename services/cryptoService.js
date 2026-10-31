const crypto = require('crypto');
const env = require('../config/env');

// Key must be 32 bytes (256 bits). Convert hex string or sha256 of secret.
const getMasterKey = () => {
  if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length === 64) {
    return Buffer.from(env.ENCRYPTION_KEY, 'hex');
  }
  return crypto.createHash('sha256').update(env.ENCRYPTION_KEY || 'default_32_byte_secret_key_change_me').digest();
};

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Output format: iv:authTag:ciphertext (hex encoded)
 */
const encrypt = (text) => {
  if (!text) return null;
  const key = getMasterKey();
  const iv = crypto.randomBytes(12); // Recommended 12 bytes for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

/**
 * Decrypt ciphertext encrypted with encrypt()
 */
const decrypt = (encryptedData) => {
  if (!encryptedData) return null;
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

module.exports = {
  encrypt,
  decrypt,
};
