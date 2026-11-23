const { randomUUID } = require('node:crypto');

function createRequestLogger({ logger, metrics }) {
  return function requestLogger(req, res, next) {
    const started = process.hrtime.bigint();
    req.requestId = String(req.get('X-Request-Id') || randomUUID()).slice(0, 64);
    res.setHeader('X-Request-Id', req.requestId);

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const route = req.route ? `${req.baseUrl}${req.route.path}` : `${req.baseUrl}${req.path}`;
      metrics.increment('requests.total');
      metrics.increment(`requests.status.${res.statusCode}`);
      metrics.increment(`requests.endpoint.${req.method} ${route}`);
      logger.info('http_request', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.auth ? req.auth.userId || null : null,
        authType: req.auth ? req.auth.type : null
      });
    });

    next();
  };
}

module.exports = { createRequestLogger };
