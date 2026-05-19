#!/bin/bash
# Run this AFTER DNS is pointing to this VPS and the stack is running on HTTP.
# Usage: cd /opt/easyq && bash scripts/init-ssl.sh
set -e

DOMAIN="api.easy.fr"
EMAIL="lucaszivan86@gmail.com"

echo "=== Getting SSL certificate for $DOMAIN ==="
docker run --rm \
  -v "$(pwd)/certbot_www:/var/www/certbot" \
  -v "$(pwd)/certbot_certs:/etc/letsencrypt" \
  certbot/certbot certonly \
  --webroot --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos --no-eff-email \
  -d "$DOMAIN"

echo "=== Switching nginx to HTTPS config ==="
cp nginx/app.ssl.conf nginx/app.conf

echo "=== Reloading nginx ==="
docker compose exec nginx nginx -s reload

echo "=== Done! https://$DOMAIN is live ==="

echo "=== Setting up auto-renewal (cron) ==="
(crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/easyq && docker run --rm -v \$(pwd)/certbot_www:/var/www/certbot -v \$(pwd)/certbot_certs:/etc/letsencrypt certbot/certbot renew --quiet && docker compose exec nginx nginx -s reload") | crontab -
echo "Auto-renewal cron added."
