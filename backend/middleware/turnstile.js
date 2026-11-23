const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function createTurnstileVerifier({ secretKey, expectedHostname = '', fetchImpl, logger, metrics }) {
  const verifyRequest = fetchImpl || fetch;

  return async function verifyTurnstile(req, res, next) {
    const token = req.get('X-Turnstile-Token');
    if (!token) {
      metrics.increment('turnstile.missing');
      return res.status(403).json({
        error: { code: 'BOT_CHECK_FAILED', message: 'Bot check token is missing.' }
      });
    }

    if (!secretKey) {
      return next(new Error('TURNSTILE_SECRET_KEY is not set'));
    }

    try {
      const payload = { secret: secretKey, response: token };
      if (token === DUMMY_TOKEN) {
        payload.remoteip = '198.51.100.1';
      }

      const response = await verifyRequest(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });
      const result = await response.json();

      if (!result.success) {
        metrics.increment('turnstile.failed');
        logger.warn('turnstile_rejected', {
          requestId: req.requestId,
          errorCodes: result['error-codes'] || []
        });
        return res.status(403).json({
          error: { code: 'BOT_CHECK_FAILED', message: 'Bot check failed. Please try again.' }
        });
      }

      if (expectedHostname && result.hostname && result.hostname !== expectedHostname) {
        metrics.increment('turnstile.failed');
        logger.warn('turnstile_hostname_mismatch', {
          requestId: req.requestId,
          hostname: result.hostname
        });
        return res.status(403).json({
          error: { code: 'BOT_CHECK_FAILED', message: 'Bot check failed. Please try again.' }
        });
      }

      metrics.increment('turnstile.passed');
      req.turnstile = {
        hostname: result.hostname || null,
        challengeTs: result.challenge_ts || null
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createTurnstileVerifier, VERIFY_URL, DUMMY_TOKEN };
