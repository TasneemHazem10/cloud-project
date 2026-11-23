const express = require('express');

function createAuthRoutes({ controller, middleware, verifyTurnstile, rateLimiter, metricsAuth }) {
  const router = express.Router();

  router.get('/health', controller.health);
  router.get('/ready', controller.ready);
  router.get('/metrics', metricsAuth, controller.metricsSnapshot);
  router.post('/register', rateLimiter, verifyTurnstile, controller.register);
  router.post('/login', rateLimiter, verifyTurnstile, controller.login);
  router.get('/me', middleware.authenticate, middleware.requireDonor, controller.me);
  router.put('/profile', middleware.authenticate, middleware.requireDonor, controller.updateProfile);
  router.get('/eligibility', middleware.authenticate, middleware.requireDonor, controller.eligibility);
  router.get('/donations', middleware.authenticate, middleware.requireDonor, controller.donationHistory);
  router.post('/donations', middleware.authenticate, controller.recordDonation);
  router.get('/donors/:donorId/eligibility', middleware.authenticate, controller.eligibility);

  return router;
}

module.exports = { createAuthRoutes };
