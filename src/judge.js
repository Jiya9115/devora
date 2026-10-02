const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');

const DOCKER = cfg.sandbox === 'docker';
// Extra wall-clock time allowed on top of the problem limit to absorb JVM start-up.
let baselineMs = DOCKER ? 600 : 120;

/* ------------------------------------------------------------------ */
/* process helper                                                      */
/* ------------------------------------------------------------------ */

function runProc(cmd, args, { input = '', timeoutMs, cwd, onKill } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let outLen = 0;
    let errLen = 0;
    let timedOut = false;
    let overflow = false;
    let finished = false;

    const kill = () => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      if (onKill) onKill();
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);

    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        code,
        signal,
        timedOut,
        overflow,
        wallMs: Number(process.hrtime.bigint() - started) / 1e6,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    };

    child.stdout.on('data', (d) => {
      if (outLen < cfg.maxOutputBytes) { out.push(d); outLen += d.length; }
      else if (!overflow) { overflow = true; kill(); }
    });
    child.stderr.on('data', (d) => {
      if (errLen < 32 * 1024) { err.push(d); errLen += d.length; }
    });
    child.on('error', (e) => { err.push(Buffer.from(String(e.message))); finish(-1, null); });
    child.on('close', finish);
    child.stdin.on('error', () => {}); // program may exit before reading all input
    child.stdin.end(input);
  });
}

/* ------------------------------------------------------------------ */
/* compile + run (local or docker)                                     */
/* ------------------------------------------------------------------ */

function dockerBase(dir, name, memMb, readOnlyMount) {
  return [
    'run', '--rm', '-i', '--name', name,
    '--network', 'none',
    '--memory', `${memMb}m`, '--memory-swap', `${memMb}m`,
    '--cpus', '1', '--pids-limit', '64',
    '--user', '65534:65534', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--read-only', '--tmpfs', '/tmp:rw,size=32m',
    '-v', `${dir}:/work${readOnlyMount ? ':ro' : ''}`, '-w', '/work',
    cfg.dockerImage,
  ];
}

function compile(dir, fileName) {
  if (DOCKER) {
    const name = `vc-${crypto.randomBytes(5).toString('hex')}`;
    return runProc('docker', [...dockerBase(dir, name, 768, false), 'javac', '-encoding', 'UTF-8', fileName], {
      cwd: dir,
      timeoutMs: cfg.compileTimeoutMs,
      onKill: () => spawn('docker', ['kill', name], { stdio: 'ignore' }),
    });
  }
 return runProc(
  cfg.java,
  jvm,
  {
    input,
    cwd: dir,
    timeoutMs: budget
  }
);
}

