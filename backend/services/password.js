const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function createPasswordService(cost = 16384) {
  async function hash(plainPassword) {
    const salt = randomBytes(SALT_LENGTH).toString('hex');
    const derived = await scrypt(String(plainPassword), salt, KEY_LENGTH, { N: cost, r: 8, p: 1 });
    return `scrypt$${cost}$${salt}$${derived.toString('hex')}`;
  }

  async function verify(plainPassword, passwordHash) {
    if (!passwordHash || typeof passwordHash !== 'string') {
      return false;
    }
    const parts = passwordHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') {
      return false;
    }
    const storedCost = Number.parseInt(parts[1], 10);
    const salt = parts[2];
    const expected = Buffer.from(parts[3], 'hex');
    if (!Number.isFinite(storedCost) || !salt || expected.length === 0) {
      return false;
    }
    const actual = await scrypt(String(plainPassword), salt, expected.length, { N: storedCost, r: 8, p: 1 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  return { hash, verify };
}

module.exports = { createPasswordService };
