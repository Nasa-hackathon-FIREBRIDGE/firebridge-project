#!/usr/bin/env bash
# Run once as root on the VPS, before the first webapp activation.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root on the VPS.' >&2; exit 1; }
if ! command -v certbot >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
fi
install -d -m 755 /var/www/letsencrypt
certificate_domains=(ogote.com astramind.solutions)
missing_certificate=false
for domain in "${certificate_domains[@]}"; do
  [[ -f /etc/letsencrypt/live/$domain/fullchain.pem ]] || missing_certificate=true
done
if $missing_certificate; then
  # Reuse the active proxy's ACME webroot; bootstrap port 80 only on a fresh host.
  acme_pid=''
  if ! docker compose -f /opt/firebridge/webapp/compose.yaml ps --status running --services 2>/dev/null | grep -qx proxy; then
    python3 -m http.server 80 --bind 0.0.0.0 --directory /var/www/letsencrypt >/var/log/firebridge-acme-bootstrap.log 2>&1 &
    acme_pid=$!
    trap '[[ -z "$acme_pid" ]] || kill "$acme_pid" 2>/dev/null || true' EXIT
    sleep 1
    kill -0 "$acme_pid"
  fi
  for domain in "${certificate_domains[@]}"; do
    if [[ ! -f /etc/letsencrypt/live/$domain/fullchain.pem ]]; then
      certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
        --webroot -w /var/www/letsencrypt --cert-name "$domain" \
        -d "$domain" -d "www.$domain"
    fi
  done
  if [[ -n "$acme_pid" ]]; then
    kill "$acme_pid"
    wait "$acme_pid" 2>/dev/null || true
    trap - EXIT
  fi
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
