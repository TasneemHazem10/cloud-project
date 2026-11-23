const { sendError } = require('../utils/responses');

function notFoundHandler(req, res) {
  return sendError(res, 404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}.`);
}

function createErrorHandler({ logger, metrics, environment }) {
  return function errorHandler(error, req, res, next) {
    metrics.increment('errors.total');

    if (error && error.type === 'entity.parse.failed') {
      metrics.increment('errors.invalid_json');
      return sendError(res, 400, 'VALIDATION_ERROR', 'Malformed JSON body.');
    }
    if (error && error.type === 'entity.too.large') {
      metrics.increment('errors.payload_too_large');
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }

    const status = Number.isInteger(error && error.status) ? error.status : 500;
    const code = (error && error.code) || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    const details = error && error.details;

    logger.error('request_failed', {
      requestId: req.requestId || null,
      status,
      code,
      message: error && error.message ? error.message : 'Unknown error',
      stack: environment === 'production' ? undefined : error && error.stack ? error.stack : undefined
    });
    metrics.increment(`errors.${code}`);

    if (res.headersSent) {
      return next(error);
    }

    const message = status >= 500 ? 'Internal server error.' : error.message;
    return sendError(res, status, code, message, details);
  };
}

module.exports = { notFoundHandler, createErrorHandler };
