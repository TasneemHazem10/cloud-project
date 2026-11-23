const test = require('node:test');
const assert = require('node:assert/strict');
const { before, after } = require('node:test');

const { createApp } = require('../app');
const { createAuthRepository } = require('../repositories/authRepository');
const { createPasswordService } = require('../services/password');
const { createTokenService } = require('../services/token');
const { evaluateEligibility, MS_PER_DAY } = require('../services/eligibility');
const { createMetrics } = require('../services/metrics');
const { createAuthMiddleware } = require('../middleware/authenticate');
const { createFakeRepository, createSilentLogger } = require('../testing/fakes');

const SERVICE_TOKEN = 'integration-service-token-123';
const METRICS_TOKEN = 'metrics-token-123';
const repository = createFakeRepository();
const logger = createSilentLogger();
const metrics = createMetrics();
const passwordService = createPasswordService(4);
const tokenService = createTokenService({
  secret: 'a-test-only-jwt-secret-that-is-long-enough',
  expiresIn: '1h'
});
const authMiddleware = createAuthMiddleware({
  tokenService,
  repository,
  serviceToken: SERVICE_TOKEN,
  logger,
  metrics
});

const config = {
  environment: 'test',
  corsOrigins: ['http://localhost:8080'],
  donationIntervalDays: 56,
  metricsToken: METRICS_TOKEN,
  trustProxy: false,
  rateLimitMax: 1000,
  rateLimitWindowMs: 60000
};

const turnstileVerifier = (req, res, next) => {
  const token = req.get('X-Turnstile-Token');
  if (!token || token === 'INVALID') {
    return res.status(403).json({ error: { code: 'BOT_CHECK_FAILED', message: 'Bot check failed.' } });
  }
  return next();
};

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

let server;
let baseUrl;
let token;
let donorId;
let userId;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.turnstile !== false) {
    headers['X-Turnstile-Token'] = options.turnstile || 'VALID';
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers
  };
}

const registration = {
  email: 'Tasneem@Example.com',
  password: 'Blood2026',
  fullName: 'Tasneem Ali',
  phone: '+12345678901',
  bloodType: 'o+',
  dateOfBirth: '2000-05-14',
  city: 'Amman'
};

test('GET /api/auth/health returns 200 without touching the database', async () => {
  const response = await api('/api/auth/health', { turnstile: false });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.service, 'auth-identity');
  assert.ok(response.headers.get('x-request-id'));
});

test('GET /api/auth/ready returns 200 when the database is reachable', async () => {
  const response = await api('/api/auth/ready', { turnstile: false });
  assert.equal(response.status, 200);
  assert.equal(response.body.database, 'ok');
});

test('POST /api/auth/register creates a user and a donor and returns a JWT', async () => {
  const response = await api('/api/auth/register', { method: 'POST', body: registration });
  assert.equal(response.status, 201);
  assert.equal(response.body.user.email, 'tasneem@example.com');
  assert.equal(response.body.donor.fullName, 'Tasneem Ali');
  assert.equal(response.body.donor.bloodType, 'O+');
  assert.equal(response.body.tokenType, 'Bearer');
  assert.ok(response.body.token);
  assert.equal(response.body.passwordHash, undefined);
  assert.equal(response.body.user.passwordHash, undefined);
  token = response.body.token;
  userId = response.body.user.id;
  donorId = response.body.donor.id;
});

test('POST /api/auth/register rejects a missing Turnstile token with 403', async () => {
  const response = await api('/api/auth/register', {
    method: 'POST',
    turnstile: false,
    body: { ...registration, email: 'no-token@example.com' }
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'BOT_CHECK_FAILED');
});

test('POST /api/auth/register rejects a rejected Turnstile token with 403', async () => {
  const response = await api('/api/auth/register', {
    method: 'POST',
    turnstile: 'INVALID',
    body: { ...registration, email: 'bad-token@example.com' }
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'BOT_CHECK_FAILED');
});

test('POST /api/auth/register validates email, password and name', async () => {
  const response = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'not-an-email', password: 'short', fullName: 'A' }
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.ok(response.body.error.details.length >= 3);
});

test('POST /api/auth/register prevents duplicate emails with 409', async () => {
  const response = await api('/api/auth/register', { method: 'POST', body: registration });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'EMAIL_IN_USE');
});

test('POST /api/auth/login rejects wrong passwords with a generic 401', async () => {
  const response = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'tasneem@example.com', password: 'Wrong2026' }
  });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
});

test('POST /api/auth/login does not disclose unknown accounts', async () => {
  const response = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'unknown@example.com', password: 'Blood2026' }
  });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
});

test('POST /api/auth/login returns a signed token for valid credentials', async () => {
  const response = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'TASNEEM@example.com', password: 'Blood2026' }
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.token);
  assert.equal(response.body.user.id, userId);
});

test('protected endpoints reject requests without a token', async () => {
  const response = await api('/api/auth/me', { turnstile: false });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
});

test('protected endpoints reject tampered tokens', async () => {
  const response = await api('/api/auth/me', { token: `${token}tampered`, turnstile: false });
  assert.equal(response.status, 401);
});

test('GET /api/auth/me returns the authenticated profile', async () => {
  const response = await api('/api/auth/me', { token, turnstile: false });
  assert.equal(response.status, 200);
  assert.equal(response.body.user.id, userId);
  assert.equal(response.body.donor.id, donorId);
});

test('GET /api/auth/eligibility reports eligible before any donation', async () => {
  const response = await api('/api/auth/eligibility', { token, turnstile: false });
  assert.equal(response.status, 200);
  assert.equal(response.body.eligible, true);
  assert.equal(response.body.reason, 'NO_PREVIOUS_DONATION');
  assert.equal(response.body.nextEligibleDate, null);
  assert.equal(response.body.donationIntervalDays, 56);
});

