const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const isAwsEmulator = window.location.hostname.includes('floci') || window.location.port === '4566';

const API_BASE_URL = isAwsEmulator
  ? 'http://d7da4ba967.execute-api.localhost.floci.io:4566/api/auth'
  : isLocal
    ? 'http://localhost:3000/api/auth'
    : 'https://YOUR-API-PROJECT.vercel.app/api/auth';

const TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
