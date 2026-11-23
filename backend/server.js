const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { loadConfig } = require('./config');
const { createSql } = require('./db/neon');
const { createAuthRepository } = require('./repositories/authRepository');
const { createPasswordService } = require('./services/password');
const { createTokenService } = require('./services/token');
const { evaluateEligibility } = require('./services/eligibility');
const { createMetrics } = require('./services/metrics');
const { createLogger } = require('./services/logger');
const { createTurnstileVerifier } = require('./middleware/turnstile');
const { createAuthMiddleware } = require('./middleware/authenticate');
const { createApp } = require('./app');

const config = loadConfig();
const logger = createLogger(config.environment === 'production' ? 'info' : 'debug');
const metrics = createMetrics();
const sql = createSql(config.databaseUrl);
const repository = createAuthRepository(sql);
const passwordService = createPasswordService(config.bcryptRounds);
const tokenService = createTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
const turnstileVerifier = createTurnstileVerifier({
  secretKey: config.turnstileSecretKey,
  expectedHostname: config.turnstileExpectedHostname,
  logger,
  metrics
});
const authMiddleware = createAuthMiddleware({
  tokenService,
  repository,
  serviceToken: config.internalServiceToken,
  logger,
  metrics
});

const app = createApp({
  config,
  repository,
  passwordService,
  tokenService,
  eligibilityService: { evaluate: evaluateEligibility },
  turnstileVerifier,
  logger,
  metrics,
  authMiddleware,
  now: () => new Date()
});

if (require.main === module) {
  app.listen(config.port, () => {
    logger.info('server_started', {
      port: config.port,
      environment: config.environment,
      corsOrigins: config.corsOrigins,
      donationIntervalDays: config.donationIntervalDays
    });
  });
}

module.exports = app;
