#!/bin/bash
# Run this AFTER DNS is pointing to this VPS and the stack is running on HTTP.
# Usage: cd /opt/easyq && bash scripts/init-ssl.sh
set -e

DOMAIN="api.easyq.fr"
EMAIL="lucaszivan86@gmail.com"

echo "=== Stopping nginx temporarily for standalone challenge ==="
docker compose stop nginx

echo "=== Getting SSL certificate for $DOMAIN ==="
docker run --rm \
  -p 80:80 \
  -v certbot_certs:/etc/letsencrypt \
  certbot/certbot certonly \
  --standalone \
  --email "$EMAIL" \
  --agree-tos --no-eff-email \
  -d "$DOMAIN"

echo "=== Switching nginx to HTTPS config ==="
cp nginx/app.ssl.conf nginx/app.conf

echo "=== Restarting nginx ==="
docker compose start nginx

echo "=== Done! https://$DOMAIN is live ==="

echo "=== Setting up auto-renewal (cron) ==="
(crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/easyq && docker compose stop nginx && docker run --rm -p 80:80 -v certbot_certs:/etc/letsencrypt certbot/certbot renew --standalone --quiet && docker compose start nginx") | crontab -
echo "Auto-renewal cron added."
