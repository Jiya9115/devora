# Devora

**Practice, judge and placement tracking in one app.** Devora is an online judge for Java (write code in the browser,
get a verdict) combined with a placement command centre: application board, practice log, skills roadmap, a transparent
readiness score and a shareable public profile for recruiters.

**Stack:** Node.js 22 · Express · SQLite (built into Node, nothing to compile) · vanilla JS single-page UI with a
hand-written code editor and CSS-only charts · Docker sandbox for untrusted code · GitHub Actions CI

| Dashboard | Judge |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Judge](docs/screenshots/judge.png) |
| **Application board** | **Public profile** |
| ![Applications](docs/screenshots/applications.png) | ![Public profile](docs/screenshots/public-profile.png) |

## What it does

**Online judge**
* 8 starter problems (Easy to Hard) with large hidden tests, so slow solutions really do get Time Limit Exceeded.
* Editor with syntax highlighting, auto-indent and resizable panes. **Run** tries the examples or your own input; **Submit**
  judges every hidden test.
* Verdicts: Accepted, Wrong Answer, Time Limit, Memory Limit, Output Limit, Runtime Error, Compile Error.
* Submission history with code, leaderboard, user profiles, and an admin screen to add problems and tests (large test
  files can be uploaded).

**Placement tools**
* **Dashboard:** readiness score with breakdown and "next best moves", streak, 12-week activity heatmap, difficulty split,
  topics, application funnel, upcoming deadlines, skills against targets.
* **Applications:** drag-and-drop board (Wishlist, Applied, Online test, Interview, Offer, Rejected) with package, deadline,
  notes and an automatic status history.
* **Practice log:** problems solved on LeetCode, Codeforces and similar sites. They count towards your streak and score
  together with what you solve on Devora.
* **Skills roadmap:** current level against target level per skill.
* **Public profile** (opt-in, `/#/p/<username>`): counts, activity and skills only. Never company names, notes or email.
* **CSV export** of applications and practice log (with spreadsheet formula-injection protection).
* **Accounts:** email or username login, scrypt password hashing, signed HttpOnly cookies, rate limiting, optional
  "Continue with Google".

### The readiness score
DSA volume 30 (easy 1, medium 2, hard 3, goal 300) · consistency 10 (30-day streak) · skills 25 · applications 15 ·
interviews 10 · profile 10. Solves on Devora and logged problems both count.

## 1. Run it in VS Code

### Install once
1. **Node.js 22.13 or newer** from <https://nodejs.org> (check with `node -v`).
2. **JDK 17 or newer** from <https://adoptium.net>. Check with `javac -version`; it must print a version (a JRE alone is
   not enough).
3. **VS Code** from <https://code.visualstudio.com>.

### Start
1. Unzip `devora.zip`. In VS Code choose **File → Open Folder…** and pick the `devora` folder.
2. Open **Terminal → New Terminal** and run:

   ```bash
   npm install
   npm start
   ```

   (or press **F5** and pick "Run Devora" to run under the debugger)
3. Open <http://localhost:3000> and log in with the admin account that is already set up:

   | | |
   | --- | --- |
   | **Email** | `admin@devora.com` |
   | **Password** | `Devora@2026` |

   The admin sees an **Admin** link for adding problems.
4. *Optional:* fill the app with sample data so every page has something to show:

   ```bash
   npm run demo
   ```

   then log in as **demo@devora.dev** / **Demo@1234** (public profile at `/#/p/demo`).
5. To try it as a normal user, click **Sign up** (email, username, and a password of at least 8 characters with a letter
   and a number).

If the terminal says `Could not run Java`, `javac` is not on your PATH. Install the JDK, or set `JAVAC=` and `JAVA=` in
`.env` to the full paths.

### Tests
```bash
npm test
```
Runs 10 unit tests (streaks and time zones, readiness maths, validation, CSV safety), then starts a private server and
runs about 60 end-to-end checks: every starter problem is submitted with a known-good Java solution (all must be Accepted),
broken programs must get the right failing verdict, and the career tools, data isolation between users and the public
profile are exercised.

