const { neon } = require('@neondatabase/serverless');

function createSql(databaseUrl) {
  if (!databaseUrl || !String(databaseUrl).trim()) {
    throw new Error('DATABASE_URL is not set. Add it to backend/.env or the Vercel project settings.');
  }
  return neon(String(databaseUrl).trim());
}

module.exports = { createSql };