function execute(dir, className, input, timeLimitMs, memoryMb) {
  const jvmArgs = [
    `-Xmx${memoryMb}m`,
    '-Xms16m',
    '-Xss64m',
    '-XX:+UseSerialGC',
    '-XX:-UsePerfData',
    '-Dfile.encoding=UTF-8',
    className,
  ];

  const budget = timeLimitMs + baselineMs + 400;

  if (DOCKER) {
    const name = `vr-${crypto.randomBytes(5).toString('hex')}`;

    return runProc(
      'docker',
      [
        ...dockerBase(
          dir,
          name,
          memoryMb + 192,
          true
        ),
        'java',
        ...jvmArgs,
      ],
      {
        input,
        cwd: dir,
        timeoutMs: budget + 1500,
        onKill: () =>
          spawn(
            'docker',
            ['kill', name],
            { stdio: 'ignore' }
          ),
      }
    );
  }

  return runProc(
    cfg.java,
    jvmArgs,
    {
      input,
      cwd: dir,
      timeoutMs: budget,
    }
  );
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function detectClass(code) {
  const m = code.match(/public\s+(?:final\s+|abstract\s+)*class\s+([A-Za-z_$][\w$]*)/);
  return m ? m[1] : 'Main';
}

function normalise(s) {
  const lines = s.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function clip(s, n = 4000) {
  return s.length > n ? `${s.slice(0, n)}\n… (truncated)` : s;
}

function scrub(text, dir) {
  return text.split(dir).join('.').replace(/Picked up [A-Z_]+: .*\n?/g, '');
}

/** Turn a finished process into a verdict for a single test. */
function classify(res, timeLimitMs, expected) {
  const runtime = Math.max(1, Math.round(res.wallMs - baselineMs));
  if (res.overflow) return { verdict: 'OLE', time: runtime };
  if (res.timedOut || runtime > timeLimitMs) return { verdict: 'TLE', time: Math.min(runtime, timeLimitMs) };
  if (/OutOfMemoryError/.test(res.stderr)) return { verdict: 'MLE', time: runtime };
  if (res.code !== 0) return { verdict: 'RE', time: runtime };
  if (expected === null) return { verdict: 'OK', time: runtime };
  return { verdict: normalise(res.stdout) === normalise(expected) ? 'AC' : 'WA', time: runtime };
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Judge `code` against `tests` ([{input, expected, is_sample}]).
 *  - stopOnFail: stop at the first failing test (used for real submissions)
 *  - revealAll : include input/expected/output for every test (used for "Run")
 *  - expected === null means "just run it" (custom input).
 */
async function judge({ code, tests, timeLimitMs, memoryMb, stopOnFail = true, revealAll = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devora-'));
  try {
    if (DOCKER) fs.chmodSync(dir, 0o777);
    const className = detectClass(code);
    const fileName = `${className}.java`;
    fs.writeFileSync(path.join(dir, fileName), code, 'utf8');

    const c = await compile(dir, fileName);
    if (c.code !== 0) {
      const msg = c.timedOut ? 'Compilation timed out.' : scrub(c.stderr, dir) || 'Compilation failed.';
      return { verdict: 'CE', error: clip(msg), results: [], passed: 0, total: tests.length, runtimeMs: 0 };
    }

    const results = [];
    let passed = 0;
    let maxTime = 0;
    let verdict = 'AC';

    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      const res = await execute(dir, className, t.input, timeLimitMs, memoryMb);
      const v = classify(res, timeLimitMs, t.expected);
      maxTime = Math.max(maxTime, v.time);

      const show = revealAll || t.is_sample;
      const row = { n: i + 1, verdict: v.verdict, time: v.time, sample: !!t.is_sample };
      if (show) {
        row.input = clip(t.input, 2000);
        if (t.expected !== null) row.expected = clip(t.expected, 2000);
        row.output = clip(res.stdout, 2000);
      }
      if (v.verdict === 'RE' || v.verdict === 'MLE') row.stderr = clip(scrub(res.stderr, dir), 1500);
      results.push(row);

      if (v.verdict === 'AC' || v.verdict === 'OK') passed += 1;
      else {
        if (verdict === 'AC') verdict = v.verdict;
        if (stopOnFail) break;
      }
    }
    if (verdict === 'AC' && tests.length && tests[0].expected === null) verdict = 'OK';
    return { verdict, results, passed, total: tests.length, runtimeMs: maxTime };
  } catch (e) {
    return { verdict: 'IE', error: `Judge error: ${e.message}`, results: [], passed: 0, total: tests.length, runtimeMs: 0 };
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

/* A simple FIFO limiter so a burst of submissions cannot overload the box. */
let active = 0;
const waiting = [];
function schedule(fn) {
  return new Promise((resolve, reject) => {
    const start = () => {
      active += 1;
      fn().then(resolve, reject).finally(() => {
        active -= 1;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (active < cfg.concurrency) start();
    else waiting.push(start);
  });
}

const judgeQueued = (job) => schedule(() => judge(job));

/** Measure how long an empty JVM takes so reported run-times exclude start-up. */
async function calibrate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devora-cal-'));
  try {
    if (DOCKER) fs.chmodSync(dir, 0o777);
    fs.writeFileSync(path.join(dir, 'Main.java'),
      'public class Main { public static void main(String[] a) { System.out.print("ok"); } }');
    const c = await compile(dir, 'Main.java');
    if (c.code !== 0) throw new Error(c.stderr.trim() || 'javac failed');
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const r = await execute(dir, 'Main', '', 5000, 64);
      if (r.code === 0) samples.push(r.wallMs);
    }
    if (!samples.length) throw new Error('java did not run');
    baselineMs = Math.round(Math.min(...samples));
    return { ok: true, baselineMs };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

module.exports = { judgeQueued, calibrate };
