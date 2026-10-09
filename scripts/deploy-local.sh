#!/bin/sh
set -eu
portal_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
portal_runtime='/Users/wojtek/.local/share/vanly-portal'
[ "$portal_root" != "$portal_runtime" ] || { echo 'Uruchom z katalogu źródłowego.'; exit 1; }
if [ "${1:-}" = mailer ]; then
    exec /bin/sh "$portal_root/scripts/deploy-mailer-release.sh" "${2:?Podaj katalog sprawdzonego wydania mailera.}"
fi
portal_lock="$portal_runtime/.local/deploy.lock"
portal_build=''
(umask 077; mkdir -p "$portal_runtime/.local")
(umask 077; mkdir "$portal_lock") 2>/dev/null || { echo 'DEPLOYMENT_ALREADY_LOCKED'; exit 1; }
portal_cleanup() {
    portal_status=$?
    trap - EXIT HUP INT TERM
    set +e
    if [ -n "$portal_build" ]; then rm -rf "$portal_build"; fi
    rm -f "$portal_lock/pid"
    rmdir "$portal_lock"
    exit "$portal_status"
}
trap portal_cleanup EXIT
trap 'exit 1' HUP INT TERM
printf '%s\n' "$$" > "$portal_lock/pid"
if [ "${1:-}" = api ]; then
    # Server-only changes preserve the running frontends and private configuration.
    "$portal_root/vanly" build-api
    portal_backup="$portal_runtime/.local/backups/api-$(date -u +%Y%m%dT%H%M%SZ)"
    (umask 077; mkdir -p "$portal_backup")
    tar -czf "$portal_backup/release.tar.gz" -C "$portal_runtime" apps/api/src apps/api/dist
    "$portal_root/vanly" stop api
    rsync -a "$portal_root/apps/api/src/" "$portal_runtime/apps/api/src/"
    rsync -a --delete "$portal_root/apps/api/dist/" "$portal_runtime/apps/api/dist/"
    "$portal_runtime/vanly" start api
    exit 0
fi
if [ "${1:-}" = stock ]; then
    /bin/sh "$portal_root/scripts/deploy-stock-release.sh" "${2:?Podaj katalog sprawdzonego wydania magazynu.}"
    exit 0
