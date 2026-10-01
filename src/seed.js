/**
 * Starter problem set. Test data is generated with a seeded PRNG and the
 * expected output comes from the reference implementations below, so the data
 * is reproducible and large inputs can be used to separate fast from slow code.
 */
const { db, tx } = require('./db');

/* ---------- deterministic random ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

const STARTER = `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        // Read the input, solve the problem, print the answer.
    }
}
`;

const problems = [];
const add = (p) => problems.push(p);

/* ================================================================== */
/* 1. Two Sum                                                          */
/* ================================================================== */
{
  const solve = (a, target) => {
    const seen = new Map();
    for (let i = 0; i < a.length; i++) {
      const need = target - a[i];
      if (seen.has(need)) return `${seen.get(need)} ${i}`;
      seen.set(a[i], i);
    }
    return '-1';
  };
  const mk = (a, target) => ({ input: `${a.length} ${target}\n${a.join(' ')}\n`, expected: `${solve(a, target)}\n` });
  const r = rng(11);
  const big = (n, range, late = false) => {
    for (;;) {
      const a = [];
      const used = new Set();
      while (a.length < n) {
        const v = ri(r, -range, range);
        if (!used.has(v)) { used.add(v); a.push(v); }
      }
      // `late` hides the answer at the very end so a pair-by-pair scan has to do all its work
      let i = late ? n - 2 - ri(r, 0, 20) : ri(r, 0, n - 1);
      let j = late ? n - 1 : ri(r, 0, n - 1);
      if (i === j) j = (j + 1) % n;
      const target = a[i] + a[j];
      let pairs = 0;
      const idx = new Map(a.map((v, k) => [v, k]));
      for (let k = 0; k < n; k++) { const o = idx.get(target - a[k]); if (o !== undefined && o > k) pairs++; }
      if (pairs === 1) return mk(a, target);
    }
  };
  add({
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    tags: 'array,hash-table',
    time_limit_ms: 1500,
    memory_mb: 256,
    statement: `You are given an array of **n** distinct integers and an integer **target**. Exactly one pair of different positions adds up to the target.

Print the two 0-based indices *i* and *j* with *i < j* whose values sum to the target.

### Input

The first line contains **n** and **target**. The second line contains the **n** integers of the array.

### Output

Two integers separated by a space: the indices *i* and *j*, with *i < j*.

### Constraints

- 2 ≤ n ≤ 100 000
- Values and target fit in a signed 64-bit integer (|a[i]| ≤ 10^12)
- Exactly one valid pair exists

A double loop over all pairs does about 5·10^9 steps for the largest input, which is too slow. Think about what you can remember while walking the array once.`,
    tests: [
      { sample: true, ...mk([2, 7, 11, 15], 9) },
      { sample: true, ...mk([3, 2, 4], 6) },
      { sample: true, ...mk([-3, 4, 3, 90], 0) },
      mk([5, 75, 25], 100),
      mk([1000000000000, -999999999999, 7, 8], 1),
      big(50, 100000),
      big(2000, 1000000),
      big(100000, 1000000000000, true),
      big(100000, 1000000000000, true),
    ],
  });
}

/* ================================================================== */
/* 2. Valid Parentheses                                                */
/* ================================================================== */
{
  const solve = (s) => {
    const st = [];
    const pair = { ')': '(', ']': '[', '}': '{' };
    for (const c of s) {
      if ('([{'.includes(c)) st.push(c);
      else if (st.pop() !== pair[c]) return 'false';
    }
    return st.length ? 'false' : 'true';
  };
  const mk = (s) => ({ input: `${s}\n`, expected: `${solve(s)}\n` });
  const r = rng(22);
  const balanced = (len) => {
    const open = '([{';
    const close = ')]}';
    const st = [];
    let out = '';
    while (out.length < len) {
      const left = len - out.length;
      if (st.length && (st.length >= left || r() < 0.5)) out += close[st.pop()];
      else { const k = ri(r, 0, 2); st.push(k); out += open[k]; }
    }
    while (st.length) out += close[st.pop()];
    return out;
  };
  const broken = (len) => {
    const s = balanced(len).split('');
    const k = ri(r, 0, s.length - 1);
    s[k] = s[k] === ')' ? ']' : ')';
    return s.join('');
  };
  add({
    slug: 'valid-parentheses',
    title: 'Valid Parentheses',
    difficulty: 'Easy',
    tags: 'stack,string',
    time_limit_ms: 1000,
    memory_mb: 256,
    statement: `A string made only of the characters \`(\`, \`)\`, \`[\`, \`]\`, \`{\` and \`}\` is **valid** if every opening bracket is closed by a bracket of the same type, and brackets are closed in the correct order.

Decide whether the given string is valid.

### Input

One line containing the string.

### Output

Print \`true\` if the string is valid and \`false\` otherwise.

### Constraints

- 1 ≤ length ≤ 200 000`,
    tests: [
      { sample: true, ...mk('()[]{}') },
      { sample: true, ...mk('(]') },
      { sample: true, ...mk('([{}])') },
      mk('((('),
      mk(')'),
      mk('{[()()]}[{}]'),
      mk('([)]'),
      mk(balanced(200000)),
      mk(broken(199999)),
      mk('('.repeat(100000) + ')'.repeat(99999)),
    ],
  });
}

