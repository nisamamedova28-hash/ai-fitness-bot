const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '7', 10);
const ACCESS_CODES = (process.env.ACCESS_CODES || '')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

function startTrial() {
  const now = Date.now();
  return {
    trialStartedAt: now,
    trialEndsAt: now + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    activated: false,
  };
}

function hasAccess(user) {
  if (!user) return false;
  if (user.activated) return true;
  return Date.now() < user.trialEndsAt;
}

function daysLeftInTrial(user) {
  if (!user || user.activated) return null;
  const ms = user.trialEndsAt - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function checkCode(code) {
  return ACCESS_CODES.includes((code || '').trim());
}

module.exports = { startTrial, hasAccess, daysLeftInTrial, checkCode };
