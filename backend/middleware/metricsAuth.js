const { safeEqual } = require('./authenticate');
const { sendError } = require('../utils/responses');

function createMetricsAuth(configuredToken) {
  return function metricsAuth(req, res, next) {
    if (!configuredToken) {
      return next();
    }
    const presented = req.get('X-Metrics-Token');
    if (!presented || !safeEqual(presented, configuredToken)) {
      return sendError(res, 403, 'FORBIDDEN', 'A valid metrics token is required.');
    }
    return next();
  };
}

module.exports = { createMetricsAuth };
