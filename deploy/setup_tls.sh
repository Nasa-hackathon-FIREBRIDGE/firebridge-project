#!/usr/bin/env bash
# Run once as root on the VPS, before the first webapp activation.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root on the VPS.' >&2; exit 1; }
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
install -d -m 755 /var/www/letsencrypt
if [[ ! -f /etc/letsencrypt/live/astramind.solutions/fullchain.pem ]]; then
  # First issuance only: port 80 must be unused. Renewal uses the running proxy.
  python3 -m http.server 80 --bind 0.0.0.0 --directory /var/www/letsencrypt >/var/log/firebridge-acme-bootstrap.log 2>&1 &
  acme_pid=$!
  trap 'kill "$acme_pid" 2>/dev/null || true' EXIT
  sleep 1
  kill -0 "$acme_pid"
  certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
    --webroot -w /var/www/letsencrypt --cert-name astramind.solutions \
    -d astramind.solutions -d www.astramind.solutions
  kill "$acme_pid"
  wait "$acme_pid" 2>/dev/null || true
  trap - EXIT
fi
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat >/etc/letsencrypt/renewal-hooks/deploy/firebridge-proxy <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/firebridge/webapp
[[ -f .env ]] || exit 0
docker compose -f compose.yaml exec -T proxy nginx -t
docker compose -f compose.yaml exec -T proxy nginx -s reload
HOOK
chmod 750 /etc/letsencrypt/renewal-hooks/deploy/firebridge-proxy
systemctl enable --now certbot.timer
echo 'Certificate installed; after activation verify with: certbot renew --dry-run --run-deploy-hooks'