test('POST /api/auth/donations records an old donation and eligibility stays true', async () => {
  const donatedAt = new Date(Date.now() - 100 * MS_PER_DAY).toISOString();
  const response = await api('/api/auth/donations', {
    method: 'POST',
    token,
    body: { donatedAt, location: 'City Clinic', amountMl: '450' }
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.donorId, donorId);
  assert.equal(response.body.amountMl, 450);

  const eligibility = await api('/api/auth/eligibility', { token, turnstile: false });
  assert.equal(eligibility.body.eligible, true);
});

test('POST /api/auth/donations records a current donation', async () => {
  const response = await api('/api/auth/donations', {
    method: 'POST',
    token,
    body: { location: 'Main Blood Bank' }
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.location, 'Main Blood Bank');
});

test('GET /api/auth/eligibility calculates the next eligible date from the last donation', async () => {
  const response = await api('/api/auth/eligibility', { token, turnstile: false });
  assert.equal(response.status, 200);
  assert.equal(response.body.eligible, false);
  assert.equal(response.body.reason, 'WAITING_PERIOD');
  assert.equal(response.body.daysRemaining, 56);
  assert.match(response.body.nextEligibleDate, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(response.body.lastDonatedAt);
});

test('POST /api/auth/donations blocks a second donation inside the 56-day window', async () => {
  const response = await api('/api/auth/donations', {
    method: 'POST',
    token,
    body: { amountMl: 450 }
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'NOT_ELIGIBLE');
  assert.equal(response.body.error.details.daysRemaining, 56);
});

test('GET /api/auth/donations returns the history sorted newest first', async () => {
  const response = await api('/api/auth/donations', { token, turnstile: false });
  assert.equal(response.status, 200);
  assert.equal(response.body.count, 2);
  assert.equal(response.body.donations[0].location, 'Main Blood Bank');
  assert.equal(response.body.donations[1].location, 'City Clinic');
});

test('GET /api/auth/donors/:donorId/eligibility works with a service token for Booking', async () => {
  const response = await api(`/api/auth/donors/${donorId}/eligibility`, {
    turnstile: false,
    headers: { 'X-Service-Token': SERVICE_TOKEN }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.donorId, donorId);
  assert.equal(response.body.eligible, false);
});

test('service calls without a valid service token are rejected', async () => {
  const response = await api(`/api/auth/donors/${donorId}/eligibility`, {
    turnstile: false,
    headers: { 'X-Service-Token': 'wrong-token' }
  });
  assert.equal(response.status, 401);
});

test('check-in can record a donation with a service token and a donorId', async () => {
  const response = await api('/api/auth/donations', {
    method: 'POST',
    turnstile: false,
    headers: { 'X-Service-Token': SERVICE_TOKEN },
    body: {
      donorId,
      donatedAt: new Date(Date.now() - 200 * MS_PER_DAY).toISOString(),
      location: 'Campus Check-in',
      amountMl: 500
    }
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.donorId, donorId);
  assert.equal(response.body.amountMl, 500);
});

test('service recording rejects a missing or invalid donorId', async () => {
  const response = await api('/api/auth/donations', {
    method: 'POST',
    turnstile: false,
    headers: { 'X-Service-Token': SERVICE_TOKEN },
    body: { donorId: 'not-a-uuid' }
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PUT /api/auth/profile updates donor details', async () => {
  const response = await api('/api/auth/profile', {
    method: 'PUT',
    token,
    turnstile: false,
    body: { fullName: 'Tasneem Ali Updated', city: 'Dubai', bloodType: 'a-' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.donor.fullName, 'Tasneem Ali Updated');
  assert.equal(response.body.donor.city, 'Dubai');
  assert.equal(response.body.donor.bloodType, 'A-');
  assert.equal(response.body.donor.phone, '+12345678901');
});

test('PUT /api/auth/profile rejects invalid input', async () => {
  const response = await api('/api/auth/profile', {
    method: 'PUT',
    token,
    turnstile: false,
    body: { bloodType: 'Z-' }
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/auth/donations rejects a future date and an invalid amount', async () => {
  const response = await api('/api/auth/donations', {
    method: 'POST',
    token,
    body: { donatedAt: '2999-01-01T00:00:00.000Z', amountMl: 900 }
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/auth/metrics is protected and reports counters', async () => {
  const denied = await api('/api/auth/metrics', {
    turnstile: false,
    headers: { 'X-Metrics-Token': 'wrong' }
  });
  assert.equal(denied.status, 403);

  const response = await api('/api/auth/metrics', {
    turnstile: false,
    headers: { 'X-Metrics-Token': METRICS_TOKEN }
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.counters['requests.total'] > 0);
  assert.equal(response.body.counters['auth.register.success'], 1);
  assert.equal(response.body.counters['auth.login.success'], 1);
  assert.ok(response.body.counters['donation.recorded'] >= 3);
});

test('unknown routes return 404 with the standard error shape', async () => {
  const response = await api('/api/auth/not-a-route', { turnstile: false });
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
});

test('the repository layer exports all required data operations', () => {
  const directRepository = createAuthRepository(async () => []);
  assert.deepEqual(Object.keys(directRepository).sort(), [
    'checkDatabase',
    'createUserWithDonor',
    'emailExists',
    'findIdentityByDonorId',
    'findIdentityByUserId',
    'findUserByEmail',
    'getLastDonation',
    'getLastDonationBefore',
    'insertDonation',
    'listDonations',
    'updateDonorProfile'
  ]);
});
