#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 22.04/24.04 EC2 instance. Run as the default "ubuntu" user:
#   bash deploy/ec2-setup.sh
set -euo pipefail

sudo apt-get update
sudo apt-get install -y curl nginx openjdk-17-jdk-headless unzip

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# Docker (used to sandbox every submission)
sudo apt-get install -y docker.io
sudo usermod -aG docker "$USER"
sudo docker pull eclipse-temurin:21-jdk

echo
echo "Done. Log out and back in once so the docker group applies, then:"
echo "  cd ~/devora && npm ci --omit=dev && cp .env.example .env   # edit .env"
echo "  pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup"
