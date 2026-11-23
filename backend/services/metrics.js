function createMetrics() {
  const counters = new Map();
  const startedAt = Date.now();

  function increment(name, amount = 1) {
    const key = String(name);
    counters.set(key, (counters.get(key) || 0) + amount);
  }

  function snapshot() {
    return {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      startedAt: new Date(startedAt).toISOString(),
      generatedAt: new Date().toISOString(),
      counters: Object.fromEntries(Array.from(counters.entries()).sort(([a], [b]) => a.localeCompare(b)))
    };
  }

  return { increment, snapshot };
}

module.exports = { createMetrics };
