const { validateRegistration, validateLogin, validateProfile, validateDonation, validateDonorId } = require('../utils/validation');
const { AppError } = require('../utils/errors');

function isUniqueViolation(error) {
  return Boolean(error && (error.code === '23505' || String(error.message || '').includes('duplicate key')));
}

function profilePayload(identity, donor) {
  return {
    user: {
      id: identity.userId,
      email: identity.email,
      role: identity.role,
      createdAt: identity.userCreatedAt
    },
    donor: {
      id: donor.donorId || identity.donorId,
      fullName: donor.fullName !== undefined ? donor.fullName : identity.fullName,
      phone: donor.phone !== undefined ? donor.phone : identity.phone,
      bloodType: donor.bloodType !== undefined ? donor.bloodType : identity.bloodType,
      dateOfBirth: donor.dateOfBirth !== undefined ? donor.dateOfBirth : identity.dateOfBirth,
      city: donor.city !== undefined ? donor.city : identity.city,
      createdAt: identity.donorCreatedAt
    }
  };
}

function createAuthController({ repository, passwordService, tokenService, eligibilityService, config, logger, metrics, now = () => new Date() }) {
  async function register(req, res, next) {
    try {
      const { value, problems } = validateRegistration(req.body);
      if (problems.length > 0) {
        metrics.increment('auth.register.invalid');
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid registration data.', details: problems } });
      }
      if (await repository.emailExists(value.email)) {
        metrics.increment('auth.register.duplicate');
        return res.status(409).json({ error: { code: 'EMAIL_IN_USE', message: 'An account with this email already exists.' } });
      }

      const passwordHash = await passwordService.hash(value.password);
      let created;
      try {
        created = await repository.createUserWithDonor({
          email: value.email,
          passwordHash,
          fullName: value.fullName,
          phone: value.phone,
          bloodType: value.bloodType,
          dateOfBirth: value.dateOfBirth,
          city: value.city
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          metrics.increment('auth.register.duplicate');
          return res.status(409).json({ error: { code: 'EMAIL_IN_USE', message: 'An account with this email already exists.' } });
        }
        throw error;
      }

      const issued = await tokenService.create({
        userId: created.userId,
        email: created.email,
        donorId: created.donorId,
        role: created.role
      });
      metrics.increment('auth.register.success');
      logger.info('user_registered', { requestId: req.requestId, userId: created.userId, donorId: created.donorId });
      return res.status(201).json({ ...issued, ...profilePayload(created, {}) });
    } catch (error) {
      return next(error);
    }
  }

  async function login(req, res, next) {
    try {
      const { value, problems } = validateLogin(req.body);
      if (problems.length > 0) {
        metrics.increment('auth.login.invalid');
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid login data.', details: problems } });
      }

      const user = await repository.findUserByEmail(value.email);
      const passwordMatches = user ? await passwordService.verify(value.password, user.passwordHash) : false;
      if (!user || !passwordMatches) {
        metrics.increment('auth.login.failed');
        logger.warn('login_failed', { requestId: req.requestId, email: value.email });
        return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
      }

      const identity = await repository.findIdentityByUserId(user.id);
      if (!identity) {
        metrics.increment('auth.login.failed');
        return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
      }

      const issued = await tokenService.create({
        userId: identity.userId,
        email: identity.email,
        donorId: identity.donorId,
        role: identity.role
      });
      metrics.increment('auth.login.success');
      logger.info('user_logged_in', { requestId: req.requestId, userId: identity.userId });
      return res.status(200).json({ ...issued, ...profilePayload(identity, {}) });
    } catch (error) {
      return next(error);
    }
  }

  async function me(req, res, next) {
    try {
      const identity = await repository.findIdentityByUserId(req.auth.userId);
      if (!identity) {
        throw new AppError(404, 'IDENTITY_NOT_FOUND', 'Donor profile not found.');
      }
      return res.status(200).json(profilePayload(identity, {}));
    } catch (error) {
      return next(error);
    }
  }

  async function updateProfile(req, res, next) {
    try {
      const identity = await repository.findIdentityByDonorId(req.auth.donorId);
      if (!identity) {
        throw new AppError(404, 'IDENTITY_NOT_FOUND', 'Donor profile not found.');
      }
      const { value, problems } = validateProfile(req.body, identity);
      if (problems.length > 0) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid profile data.', details: problems } });
      }
      const donor = await repository.updateDonorProfile(req.auth.donorId, value);
      metrics.increment('profile.updated');
      logger.info('profile_updated', { requestId: req.requestId, userId: req.auth.userId });
      return res.status(200).json(profilePayload(identity, donor));
    } catch (error) {
      return next(error);
    }
  }

  async function eligibility(req, res, next) {
    try {
      const problems = [];
      let donorId;
      if (req.auth.type === 'service') {
        const presented = req.params.donorId || req.query.donorId || (req.body && req.body.donorId);
        donorId = validateDonorId(presented, problems);
      } else {
        donorId = req.auth.donorId;
      }
      if (problems.length > 0) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid eligibility request.', details: problems } });
      }

      const identity = await repository.findIdentityByDonorId(donorId);
      if (!identity) {
        throw new AppError(404, 'DONOR_NOT_FOUND', 'Donor not found.');
      }
      const last = await repository.getLastDonation(donorId);
      const result = eligibilityService.evaluate(last && last.donatedAt, now(), config.donationIntervalDays);
      metrics.increment('eligibility.checked');
      logger.info('eligibility_checked', {
        requestId: req.requestId,
        donorId,
        eligible: result.eligible,
        authType: req.auth.type
      });
      return res.status(200).json({ donorId, ...result });
    } catch (error) {
      return next(error);
    }
  }

  async function donationHistory(req, res, next) {
    try {
      const identity = await repository.findIdentityByDonorId(req.auth.donorId);
      if (!identity) {
        throw new AppError(404, 'DONOR_NOT_FOUND', 'Donor not found.');
      }
      const donations = await repository.listDonations(req.auth.donorId);
      metrics.increment('donations.history_read');
      return res.status(200).json({
        donorId: req.auth.donorId,
        count: donations.length,
        donations
      });
    } catch (error) {
      return next(error);
    }
  }

  async function recordDonation(req, res, next) {
    try {
      const problems = [];
      let donorId;
      if (req.auth.type === 'service') {
        donorId = validateDonorId(req.body && req.body.donorId, problems);
      } else {
        donorId = req.auth.donorId;
      }

      const { value, problems: donationProblems } = validateDonation(req.body);
      problems.push(...donationProblems);
      if (problems.length > 0) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid donation data.', details: problems } });
      }

      const identity = await repository.findIdentityByDonorId(donorId);
      if (!identity) {
        throw new AppError(404, 'DONOR_NOT_FOUND', 'Donor not found.');
      }

      const referenceTime = value.donatedAt ? new Date(value.donatedAt) : now();
      const last = repository.getLastDonationBefore
        ? await repository.getLastDonationBefore(donorId, referenceTime.toISOString())
        : await repository.getLastDonation(donorId);
      const eligibility = eligibilityService.evaluate(last && last.donatedAt, referenceTime, config.donationIntervalDays);
      if (!eligibility.eligible) {
        metrics.increment('donation.rejected_not_eligible');
        logger.warn('donation_rejected', {
          requestId: req.requestId,
          donorId,
          nextEligibleDate: eligibility.nextEligibleDate
        });
        return res.status(409).json({
          error: {
            code: 'NOT_ELIGIBLE',
            message: 'Donor is not eligible yet.',
            details: {
              nextEligibleDate: eligibility.nextEligibleDate,
              daysRemaining: eligibility.daysRemaining,
              lastDonatedAt: eligibility.lastDonatedAt
            }
          }
        });
      }

      const donation = await repository.insertDonation({
        donorId,
        donatedAt: value.donatedAt || now().toISOString(),
        location: value.location,
        amountMl: value.amountMl
      });
      metrics.increment('donation.recorded');
      logger.info('donation_recorded', {
        requestId: req.requestId,
        donorId,
        donationId: donation.id,
        authType: req.auth.type
      });
      return res.status(201).json(donation);
    } catch (error) {
      return next(error);
    }
  }

  function health(req, res) {
    return res.status(200).json({
      status: 'ok',
      service: 'auth-identity',
      environment: config.environment,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: now().toISOString(),
      requestId: req.requestId
    });
  }

  async function ready(req, res) {
    try {
      await repository.checkDatabase();
      return res.status(200).json({ status: 'ready', database: 'ok', timestamp: now().toISOString() });
    } catch (error) {
      logger.error('database_unavailable', { requestId: req.requestId, message: error.message });
      metrics.increment('database.unavailable');
      return res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connection failed.' } });
    }
  }

  function metricsSnapshot(req, res) {
    return res.status(200).json(metrics.snapshot());
  }

  return {
    register,
    login,
    me,
    updateProfile,
    eligibility,
    donationHistory,
    recordDonation,
    health,
    ready,
    metricsSnapshot
  };
}

module.exports = { createAuthController };
