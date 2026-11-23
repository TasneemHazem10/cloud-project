const STORAGE_KEY = 'bloodDonationToken';

const elements = {
  authScreen: document.getElementById('auth-screen'),
  appScreen: document.getElementById('app-screen'),
  headerSession: document.getElementById('header-session'),
  headerEmail: document.getElementById('header-email'),
  tabLogin: document.getElementById('tab-login'),
  tabRegister: document.getElementById('tab-register'),
  loginForm: document.getElementById('login-form'),
  registerForm: document.getElementById('register-form'),
  loginMessage: document.getElementById('login-message'),
  registerMessage: document.getElementById('register-message'),
  profileForm: document.getElementById('profile-form'),
  profileMessage: document.getElementById('profile-message'),
  historyMessage: document.getElementById('history-message'),
  historyCount: document.getElementById('history-count'),
  donationTableBody: document.getElementById('donation-table-body'),
  eligibilityBanner: document.getElementById('eligibility-banner'),
  eligibilityStatus: document.getElementById('eligibility-status'),
  eligibilityPill: document.getElementById('eligibility-pill'),
  eligibilityDetail: document.getElementById('eligibility-detail'),
  eligibilityDate: document.getElementById('eligibility-date'),
  eligibilityDays: document.getElementById('eligibility-days'),
  eligibilityLast: document.getElementById('eligibility-last'),
  eligibilityInterval: document.getElementById('eligibility-interval'),
  dashboardSubtitle: document.getElementById('dashboard-subtitle'),
  logoutButton: document.getElementById('logout-button'),
  refreshButton: document.getElementById('refresh-button')
};

const state = {
  token: sessionStorage.getItem(STORAGE_KEY) || '',
  widgets: { login: null, register: null }
};

function setMessage(element, text, kind) {
  element.textContent = text || '';
  element.classList.remove('is-error', 'is-success');
  if (kind) {
    element.classList.add(kind === 'error' ? 'is-error' : 'is-success');
  }
}

