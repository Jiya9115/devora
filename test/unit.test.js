const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../src/stats');
const { validate } = require('../src/validate');
const { toCsv, cell } = require('../src/csv');

const NOW = new Date('2026-10-01T10:00:00Z');
const day = (d) => `2026-${d}T12:00:00Z`;

test('streak counts consecutive days and stays alive until the end of today', () => {
  const s = stats.streaks([day('09-28'), day('09-29'), day('09-30')], 0, NOW);
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
});

test('streak breaks after a missed day but longest is remembered', () => {
  const s = stats.streaks([day('09-20'), day('09-21'), day('09-22'), day('09-30')], 0, NOW);
  assert.equal(s.current, 1);
  assert.equal(s.longest, 3);
});

test('streak follows the student time zone, not UTC', () => {
  // 22:00 UTC on 30 Sep is already 1 Oct in India (UTC+5:30)
  const s = stats.streaks(['2026-09-30T22:00:00Z'], 330, new Date('2026-10-01T05:00:00Z'));
  assert.equal(s.current, 1);
  assert.equal(stats.dayKey('2026-09-30T22:00:00Z', 330), '2026-10-01');
});

test('heatmap returns n days ending today with counts', () => {
  const h = stats.heatmap([day('10-01'), day('10-01'), day('09-30')], 7, 0, NOW);
  assert.equal(h.length, 7);
  assert.deepEqual(h[6], { date: '2026-10-01', count: 2 });
  assert.deepEqual(h[5], { date: '2026-09-30', count: 1 });
});

test('readiness is 0 for an empty profile and caps at 100', () => {
  assert.equal(stats.readiness({}).score, 0);
  const full = stats.readiness({
    easy: 100, medium: 100, hard: 100, streak: 60, skills: [{ level: 100, target: 80 }],
    submitted: 30, reached: 9, targetRole: 'SDE', targetDate: '2027-01-01',
  });
  assert.equal(full.score, 100);
  assert.equal(full.level, 'Placement ready');
});

test('readiness weights hard problems more than easy ones', () => {
  const easy = stats.readiness({ easy: 30 }).breakdown[0].points;
  const hard = stats.readiness({ hard: 30 }).breakdown[0].points;
  assert.ok(hard === easy * 3);
});

test('pipeline counts "reached" from history even after a rejection', () => {
  const p = stats.pipelineSummary([
    { status: 'rejected', history: [{ status: 'applied' }, { status: 'interview' }, { status: 'rejected' }] },
    { status: 'wishlist', history: [] },
    { status: 'applied', history: [] },
  ]);
  assert.equal(p.submitted, 2);
  assert.equal(p.reached, 1);
});

test('upcoming deadlines are sorted and skip closed applications', () => {
  const list = stats.upcomingDeadlines([
    { company: 'B', status: 'applied', deadline: '2026-10-09' },
    { company: 'A', status: 'wishlist', deadline: '2026-10-03' },
    { company: 'C', status: 'offer', deadline: '2026-10-02' },
  ], NOW);
  assert.deepEqual(list.map((a) => a.company), ['A', 'B']);
  assert.equal(list[0].daysLeft, 2);
});

test('validator enforces required fields, enums, ranges and urls', () => {
  const schema = [
    { key: 'name', col: 'name', type: 'text', max: 5, required: true },
    { key: 'level', col: 'level', type: 'int', min: 0, max: 100 },
    { key: 'kind', col: 'kind', type: 'enum', values: ['a', 'b'], fallback: 'a' },
    { key: 'link', col: 'link', type: 'url', max: 100 },
  ];
  assert.match(validate(schema, {}).error, /required/);
  assert.match(validate(schema, { name: 'toolong' }).error, /too long/);
  assert.match(validate(schema, { name: 'x', level: 101 }).error, /between/);
  assert.match(validate(schema, { name: 'x', kind: 'z' }).error, /one of/);
  assert.match(validate(schema, { name: 'x', link: 'javascript:alert(1)' }).error, /http/);
  assert.deepEqual(validate(schema, { name: ' ok ', level: '7', link: '', evil: 'ignored' }).values, { name: 'ok', level: 7, kind: 'a', link: '' });
  assert.deepEqual(validate(schema, { level: 3 }, { partial: true }).values, { level: 3 });
});

test('csv neutralises spreadsheet formulas and escapes quotes', () => {
  assert.equal(cell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(cell('+1'), "'+1");
  assert.equal(cell('a,b'), '"a,b"');
  assert.equal(toCsv([{ key: 'a', label: 'A' }], [{ a: 1 }, { a: 'x' }]), 'A\r\n1\r\nx');
});