/* ================================================================== */
/* 3. Reverse the Sentence                                             */
/* ================================================================== */
{
  const solve = (s) => s.split(/\s+/).filter(Boolean).reverse().join(' ');
  const mk = (s) => ({ input: `${s}\n`, expected: `${solve(s)}\n` });
  const r = rng(33);
  const words = 'alpha beta gamma delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango'.split(' ');
  const sentence = (n) => Array.from({ length: n }, () => words[ri(r, 0, words.length - 1)] + ' '.repeat(ri(r, 1, 3))).join('');
  add({
    slug: 'reverse-the-sentence',
    title: 'Reverse the Sentence',
    difficulty: 'Easy',
    tags: 'string',
    time_limit_ms: 1000,
    memory_mb: 256,
    statement: `Given a line of text, print its words in reverse order.

Words are separated by one or more spaces. The input may start or end with spaces. Your output must contain the words separated by exactly one space, with no leading or trailing spaces.

### Input

A single line of text made of lowercase letters and spaces.

### Output

The words of the line in reverse order, separated by single spaces.

### Constraints

- 1 ≤ length of the line ≤ 100 000
- The line contains at least one word`,
    tests: [
      { sample: true, ...mk('the sky is blue') },
      { sample: true, ...mk('  hello   world  ') },
      { sample: true, ...mk('single') },
      mk('a b c d e f g'),
      mk('   leading and trailing   '),
      mk(sentence(40)),
      mk(sentence(12000).slice(0, 100000)),
    ],
  });
}

/* ================================================================== */
/* 4. Maximum Subarray                                                 */
/* ================================================================== */
{
  const solve = (a) => {
    let best = -Infinity;
    let cur = 0;
    for (const x of a) { cur = Math.max(x, cur + x); best = Math.max(best, cur); }
    return best;
  };
  const mk = (a) => ({ input: `${a.length}\n${a.join(' ')}\n`, expected: `${solve(a)}\n` });
  const r = rng(44);
  const arr = (n, lo, hi) => Array.from({ length: n }, () => ri(r, lo, hi));
  add({
    slug: 'maximum-subarray',
    title: 'Maximum Subarray Sum',
    difficulty: 'Medium',
    tags: 'array,dynamic-programming',
    time_limit_ms: 1500,
    memory_mb: 256,
    statement: `Given an array of **n** integers, find the largest possible sum of a non-empty contiguous subarray.

### Input

The first line contains **n**. The second line contains the **n** integers.

### Output

A single integer: the maximum sum of a contiguous, non-empty subarray.

### Constraints

- 1 ≤ n ≤ 200 000
- |a[i]| ≤ 10^9

The answer can be larger than a 32-bit integer. Use \`long\`.`,
    tests: [
      { sample: true, ...mk([-2, 1, -3, 4, -1, 2, 1, -5, 4]) },
      { sample: true, ...mk([1]) },
      { sample: true, ...mk([-5, -2, -9]) },
      mk([5, 4, -1, 7, 8]),
      mk([-1000000000, -1000000000]),
      mk(arr(1000, -50, 50)),
      mk(arr(200000, -1000000000, 1000000000)),
      mk(Array(200000).fill(1000000000)),
      mk(arr(200000, -1000000000, 100000000)),
    ],
  });
}

/* ================================================================== */
/* 5. Fast Fibonacci                                                   */
/* ================================================================== */
{
  const MOD = 1000000007n;
  const fib = (n) => {
    // fast doubling
    const go = (k) => {
      if (k === 0n) return [0n, 1n];
      const [a, b] = go(k >> 1n);
      const c = (a * ((2n * b - a + MOD) % MOD)) % MOD;
      const d = (a * a + b * b) % MOD;
      return k & 1n ? [d, (c + d) % MOD] : [c, d];
    };
    return go(n)[0];
  };
  const mk = (n) => ({ input: `${n}\n`, expected: `${fib(BigInt(n))}\n` });
  add({
    slug: 'fast-fibonacci',
    title: 'Fast Fibonacci',
    difficulty: 'Medium',
    tags: 'math,matrix-exponentiation',
    time_limit_ms: 1000,
    memory_mb: 256,
    statement: `The Fibonacci numbers are defined by F(0) = 0, F(1) = 1 and F(k) = F(k−1) + F(k−2).

Compute F(n) modulo 1 000 000 007.

### Input

A single integer **n**.

### Output

F(n) mod 1 000 000 007.

### Constraints

- 0 ≤ n ≤ 10^18

A loop that adds numbers one at a time would need up to 10^18 steps. You need a way to jump ahead: matrix exponentiation or the fast-doubling identities both take O(log n).`,
    tests: [
      { sample: true, ...mk(0) },
      { sample: true, ...mk(10) },
      { sample: true, ...mk(50) },
      mk(1),
      mk(90),
      mk(1000000),
      mk('1000000000000'),
      mk('999999999999999999'),
      mk('1000000000000000000'),
    ],
  });
}

