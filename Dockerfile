# Devora - Node 22 + a JDK so the app can compile and run submitted Java.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Run as an unprivileged user; /app/data holds the database and must be a volume.
RUN useradd -m judge && mkdir -p /app/data && chown -R judge:judge /app/data
USER judge
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data JUDGE_SANDBOX=local
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
