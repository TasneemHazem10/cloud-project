const jwt = require('jsonwebtoken');

const ISSUER = 'blood-donation-auth';
const AUDIENCE = 'blood-donation-app';

function createTokenService({ secret, expiresIn = '1h' }) {
  function sign(identity) {
    const token = jwt.sign(
      { email: identity.email, donorId: identity.donorId, role: identity.role },
      secret,
      {
        algorithm: 'HS256',
        subject: identity.userId,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn
      }
    );
    const decoded = jwt.decode(token);
    return {
      token,
      tokenType: 'Bearer',
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
      expiresInSeconds: decoded.exp - decoded.iat
    };
  }

  function verify(token) {
    try {
      return jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE
      });
    } catch (error) {
      return null;
    }
  }

  return { sign, verify };
}

module.exports = { createTokenService };
