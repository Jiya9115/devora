/**
 * End-to-end check. Starts the server on a spare port with a throw-away database, then:
 *   - submits a known-good Java solution to every seeded problem  (expects Accepted)
 *   - submits deliberately broken programs                        (expects WA / TLE / RE / CE / MLE)
 *   - checks auth, run-on-samples, custom input and admin endpoints
 * Run with:  npm test
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const port = 3900 + Math.floor(Math.random() * 90);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devora-smoke-'));
const base = `http://127.0.0.1:${port}`;

let cookie = '';
let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

async function call(method, url, body, jar = true) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jar && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc && jar) cookie = sc.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function submit(slug, code) {
  const r = await call('POST', '/api/submit', { slug, code });
  if (r.status !== 202) return { verdict: `HTTP ${r.status} ${JSON.stringify(r.data)}` };
  for (let i = 0; i < 200; i++) {
    await new Promise((x) => setTimeout(x, 400));
    const s = (await call('GET', '/api/submissions/' + r.data.id)).data.submission;
    if (s.verdict !== 'Pending') return s;
  }
  return { verdict: 'timeout' };
}

(async () => {
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DISABLE_RATE_LIMIT: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  for (let i = 0; i < 60 && !log.includes('Java toolchain'); i++) {
    if (log.includes('Could not run Java')) break;
    await new Promise((x) => setTimeout(x, 250));
  }

  try {
    console.log('Auth');
    let r = await call('POST', '/api/auth/register', { username: 'tester', email: 'tester@example.com', password: 'secret123' });
    ok(r.status === 200 && r.data.user.username === 'tester', 'register');
    r = await call('POST', '/api/submit', { slug: 'two-sum', code: 'x' }, false);
    ok(r.status === 401, 'submit requires login');
    r = await call('POST', '/api/auth/register', { username: 'bad', email: 'nope', password: 'secret123' }, false);
    ok(r.status === 400, 'invalid email rejected');
    r = await call('POST', '/api/auth/login', { username: 'tester', password: 'wrong' }, false);
    ok(r.status === 401, 'wrong password rejected');

    console.log('Reference solutions (expect Accepted)');
    const refDir = path.join(root, 'tests', 'reference');
    const { problems } = (await call('GET', '/api/problems')).data;
    for (const p of problems) {
      const f = path.join(refDir, p.slug + '.java');
      if (!fs.existsSync(f)) { ok(false, `${p.slug}: no reference file`); continue; }
      const s = await submit(p.slug, fs.readFileSync(f, 'utf8'));
      ok(s.verdict === 'AC', `${p.slug.padEnd(32)} ${s.verdict} ${s.passed}/${s.total}  ${s.runtimeMs}ms ${s.error || ''}`);
    }

    console.log('Failure modes');
    const hdr = 'import java.io.*;import java.util.*;';
    let s = await submit('fast-fibonacci', `${hdr}public class Main{public static void main(String[] a){System.out.println(42);}}`);
    ok(s.verdict === 'WA', `wrong answer -> ${s.verdict}`);
    s = await submit('fast-fibonacci', `public class Main{public static void main(String[] a){while(true){}}}`);
    ok(s.verdict === 'TLE', `infinite loop -> ${s.verdict}`);
    s = await submit('fast-fibonacci', `public class Main{public static void main(String[] a){System.out.println(1/0);}}`);
    ok(s.verdict === 'RE' && /ArithmeticException/.test(JSON.stringify(s.results)), `exception -> ${s.verdict}`);
    s = await submit('fast-fibonacci', `public class Main{public static void main(String[] a){int x = "s";}}`);
    ok(s.verdict === 'CE' && /incompatible types/.test(s.error || ''), `compile error -> ${s.verdict}`);
    s = await submit('fast-fibonacci', `import java.util.*;public class Main{public static void main(String[] a){List<long[]> l=new ArrayList<>();while(true)l.add(new long[1<<20]);}}`);
    ok(s.verdict === 'MLE', `memory hog -> ${s.verdict}`);
    s = await submit('fast-fibonacci', `public class Main{public static void main(String[] a){while(true)System.out.println("spam spam spam spam");}}`);
    ok(['OLE', 'TLE'].includes(s.verdict), `endless output -> ${s.verdict}`);
    s = await submit('two-sum', fs.readFileSync(path.join(refDir, 'two-sum.java'), 'utf8')
      .replace(/HashMap<Long, Integer> seen[\s\S]*?System.out.println\(-1\);/,
        `long[] v=new long[n];for(int i=0;i<n;i++)v[i]=Long.parseLong(st.nextToken());
         for(int i=0;i<n;i++)for(int j=i+1;j<n;j++)if(v[i]+v[j]==target){System.out.println(i+" "+j);return;}`));
    ok(s.verdict === 'TLE', `O(n^2) two-sum is too slow -> ${s.verdict} (passed ${s.passed}/${s.total})`);

    console.log('Run endpoint');
    r = await call('POST', '/api/run', { slug: 'valid-parentheses', code: fs.readFileSync(path.join(refDir, 'valid-parentheses.java'), 'utf8') });
    ok(r.data.verdict === 'AC' && r.data.results.length === 3, 'run on samples');
    r = await call('POST', '/api/run', { slug: 'reverse-the-sentence', input: 'a b c\n', code: fs.readFileSync(path.join(refDir, 'reverse-the-sentence.java'), 'utf8') });
    ok(r.data.verdict === 'OK' && r.data.results[0].output.trim() === 'c b a', 'run on custom input');

    console.log('Hidden tests stay hidden');
    s = await submit('fast-fibonacci', `public class Main{public static void main(String[] a){System.out.println(0);}}`);
    ok(s.results.every((x) => x.sample ? true : x.input === undefined && x.expected === undefined), 'no hidden input/expected leaked');

    console.log('Admin');
    r = await call('POST', '/api/admin/problems', { title: 'x' });
    ok(r.status === 403, 'normal user cannot create problems');
    r = await call('POST', '/api/auth/login', { username: 'admin@devora.com', password: 'Devora@2026' });
    ok(r.status === 200 && r.data.user.role === 'admin', 'default admin logs in with email + password');
    r = await call('POST', '/api/auth/login', { username: 'tester@example.com', password: 'secret123' }, false);
    ok(r.status === 200, 'users can log in with email');
    r = await call('POST', '/api/admin/problems', {
      title: 'Add Two', slug: 'add-two', difficulty: 'Easy', tags: 'math', statement: 'Add.', timeLimitMs: 1000, memoryMb: 128,
      tests: [{ input: '1 2\n', expected: '3\n', sample: true }, { input: '5 7\n', expected: '12\n' }],
    });
    ok(r.status === 201, 'admin creates a problem');
    s = await submit('add-two', 'import java.util.*;public class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.println(s.nextInt()+s.nextInt());}}');
    ok(s.verdict === 'AC', 'new problem is judgeable');
    r = await call('DELETE', '/api/admin/problems/add-two');
    ok(r.status === 200, 'admin deletes it');

    console.log('Career tools');
    await call('POST', '/api/auth/login', { username: 'tester', password: 'secret123' });
    r = await call('POST', '/api/auth/register', { username: 'weakpw', email: 'weak@example.com', password: 'short1' }, false);
    ok(r.status === 400, 'weak password rejected');
    r = await call('POST', '/api/applications', { company: 'Acme', role: 'SDE', status: 'applied', deadline: '2030-01-05', packageLpa: 12 });
    ok(r.status === 201 && r.data.item.history.length === 1, 'create application');
    const appId = r.data.item.id;
    r = await call('PUT', '/api/applications/' + appId, { status: 'interview' });
    ok(r.data.item.status === 'interview' && r.data.item.history.length === 2, 'moving a card records history');
    r = await call('POST', '/api/applications', { company: '', role: 'x' });
    ok(r.status === 400, 'application validation');
    r = await call('POST', '/api/skills', { name: 'Java', level: 70, target: 90 });
    ok(r.status === 201, 'create skill');
    r = await call('POST', '/api/practice', { title: 'Two Sum (LeetCode)', difficulty: 'hard', topic: 'Arrays', platform: 'LeetCode' });
    ok(r.status === 201 && r.data.item.difficulty === 'hard', 'log external practice');
    r = await call('GET', '/api/dashboard?tz=330');
    const sum = r.data.summary;
    ok(sum.dsa.onDevora === 8 && sum.dsa.logged === 1 && sum.dsa.total === 9, `dashboard combines Devora solves and logged problems (${sum.dsa.total})`);
    ok(sum.pipeline.submitted === 1 && sum.pipeline.reached === 1, 'dashboard pipeline counts');
    ok(sum.readiness.score > 0 && sum.readiness.breakdown.length === 6, `readiness score ${sum.readiness.score}`);
    ok(sum.dsa.streak.current >= 1, 'streak counts today');
    r = await call('GET', '/api/export/applications.csv');
    ok(r.status === 200 && JSON.stringify(r.data) !== undefined, 'csv export responds');
    const csv = await (await fetch(base + '/api/export/applications.csv', { headers: { Cookie: cookie } })).text();
    ok(csv.includes('Acme') && csv.includes('Company,Role'), 'csv export content');
    await call('POST', '/api/applications', { company: '=cmd|calc', role: 'x' });
    const csv2 = await (await fetch(base + '/api/export/applications.csv', { headers: { Cookie: cookie } })).text();
    ok(csv2.includes("'=cmd|calc"), 'csv formula injection neutralised');

    console.log('Isolation and public profile');
    const mine = (await call('GET', '/api/applications')).data.items[0].id;
    await call('POST', '/api/auth/register', { username: 'other', email: 'other@example.com', password: 'secret123' });
    r = await call('PUT', '/api/applications/' + mine, { company: 'hacked' });
    ok(r.status === 404, "cannot edit another user's application");
    r = await call('DELETE', '/api/applications/' + mine);
    ok(r.status === 404, "cannot delete another user's application");
    r = await call('GET', '/api/applications');
    ok(r.data.items.length === 0, 'new user sees no one else\'s data');
    r = await call('GET', '/api/public/tester', null, false);
    ok(r.status === 404, 'profile is private by default');
    await call('POST', '/api/auth/login', { username: 'tester', password: 'secret123' });
    r = await call('PUT', '/api/profile', { name: 'Test User', targetRole: 'SDE', targetDate: '2030-06-01', isPublic: true });
    ok(r.data.user.isPublic && r.data.user.name === 'Test User', 'update settings');
    r = await call('GET', '/api/public/tester', null, false);
    ok(r.status === 200 && r.data.profile.name === 'Test User', 'public profile visible after opt-in');
    ok(!JSON.stringify(r.data).includes('Acme') && !JSON.stringify(r.data).includes('@example.com'), 'public profile hides companies and email');
    r = await call('POST', '/api/auth/google', { credential: 'x'.repeat(30) }, false);
    ok(r.status === 400, 'google sign-in disabled without GOOGLE_CLIENT_ID');

    r = await call('GET', '/api/leaderboard');
    ok(r.data.users.some((u) => u.username === 'tester' && u.solved >= 8), 'leaderboard lists tester with 8 solved');
  } catch (e) {
    console.error(e); failures++;
  }
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
