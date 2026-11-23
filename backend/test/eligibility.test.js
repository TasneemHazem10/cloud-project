const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateEligibility, MS_PER_DAY } = require('../services/eligibility');

const now = new Date('2026-11-23T12:00:00.000Z');

test('a donor with no previous donation is eligible immediately', () => {
  const result = evaluateEligibility(null, now, 56);
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'NO_PREVIOUS_DONATION');
  assert.equal(result.nextEligibleDate, null);
  assert.equal(result.daysRemaining, 0);
  assert.equal(result.donationIntervalDays, 56);
});

test('a donation from 55 days ago blocks the next donation', () => {
  const last = new Date(now.getTime() - 55 * MS_PER_DAY).toISOString();
  const result = evaluateEligibility(last, now, 56);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'WAITING_PERIOD');
  assert.equal(result.daysRemaining, 1);
  assert.equal(result.nextEligibleDate, new Date(now.getTime() + MS_PER_DAY).toISOString());
});

test('a donation from exactly 56 days ago makes the donor eligible', () => {
  const last = new Date(now.getTime() - 56 * MS_PER_DAY).toISOString();
  const result = evaluateEligibility(last, now, 56);
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'READY');
  assert.equal(result.daysRemaining, 0);
  assert.equal(result.nextEligibleDate, now.toISOString());
});

test('the interval is configurable', () => {
  const last = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();
  const result = evaluateEligibility(last, now, 30);
  assert.equal(result.eligible, true);
  assert.equal(result.donationIntervalDays, 30);
});

test('days remaining is rounded up for partial days', () => {
  const last = new Date(now.getTime() - 50 * MS_PER_DAY + 60 * 60 * 1000).toISOString();
  const result = evaluateEligibility(last, now, 56);
  assert.equal(result.daysRemaining, 7);
});