### Reset
Stop the server and delete the `data` folder. Everything (database, starter problems, admin account) is recreated on the
next start.

## 2. Using it
* **Problems:** open one, write Java, press **Run** (or `Ctrl+Enter`), then **Submit**. Read from standard input, write to
  standard output, and put your entry point in `public class Main`. Your code is saved in the browser per problem.
* **Applications:** add a card, drag it between columns, click to edit. Cards with a deadline show up on the dashboard.
* **Settings:** set a target role and date (worth 10 readiness points), and switch on the public profile to get a link
  you can put on your CV.

## 3. Settings (`.env`)

Copy `.env.example` to `.env` to change anything. All settings are optional.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin@devora.com` / `admin` / `Devora@2026` | Admin account created on the first start |
| `SESSION_SECRET` | auto-generated | Signs login cookies |
| `GOOGLE_CLIENT_ID` | empty | Turns on "Continue with Google" |
| `JUDGE_SANDBOX` | `local` | `local` runs submissions as child processes; `docker` runs each in a locked-down container |
| `JUDGE_CONCURRENCY` | `2` | Submissions judged at once (keep at or below your CPU cores) |
| `DATA_DIR` | `./data` | Where the SQLite file lives |

The admin account is only created when the database has no admin yet, so change these **before the first start** (or delete
`data` first).

## 4. Security notes
Judging runs code written by strangers. In `local` mode a submission is time- and memory-limited but runs as the same OS
user as the web server. That is fine on your laptop. **On a server use `JUDGE_SANDBOX=docker`**: every compile and run
happens in a container with no network, a read-only filesystem, memory and process limits, one CPU, no capabilities and an
unprivileged user. Docker mode needs Docker on the same machine as the web server (the EC2 steps below install it).

Other protections: passwords hashed with scrypt, signed HttpOnly SameSite cookies, rate limits on login and judging, every
career record scoped to its owner (other people's ids return 404), validated input, no company names on public profiles.

## 5. Deploy on AWS (EC2)

An EC2 instance fits best because the judge needs a JDK and, for safe judging, Docker.

### 5.1 Create the server
1. AWS Console → **EC2 → Launch instance**. Name `devora`, AMI **Ubuntu Server 24.04 LTS**, type **t3.small** (2 vCPU, 2 GB;
   use t3.medium for many simultaneous users), 20 GB gp3 storage.
2. Create a key pair and download the `.pem` file (you cannot download it again).
3. Security group inbound rules: **SSH 22 from My IP**, **HTTP 80** and **HTTPS 443** from anywhere.
4. After launch: **EC2 → Elastic IPs → Allocate**, then **Associate** it to the instance so the address never changes.

### 5.2 Copy the project and install tools
On your computer:
```bash
chmod 400 devora-key.pem
scp -i devora-key.pem devora.zip ubuntu@YOUR_ELASTIC_IP:~
ssh -i devora-key.pem ubuntu@YOUR_ELASTIC_IP
```
On the server:
```bash
sudo apt-get update && sudo apt-get install -y unzip
unzip devora.zip && cd devora
bash deploy/ec2-setup.sh      # installs Node 22, JDK, nginx, pm2, Docker and pulls the Java image
exit                          # log out and back in so the docker group applies
ssh -i devora-key.pem ubuntu@YOUR_ELASTIC_IP
```

### 5.3 Configure and start
```bash
cd ~/devora
npm ci --omit=dev
cp .env.example .env
nano .env
```
Set these **before the first start**:
```
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=choose-a-long-password
SESSION_SECRET=paste-the-output-of: openssl rand -hex 32
JUDGE_SANDBOX=docker
JUDGE_CONCURRENCY=2
```
Run it under pm2 so it survives crashes and reboots:
```bash
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup                   # run the sudo command it prints
curl localhost:3000/healthz   # {"ok":true}
```
The log (`pm2 logs devora`) should say `sandbox: docker` and `Java toolchain OK`. If you already started the app once with
the default password, run `pm2 stop devora && rm -rf data && pm2 start devora` to recreate the admin.

Do not run `npm run demo` on a public server unless you want the demo account to exist there.

### 5.4 Put nginx in front
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/devora
sudo nano /etc/nginx/sites-available/devora      # set server_name to your domain (or _ for the bare IP)
sudo ln -s /etc/nginx/sites-available/devora /etc/nginx/sites-enabled/devora
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
Visit `http://YOUR_ELASTIC_IP`.

