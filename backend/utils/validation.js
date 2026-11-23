const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+0-9 ()-]{7,30}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BLOOD_TYPES = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return typeof value === 'string' ? value.trim() : null;
}

function validateEmail(value, problems) {
  if (typeof value !== 'string') {
    problems.push('email must be a string.');
    return '';
  }
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    problems.push('email must be a valid email address of at most 254 characters.');
  }
  return email;
}

function validatePassword(value, problems) {
  if (typeof value !== 'string') {
    problems.push('password must be a string.');
    return '';
  }
  if (value.length < 8 || value.length > 72) {
    problems.push('password must be between 8 and 72 characters.');
  } else if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    problems.push('password must contain at least one letter and one number.');
  }
  return value;
}

function validateFullName(value, problems) {
  if (typeof value !== 'string') {
    problems.push('fullName must be a string.');
    return '';
  }
  const fullName = value.trim().replace(/\s+/g, ' ');
  if (fullName.length < 2 || fullName.length > 100) {
    problems.push('fullName must be between 2 and 100 characters.');
  }
  return fullName;
}

function validateOptionalPhone(value, problems) {
  const phone = optionalString(value);
  if (phone !== null && !PHONE_PATTERN.test(phone)) {
    problems.push('phone must be 7 to 30 characters using digits, spaces, +, -, ( or ).');
  }
  return phone;
}

function validateOptionalBloodType(value, problems) {
  const bloodType = optionalString(value);
  if (bloodType !== null && !BLOOD_TYPES.has(bloodType.toUpperCase())) {
    problems.push(`bloodType must be one of: ${Array.from(BLOOD_TYPES).join(', ')}.`);
    return bloodType;
  }
  return bloodType === null ? null : bloodType.toUpperCase();
}

function validateOptionalDate(value, problems) {
  const date = optionalString(value);
  if (date === null) {
    return null;
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const valid = DATE_PATTERN.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  if (!valid) {
    problems.push('dateOfBirth must be a real date in YYYY-MM-DD format.');
    return date;
  }
  if (parsed.getTime() > Date.now()) {
    problems.push('dateOfBirth cannot be in the future.');
  }
  return date;
}

function validateOptionalCity(value, problems) {
  const city = optionalString(value);
  if (city !== null && city.length > 100) {
    problems.push('city must be at most 100 characters.');
  }
  return city;
}

function validateRegistration(input) {
  const body = isObject(input) ? input : {};
  const problems = [];
  const value = {
    email: validateEmail(body.email, problems),
    password: validatePassword(body.password, problems),
    fullName: validateFullName(body.fullName, problems),
    phone: validateOptionalPhone(body.phone, problems),
    bloodType: validateOptionalBloodType(body.bloodType, problems),
    dateOfBirth: validateOptionalDate(body.dateOfBirth, problems),
    city: validateOptionalCity(body.city, problems)
  };
  return { value, problems };
}

function validateLogin(input) {
  const body = isObject(input) ? input : {};
  const problems = [];
  const value = {
    email: validateEmail(body.email, problems),
    password: typeof body.password === 'string' ? body.password : ''
  };
  if (typeof body.password !== 'string' || body.password.length === 0) {
    problems.push('password must be a non-empty string.');
  }
  return { value, problems };
}

function validateProfile(input, current) {
  const body = isObject(input) ? input : {};
  const problems = [];
  const allowed = ['fullName', 'phone', 'bloodType', 'dateOfBirth', 'city'];
  const provided = allowed.filter((field) => body[field] !== undefined);
  if (provided.length === 0) {
    problems.push('Provide at least one of: fullName, phone, bloodType, dateOfBirth, city.');
  }

  const value = {
    fullName: provided.includes('fullName') ? validateFullName(body.fullName, problems) : current.fullName,
    phone: provided.includes('phone') ? validateOptionalPhone(body.phone, problems) : current.phone || null,
    bloodType: provided.includes('bloodType') ? validateOptionalBloodType(body.bloodType, problems) : current.bloodType || null,
    dateOfBirth: provided.includes('dateOfBirth') ? validateOptionalDate(body.dateOfBirth, problems) : current.dateOfBirth || null,
    city: provided.includes('city') ? validateOptionalCity(body.city, problems) : current.city || null
  };
  return { value, problems };
}

function validateDonation(input) {
  const body = isObject(input) ? input : {};
  const problems = [];
  let donatedAt = null;
  if (body.donatedAt !== undefined && body.donatedAt !== null && body.donatedAt !== '') {
    if (typeof body.donatedAt !== 'string' || Number.isNaN(Date.parse(body.donatedAt))) {
      problems.push('donatedAt must be a valid ISO date or date-time.');
    } else {
      donatedAt = new Date(body.donatedAt).toISOString();
      if (Date.parse(donatedAt) > Date.now()) {
        problems.push('donatedAt cannot be in the future.');
      }
      if (Date.parse(donatedAt) < Date.parse('1900-01-01T00:00:00.000Z')) {
        problems.push('donatedAt cannot be before 1900-01-01.');
      }
    }
  }

  const location = optionalString(body.location);
  if (location !== null && location.length > 120) {
    problems.push('location must be at most 120 characters.');
  }

  let amountMl = 450;
  if (body.amountMl !== undefined && body.amountMl !== null && body.amountMl !== '') {
    if (!Number.isInteger(body.amountMl) && !/^\d+$/.test(String(body.amountMl))) {
      problems.push('amountMl must be a whole number between 200 and 500.');
    } else {
      amountMl = Number(body.amountMl);
      if (amountMl < 200 || amountMl > 500) {
        problems.push('amountMl must be between 200 and 500.');
      }
    }
  }

  return { value: { donatedAt, location, amountMl }, problems };
}

function validateDonorId(value, problems) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    problems.push('donorId must be a valid UUID.');
    return '';
  }
  return value;
}

module.exports = {
  validateRegistration,
  validateLogin,
  validateProfile,
  validateDonation,
  validateDonorId,
  UUID_PATTERN
};
