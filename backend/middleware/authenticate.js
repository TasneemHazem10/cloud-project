const { timingSafeEqual } = require('node:crypto');
const { sendError } = require('../utils/responses');

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function createAuthMiddleware({ tokenService, repository, serviceToken, logger, metrics }) {
  async function authenticate(req, res, next) {
    const authorization = req.get('Authorization') || '';
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization);

    if (bearer) {
      const claims = await tokenService.verify(bearer[1].trim());
      if (!claims || !claims.sub) {
        metrics.increment('auth.invalid_token');
        return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token.');
      }
      try {
        const identity = await repository.findIdentityByUserId(claims.sub);
        if (!identity) {
          metrics.increment('auth.identity_missing');
          return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token.');
        }
        req.auth = {
          type: 'user',
          userId: identity.userId,
          donorId: identity.donorId,
          email: identity.email,
          role: identity.role
        };
        return next();
      } catch (error) {
        return next(error);
      }
    }

    const presentedServiceToken = req.get('X-Service-Token');
    if (presentedServiceToken && serviceToken && safeEqual(presentedServiceToken, serviceToken)) {
      req.auth = { type: 'service' };
      metrics.increment('auth.service_token');
      return next();
    }

    metrics.increment('auth.missing_credentials');
    return sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  function requireDonor(req, res, next) {
    if (!req.auth || req.auth.type !== 'user') {
      logger.warn('forbidden_service_call', { requestId: req.requestId, path: req.path });
      metrics.increment('auth.forbidden');
      return sendError(res, 403, 'FORBIDDEN', 'This endpoint requires a donor account.');
    }
    return next();
  }

  function requireService(req, res, next) {
    if (!req.auth || req.auth.type !== 'service') {
      return sendError(res, 403, 'FORBIDDEN', 'This endpoint requires a service token.');
    }
    return next();
  }

  return { authenticate, requireDonor, requireService };
}

module.exports = { createAuthMiddleware, safeEqual };