fi
if [ "${1:-}" = frontoffice ] || [ "${1:-}" = shared-ui ] || [ "${1:-}" = vehicle-pickup ]; then
    if [ "$1" = vehicle-pickup ]; then
        portal_node='/Users/wojtek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
        "$portal_node" "$portal_runtime/apps/api/node_modules/typescript/bin/tsc" -p "$portal_root/apps/api/tsconfig.json"
    fi
    # Compile a fresh workspace with the installed runtime dependencies. Source
    # directories in Documents may defer dependency reads; stale .next copies
    # must not become part of the new build.
    portal_build=$(mktemp -d /Users/wojtek/.local/share/vanly-frontoffice-build.XXXXXX)
    mkdir -p "$portal_build/apps/frontoffice" "$portal_build/packages/ui"
    rsync -a --exclude '.next' --exclude 'node_modules' --exclude '.env*' --exclude 'public' --exclude '*.tsbuildinfo' "$portal_root/apps/frontoffice/" "$portal_build/apps/frontoffice/"
    ln -s "$portal_runtime/apps/frontoffice/public" "$portal_build/apps/frontoffice/public"
    rsync -a --exclude 'node_modules' "$portal_root/packages/ui/" "$portal_build/packages/ui/"
    cp "$portal_root/package.json" "$portal_root/pnpm-workspace.yaml" "$portal_root/pnpm-lock.yaml" "$portal_build/"
    ln -s "$portal_runtime/node_modules" "$portal_build/node_modules"
    ln -s "$portal_runtime/apps/frontoffice/node_modules" "$portal_build/apps/frontoffice/node_modules"
    ln -s "$portal_runtime/packages/ui/node_modules" "$portal_build/packages/ui/node_modules"
    ln -s "$portal_runtime/.env.local" "$portal_build/.env.local"
    portal_node='/Users/wojtek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
    NEXT_TELEMETRY_DISABLED=1 "$portal_node" "$portal_runtime/apps/frontoffice/node_modules/next/dist/bin/next" build "$portal_build/apps/frontoffice" --webpack
    if [ "$1" = shared-ui ] || [ "$1" = vehicle-pickup ]; then
        for portal_panel in owner admin; do
            mkdir -p "$portal_build/apps/$portal_panel"
            rsync -a --exclude 'dist' --exclude 'node_modules' --exclude '.env*' --exclude '.local' "$portal_root/apps/$portal_panel/" "$portal_build/apps/$portal_panel/"
            ln -s "$portal_runtime/apps/$portal_panel/node_modules" "$portal_build/apps/$portal_panel/node_modules"
            (cd "$portal_build/apps/$portal_panel" && "$portal_node" "$portal_runtime/apps/$portal_panel/node_modules/vite/bin/vite.js" build)
        done
        if [ "$1" = vehicle-pickup ]; then
            "$portal_runtime/vanly" backup
            portal_backup="$portal_runtime/.local/backups/vehicle-pickup-$(date -u +%Y%m%dT%H%M%SZ)"
            (umask 077; mkdir -p "$portal_backup")
            tar -czf "$portal_backup/release.tar.gz" -C "$portal_runtime" apps/api/dist apps/frontoffice/.next apps/owner/dist apps/admin/dist
            # Sync only this change and preserve runtime credentials.
            for portal_file in \
                apps/api/src/catalog.ts apps/api/src/bookings.ts apps/api/src/localities.ts \
                db/migrations/004_vehicle_pickup.sql db/migrations/005_stock_management.sql db/migrations/006_stock_vehicles.sql db/localities-pl.json db/localities-pl.source.json \
                scripts/generate-localities.mjs docs/Miejsca-odbioru.md \
                packages/ui/components/Backoffice.tsx packages/ui/components/Stock.tsx packages/ui/components/Account.tsx \
                packages/ui/components/PickupLocation.tsx packages/ui/pickup-location.css packages/ui/styles.css \
                apps/frontoffice/components/Travel.tsx apps/frontoffice/components/PickupLocation.tsx \
                apps/frontoffice/app/globals.css tests/api.test.mjs tests/pickup-ui.test.mjs; do
                mkdir -p "$(dirname "$portal_runtime/$portal_file")"
                if [ -f "$portal_runtime/$portal_file" ]; then
                    mkdir -p "$(dirname "$portal_backup/source/$portal_file")"
                    cp -p "$portal_runtime/$portal_file" "$portal_backup/source/$portal_file"
                fi
                cp -p "$portal_root/$portal_file" "$portal_runtime/$portal_file"
            done
            "$portal_runtime/vanly" migrate
            "$portal_root/vanly" stop api web owner admin
            rsync -a --delete "$portal_root/apps/api/dist/" "$portal_runtime/apps/api/dist/"
        else
            "$portal_root/vanly" stop web owner admin
        fi
    else
        "$portal_root/vanly" stop web
    fi
    if [ "$1" != vehicle-pickup ]; then
        rsync -a --exclude '.next' --exclude 'node_modules' --exclude '.env*' "$portal_root/apps/frontoffice/" "$portal_runtime/apps/frontoffice/"
        rsync -a --exclude 'node_modules' "$portal_root/packages/ui/" "$portal_runtime/packages/ui/"
    fi
    mkdir -p "$portal_runtime/apps/frontoffice/.next"
    rsync -a --delete "$portal_build/apps/frontoffice/.next/" "$portal_runtime/apps/frontoffice/.next/"
    if [ "$1" = shared-ui ] || [ "$1" = vehicle-pickup ]; then
        for portal_panel in owner admin; do
            rsync -a --delete "$portal_build/apps/$portal_panel/dist/" "$portal_runtime/apps/$portal_panel/dist/"
        done
        if [ "$1" = vehicle-pickup ]; then
            "$portal_runtime/vanly" start api web owner admin
            echo "Miejsca odbioru zaktualizowane. Kopia wydania: $portal_backup"
        else
            "$portal_runtime/vanly" start web owner admin
        fi
    else
        "$portal_runtime/vanly" start web
    fi
    exit 0
fi
if [ "${1:-}" = camperfolks ] || [ "${1:-}" = heyvans ]; then
    portal_brand="$1"
    # Deploy the selected frontend and its authentication update without
    # replacing assets served by the running Vanly frontend or restarting its worker.
    "$portal_root/vanly" build-api
    "$portal_root/vanly" "build-$portal_brand"
    mkdir -p "$portal_runtime"
    # Validate and extend only the selected origin before interrupting services.
    # The runtime secrets stay in place and are excluded from the source sync.
    "$portal_root/vanly" "configure-$portal_brand-origin" "$portal_runtime/.env.local"
    # Use the updated source launcher: an older runtime launcher ignores service
    # selectors and would otherwise stop every existing Vanly service.
    "$portal_root/vanly" stop api "$portal_brand"
    rsync -a --exclude '.git' --exclude '.env*' --exclude '.local' --exclude '.next' --exclude 'dist' --exclude '/output' --exclude '/tmp' "$portal_root/" "$portal_runtime/"
    mkdir -p "$portal_runtime/apps/$portal_brand/.next" "$portal_runtime/apps/api/dist"
    rsync -a --delete "$portal_root/apps/$portal_brand/.next/" "$portal_runtime/apps/$portal_brand/.next/"
    rsync -a --delete "$portal_root/apps/api/dist/" "$portal_runtime/apps/api/dist/"
    "$portal_runtime/vanly" start api "$portal_brand"
    exit 0
fi
[ -z "${1:-}" ] || { echo 'Użycie: deploy-local.sh [api|frontoffice|shared-ui|vehicle-pickup|mailer|camperfolks|heyvans]'; exit 1; }
"$portal_root/vanly" build
mkdir -p "$portal_runtime"
if [ -f "$portal_runtime/vanly" ]; then "$portal_runtime/vanly" stop; fi
rsync -a --exclude '.git' --exclude '.env*' --exclude '.local' --exclude '/output' --exclude '/tmp' "$portal_root/" "$portal_runtime/"
"$portal_runtime/vanly" start