/* ================================================================== */
/* 6. Longest Increasing Subsequence                                   */
/* ================================================================== */
{
  const solve = (a) => {
    const t = [];
    for (const x of a) {
      let lo = 0;
      let hi = t.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; }
      t[lo] = x;
    }
    return t.length;
  };
  const mk = (a) => ({ input: `${a.length}\n${a.join(' ')}\n`, expected: `${solve(a)}\n` });
  const r = rng(66);
  const arr = (n, lo, hi) => Array.from({ length: n }, () => ri(r, lo, hi));
  add({
    slug: 'longest-increasing-subsequence',
    title: 'Longest Increasing Subsequence',
    difficulty: 'Medium',
    tags: 'dynamic-programming,binary-search',
    time_limit_ms: 2000,
    memory_mb: 256,
    statement: `Given a sequence of **n** integers, find the length of its longest strictly increasing subsequence. A subsequence keeps the original order but may skip elements.

### Input

The first line contains **n**. The second line contains the **n** integers.

### Output

A single integer: the length of the longest strictly increasing subsequence.

### Constraints

- 1 ≤ n ≤ 100 000
- |a[i]| ≤ 10^9

The classic O(n²) table fills 10^10 cells at the maximum size. An O(n log n) method exists.`,
    tests: [
      { sample: true, ...mk([10, 9, 2, 5, 3, 7, 101, 18]) },
      { sample: true, ...mk([0, 1, 0, 3, 2, 3]) },
      { sample: true, ...mk([7, 7, 7, 7]) },
      mk([1]),
      mk(arr(500, -1000, 1000)),
      mk(arr(100000, -1000000000, 1000000000)),
      mk(Array.from({ length: 100000 }, (_, i) => i - 50000)),
      mk(Array.from({ length: 100000 }, (_, i) => 100000 - i)),
      mk(arr(100000, 0, 300)),
    ],
  });
}

/* ================================================================== */
/* 7. Shortest Path in a Maze                                          */
/* ================================================================== */
{
  const solve = (g) => {
    const R = g.length;
    const C = g[0].length;
    let s = null;
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) if (g[i][j] === 'S') s = [i, j];
    const dist = new Int32Array(R * C).fill(-1);
    const q = new Int32Array(R * C);
    let h = 0;
    let t = 0;
    q[t++] = s[0] * C + s[1];
    dist[q[0]] = 0;
    while (h < t) {
      const cur = q[h++];
      const i = (cur / C) | 0;
      const j = cur % C;
      if (g[i][j] === 'E') return dist[cur];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= R || b >= C || g[a][b] === '#' || dist[a * C + b] !== -1) continue;
        dist[a * C + b] = dist[cur] + 1;
        q[t++] = a * C + b;
      }
    }
    return -1;
  };
  const mk = (rows) => ({ input: `${rows.length} ${rows[0].length}\n${rows.join('\n')}\n`, expected: `${solve(rows)}\n` });
  const r = rng(77);
  const maze = (R, C, wall) => {
    const g = Array.from({ length: R }, () => Array.from({ length: C }, () => (r() < wall ? '#' : '.')));
    g[0][0] = 'S';
    g[R - 1][C - 1] = 'E';
    return g.map((row) => row.join(''));
  };
  add({
    slug: 'maze-shortest-path',
    title: 'Shortest Path in a Maze',
    difficulty: 'Medium',
    tags: 'graph,bfs',
    time_limit_ms: 2000,
    memory_mb: 256,
    statement: `You are given a rectangular maze. \`S\` is the start, \`E\` is the exit, \`.\` is an open cell and \`#\` is a wall. In one step you may move to an adjacent open cell (up, down, left or right). \`S\` and \`E\` are also open cells.

Find the minimum number of steps needed to get from \`S\` to \`E\`.

### Input

The first line contains two integers **R** and **C**. The next **R** lines each contain a string of **C** characters describing the maze.

### Output

The minimum number of steps, or \`-1\` if the exit cannot be reached.

### Constraints

- 1 ≤ R, C ≤ 700
- Exactly one \`S\` and one \`E\``,
    tests: [
      { sample: true, ...mk(['S..#', '.#..', '...E']) },
      { sample: true, ...mk(['S#E']) },
      { sample: true, ...mk(['SE']) },
      mk(['S.#....', '.##.##.', '....#..', '.####.#', '......E']),
      mk(maze(30, 30, 0.2)),
      mk(maze(200, 200, 0.3)),
      mk(maze(700, 700, 0.25)),
      mk(maze(700, 700, 0.45)),
      mk(['S' + '.'.repeat(698) + '#', ...Array.from({ length: 698 }, () => '#'.repeat(699) + '#'), '#'.repeat(699) + 'E']),
    ],
  });
}

