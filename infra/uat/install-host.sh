#!/usr/bin/env bash
# Run as root on the new, dedicated VANLY UAT Ubuntu host after SSH approval.
set -euo pipefail
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Ubuntu 24.04 required'; exit 1; }
[[ "$(id -u)" == 0 ]] || { echo 'Run as root'; exit 1; }
[[ -f /opt/vanly-uat/app/infra/uat/compose.yaml ]] || { echo 'Frozen UAT source missing'; exit 1; }
for uat_file in runtime.env db.env htpasswd origin-secret aws-credentials aws-config data.dump; do
  [[ -f "/opt/vanly-uat/private/$uat_file" ]] || { echo "Missing private UAT file: $uat_file"; exit 1; }
done
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 nginx certbot apache2-utils
systemctl enable --now docker
install -d -m 700 /opt/vanly-uat/private
chmod 600 /opt/vanly-uat/private/*
chown 1000:1000 /opt/vanly-uat/private/aws-credentials /opt/vanly-uat/private/aws-config
chown root:www-data /opt/vanly-uat/private/htpasswd
chmod 640 /opt/vanly-uat/private/htpasswd
install -d -o 1000 -g 1000 /opt/vanly-uat/data/uploads
chown -R 1000:1000 /opt/vanly-uat/data/uploads
if [[ -z "$(swapon --show=NAME --noheadings)" ]]; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
  fi
fi
cd /opt/vanly-uat/app
docker compose -f infra/uat/compose.yaml build api
docker compose -f infra/uat/compose.yaml up -d db
for uat_try in {1..30}; do
  if docker compose -f infra/uat/compose.yaml exec -T db pg_isready -U vanly_app -d vanly_uat >/dev/null; then break; fi
  sleep 2
done
uat_dump_hash="$(sha256sum /opt/vanly-uat/private/data.dump | cut -d ' ' -f 1)"
if [[ ! -f /opt/vanly-uat/private/restored.sha256 ]]; then
  uat_tables="$(docker compose -f infra/uat/compose.yaml exec -T db psql -U vanly_app -d vanly_uat -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
  [[ "$uat_tables" == 0 ]] || { echo 'Refusing to replace a nonempty UAT database'; exit 1; }
  docker compose -f infra/uat/compose.yaml exec -T db pg_restore --exit-on-error --no-owner --no-acl -U vanly_app -d vanly_uat < /opt/vanly-uat/private/data.dump
  printf '%s\n' "$uat_dump_hash" > /opt/vanly-uat/private/restored.sha256
  chmod 600 /opt/vanly-uat/private/restored.sha256
else
  [[ "$(cat /opt/vanly-uat/private/restored.sha256)" == "$uat_dump_hash" ]] || { echo 'Restore marker belongs to another release'; exit 1; }
fi
docker compose -f infra/uat/compose.yaml up -d
install -d /var/www/acme
cat > /etc/nginx/nginx.conf <<'NGINX'
worker_processes auto;
events { worker_connections 1024; }
http { server { listen 80 default_server; server_name origin.uat.vanly.me;
location ^~ /.well-known/acme-challenge/ { root /var/www/acme; }
location / { return 403; } } }
NGINX
nginx -t
systemctl enable --now nginx
systemctl reload nginx
certbot certonly --webroot -w /var/www/acme -d origin.uat.vanly.me --email wydmuch@gmail.com --agree-tos --non-interactive
python3 - <<'PY'
from pathlib import Path
source = Path('/opt/vanly-uat/app/infra/uat/nginx.conf.template').read_text()
values = {'__ORIGIN_SECRET__': Path('/opt/vanly-uat/private/origin-secret').read_text().strip(),
          '__TLS_CERT__': '/etc/letsencrypt/live/origin.uat.vanly.me/fullchain.pem',
          '__TLS_KEY__': '/etc/letsencrypt/live/origin.uat.vanly.me/privkey.pem',
          '__HTPASSWD__': '/opt/vanly-uat/private/htpasswd'}
for token, value in values.items(): source = source.replace(token, value)
Path('/etc/nginx/nginx.conf').write_text(source)
PY
chown root:www-data /etc/nginx/nginx.conf
chmod 640 /etc/nginx/nginx.conf
# Nginx's worker user needs directory traversal to the password file, without
# reading any other private file. Credentials remain individually mode 600.
chown root:www-data /opt/vanly-uat/private
chmod 710 /opt/vanly-uat/private
nginx -t
systemctl reload nginx
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/vanly-uat-nginx
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/vanly-uat-nginx
docker compose -f infra/uat/compose.yaml ps
echo 'Origin prepared. Verify Linux bcrypt and public access before enabling UAT DNS.'
