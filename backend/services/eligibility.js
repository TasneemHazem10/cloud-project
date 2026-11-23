const MS_PER_DAY = 24 * 60 * 60 * 1000;

function evaluateEligibility(lastDonatedAt, now = new Date(), intervalDays = 56) {
  const current = now instanceof Date ? new Date(now.getTime()) : new Date(now);

  if (!lastDonatedAt) {
    return {
      eligible: true,
      reason: 'NO_PREVIOUS_DONATION',
      donationIntervalDays: intervalDays,
      lastDonatedAt: null,
      nextEligibleDate: null,
      daysRemaining: 0,
      checkedAt: current.toISOString()
    };
  }

  const last = new Date(lastDonatedAt);
  const due = new Date(last.getTime() + intervalDays * MS_PER_DAY);
  const eligible = current.getTime() >= due.getTime();
  const remainingMs = Math.max(0, due.getTime() - current.getTime());

  return {
    eligible,
    reason: eligible ? 'READY' : 'WAITING_PERIOD',
    donationIntervalDays: intervalDays,
    lastDonatedAt: last.toISOString(),
    nextEligibleDate: due.toISOString(),
    daysRemaining: eligible ? 0 : Math.ceil(remainingMs / MS_PER_DAY),
    checkedAt: current.toISOString()
  };
}

module.exports = { evaluateEligibility, MS_PER_DAY };
