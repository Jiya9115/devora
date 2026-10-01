/**
 * Pure statistics helpers (no database access) so they are easy to unit-test.
 * `tz` is the client's offset from UTC in minutes (India = 330) so that "today"
 * and streaks follow the student's own calendar day.
 */
const DAY = 24 * 60 * 60 * 1000;

const dayKey = (date, tz = 0) => new Date(new Date(date).getTime() + tz * 60000).toISOString().slice(0, 10);
const shiftKey = (key, days) => new Date(new Date(`${key}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);

/** Current and longest daily streak. A streak stays alive if you were active yesterday but not yet today. */
function streaks(dates, tz = 0, now = new Date()) {
  const days = new Set(dates.map((d) => dayKey(d, tz)));
  if (!days.size) return { current: 0, longest: 0, activeDays: 0 };

  const today = dayKey(now, tz);
  let cursor = days.has(today) ? today : shiftKey(today, -1);
  let current = 0;
  while (days.has(cursor)) { current += 1; cursor = shiftKey(cursor, -1); }

  const sorted = [...days].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = shiftKey(sorted[i - 1], 1) === sorted[i] ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  return { current, longest, activeDays: days.size };
}

/** Activity per day for the last `n` days, oldest first. */
function heatmap(dates, n = 84, tz = 0, now = new Date()) {
  const counts = {};
  dates.forEach((d) => { const k = dayKey(d, tz); counts[k] = (counts[k] || 0) + 1; });
  const today = dayKey(now, tz);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = shiftKey(today, -i);
    out.push({ date, count: counts[date] || 0 });
  }
  return out;
}

/** Count items by a key, always including the default keys so charts have stable categories. */
function countBy(items, key, defaults = []) {
  const out = {};
  defaults.forEach((d) => { out[d] = 0; });
  items.forEach((i) => { out[i[key]] = (out[i[key]] || 0) + 1; });
  return out;
}

/**
 * Placement readiness score (0-100). Shown to the user with a full breakdown.
 *   DSA volume     30  weighted solves (easy 1, medium 2, hard 3) / 300
 *   Consistency    10  current streak / 30 days
 *   Skills         25  average of min(level / target, 1) over all skills
 *   Applications   15  submitted applications / 15
 *   Interviews     10  applications that reached OA, interview or offer / 5
 *   Profile        10  target role (5) + target date (5)
 */
function readiness({ easy = 0, medium = 0, hard = 0, streak = 0, skills = [], submitted = 0, reached = 0, targetRole = '', targetDate = null }) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const weighted = easy + medium * 2 + hard * 3;
  const skillAvg = skills.length ? skills.reduce((s, k) => s + clamp(k.level / (k.target || 100)), 0) / skills.length : 0;

  const breakdown = [
    { key: 'dsa', label: 'DSA volume', max: 30, points: 30 * clamp(weighted / 300), tip: 'Solve more medium and hard problems (easy counts 1, medium 2, hard 3; the goal is 300).' },
    { key: 'consistency', label: 'Consistency', max: 10, points: 10 * clamp(streak / 30), tip: 'Build a 30-day practice streak.' },
    { key: 'skills', label: 'Skills', max: 25, points: 25 * skillAvg, tip: 'Raise your skill levels towards their targets.' },
    { key: 'applications', label: 'Applications', max: 15, points: 15 * clamp(submitted / 15), tip: 'Apply to about 15 companies.' },
    { key: 'interviews', label: 'Interviews', max: 10, points: 10 * clamp(reached / 5), tip: 'Turn applications into online tests and interviews.' },
    { key: 'profile', label: 'Profile', max: 10, points: (targetRole ? 5 : 0) + (targetDate ? 5 : 0), tip: 'Set a target role and a target date in Settings.' },
  ].map((b) => ({ ...b, points: Math.round(b.points * 10) / 10 }));

  const score = Math.round(breakdown.reduce((s, b) => s + b.points, 0));
  const level = score >= 80 ? 'Placement ready' : score >= 60 ? 'Almost there' : score >= 35 ? 'Building momentum' : 'Getting started';
  return { score, level, breakdown };
}

const STATUSES = ['wishlist', 'applied', 'oa', 'interview', 'offer', 'rejected'];
const REACHED = ['oa', 'interview', 'offer'];

function pipelineSummary(apps) {
  const byStatus = countBy(apps, 'status', STATUSES);
  const submitted = apps.filter((a) => a.status !== 'wishlist').length;
  const reached = apps.filter((a) => REACHED.includes(a.status) || (a.history || []).some((h) => REACHED.includes(h.status))).length;
  return { total: apps.length, byStatus, submitted, reached, offers: byStatus.offer || 0 };
}

/** Applications with an open deadline, soonest first. */
function upcomingDeadlines(apps, now = new Date(), limit = 6) {
  return apps
    .filter((a) => a.deadline && !['offer', 'rejected'].includes(a.status))
    .map((a) => ({ ...a, daysLeft: Math.ceil((new Date(a.deadline) - now) / DAY) }))
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, limit);
}

module.exports = { STATUSES, dayKey, shiftKey, streaks, heatmap, countBy, readiness, pipelineSummary, upcomingDeadlines };