function formatDate(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function turnstileToken(name) {
  if (!window.turnstile || !state.widgets[name]) {
    return '';
  }
  return window.turnstile.getResponse(state.widgets[name]) || '';
}

function resetTurnstile(name) {
  if (window.turnstile && state.widgets[name]) {
    window.turnstile.reset(state.widgets[name]);
  }
}

function renderTurnstile() {
  if (!window.turnstile) {
    return;
  }
  state.widgets.login = window.turnstile.render(document.getElementById('turnstile-login'), {
    sitekey: TURNSTILE_SITE_KEY
  });
  state.widgets.register = window.turnstile.render(document.getElementById('turnstile-register'), {
    sitekey: TURNSTILE_SITE_KEY
  });
}

async function api(path, options = {}) {
  const headers = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.turnstileTokenValue) {
    headers['X-Turnstile-Token'] = options.turnstileTokenValue;
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    payload = await response.json();
  }
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message ? payload.error.message : `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.details = payload && payload.error ? payload.error.details : null;
    throw error;
  }
  return payload;
}

function switchTab(tab) {
  const isLogin = tab === 'login';
  elements.tabLogin.classList.toggle('is-active', isLogin);
  elements.tabRegister.classList.toggle('is-active', !isLogin);
  elements.tabLogin.setAttribute('aria-selected', String(isLogin));
  elements.tabRegister.setAttribute('aria-selected', String(!isLogin));
  elements.loginForm.hidden = !isLogin;
  elements.registerForm.hidden = isLogin;
  setMessage(elements.loginMessage, '');
  setMessage(elements.registerMessage, '');
}

function showAuthScreen() {
  elements.authScreen.hidden = false;
  elements.appScreen.hidden = true;
  elements.headerSession.hidden = true;
}

function showDashboard() {
  elements.authScreen.hidden = true;
  elements.appScreen.hidden = false;
  elements.headerSession.hidden = false;
}

function renderProfile(payload) {
  const profile = payload.donor;
  elements.headerEmail.textContent = payload.user.email;
  elements.dashboardSubtitle.textContent = `Signed in as ${profile.fullName}`;
  document.getElementById('profile-full-name').value = profile.fullName || '';
  document.getElementById('profile-email').value = payload.user.email || '';
  document.getElementById('profile-phone').value = profile.phone || '';
  document.getElementById('profile-blood-type').value = profile.bloodType || '';
  document.getElementById('profile-date-of-birth').value = profile.dateOfBirth || '';
  document.getElementById('profile-city').value = profile.city || '';
}

function renderEligibility(data) {
  const waiting = !data.eligible;
  elements.eligibilityBanner.classList.toggle('is-waiting', waiting);
  elements.eligibilityStatus.textContent = waiting ? 'Not eligible to donate yet' : 'You are eligible to donate';
  elements.eligibilityPill.textContent = waiting ? 'Waiting period' : 'Eligible';
  elements.eligibilityDetail.textContent = waiting
    ? `The ${data.donationIntervalDays}-day minimum interval has not passed since your last donation.`
    : data.reason === 'NO_PREVIOUS_DONATION'
      ? 'You have no previous donation recorded, so you can book a donation now.'
      : `The ${data.donationIntervalDays}-day minimum interval has passed. You can donate again.`;
  elements.eligibilityDate.textContent = formatDate(data.nextEligibleDate);
  elements.eligibilityDays.textContent = waiting ? String(data.daysRemaining) : '0';
  elements.eligibilityLast.textContent = formatDate(data.lastDonatedAt);
  elements.eligibilityInterval.textContent = `${data.donationIntervalDays} days`;
}

function renderDonations(data) {
  elements.donationTableBody.replaceChildren();
  elements.historyCount.textContent = `${data.count} donation${data.count === 1 ? '' : 's'} recorded`;

  if (!data.donations.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No donations recorded yet.';
    cell.className = 'card-subtitle';
    row.append(cell);
    elements.donationTableBody.append(row);
    return;
  }

  data.donations.forEach((donation) => {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    const locationCell = document.createElement('td');
    const amountCell = document.createElement('td');
    dateCell.textContent = formatDate(donation.donatedAt);
    locationCell.textContent = donation.location || 'Not specified';
    amountCell.textContent = `${donation.amountMl} ml`;
    row.append(dateCell, locationCell, amountCell);
    elements.donationTableBody.append(row);
  });
}

async function loadDashboard() {
  setMessage(elements.historyMessage, 'Loading your data...');
  try {
    const [profile, eligibility, history] = await Promise.all([
      api('/me'),
      api('/eligibility'),
      api('/donations')
    ]);
    renderProfile(profile);
    renderEligibility(eligibility);
    renderDonations(history);
    setMessage(elements.historyMessage, '');
  } catch (error) {
    setMessage(elements.historyMessage, error.message, 'error');
    if (error.status === 401) {
      state.token = '';
      sessionStorage.removeItem(STORAGE_KEY);
      showAuthScreen();
      setMessage(elements.loginMessage, 'Your session expired. Please log in again.', 'error');
    }
  }
}

function handleAuthSuccess(payload, messageElement) {
  state.token = payload.token;
  sessionStorage.setItem(STORAGE_KEY, payload.token);
  setMessage(messageElement, 'Signed in successfully.', 'success');
  showDashboard();
  loadDashboard();
}

elements.tabLogin.addEventListener('click', () => switchTab('login'));
elements.tabRegister.addEventListener('click', () => switchTab('register'));

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = turnstileToken('login');
  if (!token) {
    setMessage(elements.loginMessage, 'Please complete the bot check first.', 'error');
    return;
  }

  setMessage(elements.loginMessage, 'Signing in...');
  try {
    const payload = await api('/login', {
      method: 'POST',
      turnstileTokenValue: token,
      body: {
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value
      }
    });
    handleAuthSuccess(payload, elements.loginMessage);
    elements.loginForm.reset();
    resetTurnstile('login');
  } catch (error) {
    setMessage(elements.loginMessage, error.message, 'error');
    resetTurnstile('login');
  }
});

elements.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = turnstileToken('register');
  if (!token) {
    setMessage(elements.registerMessage, 'Please complete the bot check first.', 'error');
    return;
  }

  setMessage(elements.registerMessage, 'Creating your account...');
  try {
    const payload = await api('/register', {
      method: 'POST',
      turnstileTokenValue: token,
      body: {
        fullName: document.getElementById('register-full-name').value.trim(),
        email: document.getElementById('register-email').value.trim(),
        phone: document.getElementById('register-phone').value.trim(),
        bloodType: document.getElementById('register-blood-type').value,
        dateOfBirth: document.getElementById('register-date-of-birth').value,
        city: document.getElementById('register-city').value.trim(),
        password: document.getElementById('register-password').value
      }
    });
    handleAuthSuccess(payload, elements.registerMessage);
    elements.registerForm.reset();
    resetTurnstile('register');
  } catch (error) {
    const detail = error.details && error.details.length ? ` ${error.details.join(' ')}` : '';
    setMessage(elements.registerMessage, `${error.message}${detail}`, 'error');
    resetTurnstile('register');
  }
});

elements.profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(elements.profileMessage, 'Saving profile...');
  try {
    const payload = await api('/profile', {
      method: 'PUT',
      body: {
        fullName: document.getElementById('profile-full-name').value.trim(),
        phone: document.getElementById('profile-phone').value.trim(),
        bloodType: document.getElementById('profile-blood-type').value,
        dateOfBirth: document.getElementById('profile-date-of-birth').value,
        city: document.getElementById('profile-city').value.trim()
      }
    });
    renderProfile(payload);
    setMessage(elements.profileMessage, 'Profile updated.', 'success');
  } catch (error) {
    setMessage(elements.profileMessage, error.message, 'error');
  }
});

elements.logoutButton.addEventListener('click', () => {
  state.token = '';
  sessionStorage.removeItem(STORAGE_KEY);
  showAuthScreen();
  switchTab('login');
});

elements.refreshButton.addEventListener('click', loadDashboard);

renderTurnstile();
if (state.token) {
  showDashboard();
  loadDashboard();
} else {
  showAuthScreen();
}