### 5.5 HTTPS on your own domain (recommended)
1. Create an **A record** (Route 53 or your registrar): `yourdomain.com → Elastic IP`.
2. On the server:
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com
   ```
   Certificates renew automatically and login cookies become `Secure` automatically.

### 5.6 Updating later
Upload the new zip and unzip it over the folder (the `data` folder is kept), then:
```bash
cd ~/devora && npm ci --omit=dev && pm2 restart devora
```

### 5.7 Backups and costs
* Everything is in `~/devora/data/` (database and cookie secret). Copy it nightly with cron and `aws s3 cp`, or snapshot the
  EBS volume.
* A t3.small costs a few US dollars a month. Stop the instance when you are not using it and set an AWS Budget alert.
  Elastic IPs are charged while they are not attached to a running instance.

### Alternative: Docker on EC2 (simplest, less isolated)
For a private or classroom install, skip nginx and pm2:
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
cd ~/devora
printf "ADMIN_EMAIL=you@yourdomain.com\nADMIN_PASSWORD=choose-a-long-password\n" > .env
sudo docker compose up -d --build
```
The site is on port 80. Submissions run inside the app container as an unprivileged user (`local` mode). Do not use this for
a public contest.

## 6. Turn on "Continue with Google" (optional)
1. <https://console.cloud.google.com> → create or pick a project → **APIs & Services → OAuth consent screen** → External →
   fill in the app name and your email → save. While in *Testing* mode add your Gmail address under **Test users**.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. **Authorized JavaScript origins**: `http://localhost:3000` for local use and `https://yourdomain.com` for production
   (no paths, no trailing slash; no redirect URI is needed).
4. Put the client ID in `.env` as `GOOGLE_CLIENT_ID=...apps.googleusercontent.com` and restart. The Google button then
   appears on the login and sign-up pages. Google accepts only `https://` origins on a real domain (or `localhost`), so a
   bare IP address will not work for this feature.

The automated tests only check that Google sign-in is disabled without a client ID; it has not been exercised against a
real Google account.

## 7. Project layout
```
server.js              Express app, first-run setup
src/judge.js           compile, run, compare, time/memory limits, queue, Docker sandbox
src/api.js             accounts, problems, run, submit, admin
src/career.js          dashboard, applications, skills, practice log, settings, export, public profile
src/stats.js           streaks, heatmap, readiness score (pure functions)
src/validate.js        declarative input validation      src/csv.js   CSV writer
src/seed.js            the 8 starter problems and their generated test data
src/db.js, auth.js     SQLite schema and migrations, scrypt, signed cookies, rate limiting
public/                the web UI (index.html, css/app.css, js/app.js)
scripts/smoke.js       end-to-end test      scripts/demo.js   demo data
test/unit.test.js      unit tests           tests/reference/  known-good Java solutions
deploy/                nginx, pm2 and EC2 setup script
.github/workflows/     CI (unit and end-to-end tests on every push)
Dockerfile, docker-compose.yml
```

## 8. Ideas for extending it
* **More languages:** add branches in `compile()` and `execute()` in `src/judge.js` (python3, g++), a language field in the
  submit request, and a picker in the editor bar.
* **Special judges** (several valid answers): change `classify()` in `src/judge.js`.
* **Contests:** a `contests` table and a time-window check in `POST /api/submit`.
* **Email reminders** for application deadlines.
