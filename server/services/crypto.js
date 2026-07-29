const crypto = require('crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';

function getKey() {
  return crypto.createHash('sha256').update(String(config.jwtSecret || 'esercom')).digest();
}

function encrypt(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  if (!payload) return null;
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function maskKey(key) {
  if (!key || key.length < 8) return '••••';
  return `${key.slice(0, 3)}••••••••${key.slice(-4)}`;
}

module.exports = { encrypt, decrypt, maskKey };
