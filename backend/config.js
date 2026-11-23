function parseInteger(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected an integer for a configuration value, received: ${value}`);
  }
  return parsed;
}

function loadConfig(env = process.env) {
  const required = ['DATABASE_URL', 'TURNSTILE_SECRET_KEY'];
  const missing = required.filter((name) => !env[name] || !String(env[name]).trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const donationIntervalDays = parseInteger(env.DONATION_INTERVAL_DAYS, 56);
  const passwordScryptCost = parseInteger(env.PASSWORD_SCRYPT_COST, 16384);
  const rateLimitMax = parseInteger(env.RATE_LIMIT_MAX, 20);
  const rateLimitWindowMs = parseInteger(env.RATE_LIMIT_WINDOW_MS, 900000);

  if (donationIntervalDays < 1 || donationIntervalDays > 365) {
    throw new Error('DONATION_INTERVAL_DAYS must be between 1 and 365.');
  }
  if (passwordScryptCost < 1024 || passwordScryptCost > 1048576) {
    throw new Error('PASSWORD_SCRYPT_COST must be between 1024 and 1048576.');
  }

  const corsOrigins = String(env.CORS_ORIGINS || 'http://localhost:8080')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port: parseInteger(env.PORT, 3000),
    environment: String(env.NODE_ENV || 'development'),
    databaseUrl: String(env.DATABASE_URL).trim(),
    sessionExpiresIn: String(env.SESSION_EXPIRES_IN || '1h'),
    passwordScryptCost,
    donationIntervalDays,
    corsOrigins,
    turnstileSecretKey: String(env.TURNSTILE_SECRET_KEY).trim(),
    turnstileExpectedHostname: String(env.TURNSTILE_EXPECTED_HOSTNAME || '').trim(),
    internalServiceToken: String(env.INTERNAL_SERVICE_TOKEN || '').trim(),
    metricsToken: String(env.METRICS_TOKEN || '').trim(),
    rateLimitMax,
    rateLimitWindowMs,
    trustProxy: String(env.NODE_ENV || 'development') === 'production'
  };
}

module.exports = { loadConfig, parseInteger };
