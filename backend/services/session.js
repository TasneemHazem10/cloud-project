const { createHash, randomBytes } = require('node:crypto');

const TOKEN_BYTES = 32;

function parseExpiresIn(value) {
  const text = String(value || '1h').trim();
  const match = /^(\d+)([smhd]?)$/.exec(text);
  if (!match) {
    throw new Error('SESSION_EXPIRES_IN must look like 30m, 1h, 7d or a number of seconds.');
  }
  const amount = Number.parseInt(match[1], 10);
  const unitSeconds = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
  return amount * unitSeconds;
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function createSessionService({ repository, expiresIn = '1h' }) {
  const expiresInSeconds = parseExpiresIn(expiresIn);

  async function create(identity) {
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    await repository.createSession({
      tokenHash: hashToken(token),
      userId: identity.userId,
      expiresAt
    });
    return {
      token,
      tokenType: 'Bearer',
      expiresAt,
      expiresInSeconds
    };
  }

  async function verify(token) {
    if (!token || typeof token !== 'string') {
      return null;
    }
    const session = await repository.findSessionByTokenHash(hashToken(token));
    if (!session || !session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
      return null;
    }
    return { sub: session.userId };
  }

  return { create, verify };
}

module.exports = { createSessionService, hashToken, parseExpiresIn };