/* ================================================================== */
/* 8. Cheapest Route (Dijkstra)                                        */
/* ================================================================== */
{
  const solve = (n, edges) => {
    const adj = Array.from({ length: n + 1 }, () => []);
    for (const [u, v, w] of edges) { adj[u].push([v, w]); adj[v].push([u, w]); }
    const dist = new Array(n + 1).fill(Infinity);
    dist[1] = 0;
    const heap = [[0, 1]];
    const push = (x) => {
      heap.push(x);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          let m = i;
          const l = 2 * i + 1;
          const rr = l + 1;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      for (const [v, w] of adj[u]) if (d + w < dist[v]) { dist[v] = d + w; push([dist[v], v]); }
    }
    return dist[n] === Infinity ? -1 : dist[n];
  };
  const mk = (n, edges) => ({
    input: `${n} ${edges.length}\n${edges.map((e) => e.join(' ')).join('\n')}\n`,
    expected: `${solve(n, edges)}\n`,
  });
  const r = rng(88);
  const graph = (n, m, maxW) => {
    const e = [];
    for (let i = 2; i <= n; i++) e.push([ri(r, 1, i - 1), i, ri(r, 1, maxW)]); // keeps it connected
    while (e.length < m) {
      const u = ri(r, 1, n);
      const v = ri(r, 1, n);
      if (u !== v) e.push([u, v, ri(r, 1, maxW)]);
    }
    return e;
  };
  add({
    slug: 'cheapest-route',
    title: 'Cheapest Route',
    difficulty: 'Hard',
    tags: 'graph,dijkstra,heap',
    time_limit_ms: 2500,
    memory_mb: 256,
    statement: `A country has **n** cities numbered 1 to **n** and **m** two-way roads. Each road joins two cities and has a toll.

Find the smallest total toll you must pay to travel from city 1 to city **n**.

### Input

The first line contains **n** and **m**. Each of the next **m** lines contains three integers **u**, **v**, **w**: a road between cities *u* and *v* with toll *w*.

### Output

The minimum total toll from city 1 to city *n*, or \`-1\` if city *n* cannot be reached.

### Constraints

- 2 ≤ n ≤ 100 000
- 1 ≤ m ≤ 300 000
- 1 ≤ w ≤ 10^9
- Several roads may join the same pair of cities

Total tolls can exceed the range of a 32-bit integer. Read the input with a buffered reader; there can be 300 000 lines.`,
    tests: [
      { sample: true, ...mk(4, [[1, 2, 4], [1, 3, 1], [3, 2, 2], [2, 4, 5]]) },
      { sample: true, ...mk(3, [[1, 2, 7]]) },
      { sample: true, ...mk(2, [[1, 2, 1000000000], [1, 2, 5]]) },
      mk(5, [[1, 2, 2], [2, 3, 2], [3, 5, 2], [1, 4, 1], [4, 5, 10]]),
      mk(200, graph(200, 600, 100)),
      mk(5000, graph(5000, 20000, 1000000000)),
      mk(100000, graph(100000, 300000, 1000000000)),
      mk(100000, Array.from({ length: 99999 }, (_, i) => [i + 1, i + 2, 1000000000])),
    ],
  });
}

/* ================================================================== */

function seedProblems() {
  const have = db.prepare('SELECT COUNT(*) AS n FROM problems').get().n;
  if (have > 0) return false;
  const insP = db.prepare(
    `INSERT INTO problems (slug,title,difficulty,tags,statement,time_limit_ms,memory_mb,starter_code)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insT = db.prepare(
    'INSERT INTO testcases (problem_id,position,input,expected,is_sample) VALUES (?,?,?,?,?)'
  );
  tx(() => {
    for (const p of problems) {
      const { lastInsertRowid: id } = insP.run(
        p.slug, p.title, p.difficulty, p.tags, p.statement, p.time_limit_ms, p.memory_mb, STARTER
      );
      p.tests.forEach((t, i) => insT.run(id, i, t.input, t.expected, t.sample ? 1 : 0));
    }
  });
  return true;
}

module.exports = { seedProblems, STARTER };
