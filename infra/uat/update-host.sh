#!/usr/bin/env bash
# Run on the existing UAT host as root. Never imports local data or changes the edge.
set -euo pipefail
archive=${1:?source archive required}
release=${2:?git commit required}
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full Git commit'; exit 1; }
root=/opt/vanly-uat
stage="$root/releases/$release"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$root/backups/$stamp"
[[ -f "$root/private/runtime.env" && -d "$root/app" && ! -e "$stage" ]]
mkdir -p "$stage" "$backup"
chmod 700 "$backup"
tar -xzf "$archive" -C "$stage"
[[ -f "$stage/infra/uat/Dockerfile" && ! -e "$stage/.env.local" && ! -e "$stage/.local" ]]
cd "$stage"
docker build -f infra/uat/Dockerfile -t "vanly-uat:$release" .
docker tag vanly-uat:current "vanly-uat:rollback-$stamp"
cp -p "$root/private/runtime.env" "$backup/runtime.env"
compose=(docker compose -f "$root/app/infra/uat/compose.yaml")
switched=false
recover() {
  code=$?
  if [[ "$code" != 0 ]]; then
    docker tag "vanly-uat:rollback-$stamp" vanly-uat:current
    cp -p "$backup/runtime.env" "$root/private/runtime.env"
    if [[ "$switched" == true ]]; then
      rm "$root/app"
      mv "$backup/source" "$root/app"
    fi
    "${compose[@]}" up -d --no-build api web owner admin worker
    echo 'Previous application restored. Database backup retained; no automatic data replacement.'
  fi
  exit "$code"
}
trap recover EXIT
"${compose[@]}" stop api worker
"${compose[@]}" exec -T db pg_dump -U vanly_app -d vanly_uat -Fc > "$backup/database.dump"
chmod 600 "$backup/database.dump"
"${compose[@]}" exec -T db pg_restore -l < "$backup/database.dump" > "$backup/database.manifest"
# Preserve all existing secrets/settings while explicitly selecting the launch payment mode.
sed -i '/^TRAVELER_PAYMENT_MODE=/d' "$root/private/runtime.env"
printf '\nTRAVELER_PAYMENT_MODE=direct\n' >> "$root/private/runtime.env"
docker tag "vanly-uat:$release" vanly-uat:current
"${compose[@]}" run --rm --no-deps api node scripts/migrate.mjs
mv "$root/app" "$backup/source"
ln -s "$stage" "$root/app"
switched=true
"${compose[@]}" up -d --no-build --force-recreate api web owner admin worker
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:4100/api/v1/health >/dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:4100/api/v1/health
printf '\n%s\n' "$release" > "$root/data/deployed-commit"
trap - EXIT
"${compose[@]}" ps
echo "Updated UAT to $release; recovery files: $backup"
