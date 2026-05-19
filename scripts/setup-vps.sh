#!/bin/bash
# Run this once on a fresh OVH VPS (Ubuntu 22.04)
# Usage: ssh root@<VPS_IP> "bash <(curl -s https://raw.githubusercontent.com/LucRoDZ/EASY-.Q/master/scripts/setup-vps.sh)"
set -e

echo "=== Installing Docker ==="
apt-get update
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "=== Cloning repo ==="
git clone https://github.com/LucRoDZ/EASY-.Q.git /opt/easyq
cd /opt/easyq

echo "=== Create .env.production ==="
echo "Copy .env.production.example to .env.production and fill in your secrets:"
cp backend/.env.example .env.production
echo ""
echo ">>> Edit /opt/easyq/.env.production with your real values, then run:"
echo ">>> cd /opt/easyq && docker compose up -d"
