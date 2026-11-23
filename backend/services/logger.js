function createLogger(minLevel = 'info') {
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = levels[minLevel] === undefined ? levels.info : levels[minLevel];

  function write(level, event, fields = {}) {
    if (levels[level] < threshold) {
      return;
    }
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields
    };
    const line = JSON.stringify(record);
    if (level === 'error' || level === 'warn') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields)
  };
}

module.exports = { createLogger };
