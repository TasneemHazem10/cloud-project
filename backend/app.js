const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { createAuthController } = require('./controllers/authController');
const { createAuthRoutes } = require('./routes/authRoutes');
const { createRequestLogger } = require('./middleware/requestLogger');
const { createErrorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { createMetricsAuth } = require('./middleware/metricsAuth');

function createApp(dependencies) {
  const { config, repository, passwordService, tokenService, eligibilityService, turnstileVerifier, logger, metrics, authMiddleware, now } = dependencies;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token', 'X-Service-Token', 'X-Metrics-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use(createRequestLogger({ logger, metrics }));

  const rateLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } }
  });

  const controller = createAuthController({
    repository,
    passwordService,
    tokenService,
    eligibilityService,
    config,
    logger,
    metrics,
    now
  });

  app.get('/', (req, res) => {
    res.status(200).json({
      name: 'Blood Donation Authentication and Identity API',
      endpoints: [
        '/api/auth/health',
        '/api/auth/ready',
        '/api/auth/metrics',
        '/api/auth/register',
        '/api/auth/login',
        '/api/auth/me',
        '/api/auth/profile',
        '/api/auth/eligibility',
        '/api/auth/donations',
        '/api/auth/donors/:donorId/eligibility'
      ]
    });
  });

  app.use('/api/auth', createAuthRoutes({
    controller,
    middleware: authMiddleware,
    verifyTurnstile: turnstileVerifier,
    rateLimiter,
    metricsAuth: createMetricsAuth(config.metricsToken)
  }));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, metrics, environment: config.environment }));

  return app;
}

module.exports = { createApp };
