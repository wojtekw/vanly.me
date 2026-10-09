#!/bin/sh
set -eu
portal_source=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
portal_release=${1:?Podaj katalog sprawdzonego wydania.}
portal_runtime='/Users/wojtek/.local/share/vanly-portal'
portal_node='/Users/wojtek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
portal_verify="$portal_source/scripts/verify-mailer-release.mjs"
portal_services='api worker web owner admin camperfolks heyvans'
portal_lock="$portal_runtime/.local/deploy.lock"
portal_recover=false
portal_prior=''
portal_backup=''
[ "$portal_source" != "$portal_runtime" ] || { echo 'Uruchom z katalogu źródłowego.'; exit 1; }
(umask 077; mkdir -p "$portal_runtime/.local")
(umask 077; mkdir "$portal_lock") 2>/dev/null || { echo 'DEPLOYMENT_ALREADY_LOCKED'; exit 1; }
mailer_finish() {
  portal_status=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ "$portal_status" -ne 0 ] && [ "$portal_recover" = true ]; then
    # Stop every partially started new service before restoring any code.
    "$portal_node" "$portal_source/scripts/service.mjs" stop $portal_services
    if "$portal_node" "$portal_verify" --stopped && "$portal_node" "$portal_verify" --restore "$portal_backup"; then
      if [ -n "$portal_prior" ]; then
        "$portal_runtime/vanly" start $portal_prior && "$portal_node" "$portal_verify" --ready "$portal_prior"
        [ "$?" -eq 0 ] || echo 'ROLLBACK_SERVICES_NOT_READY'
      fi
      echo 'Poprzedni kod, zależności i prywatna konfiguracja przywrócone; migracje bazy zachowane.'
    else
      echo 'ROLLBACK_FAILED: usługi pozostają zatrzymane; zachowano prywatną kopię wydania.'
    fi
  fi
  rm -f "$portal_lock/pid"
  rmdir "$portal_lock"
  exit "$portal_status"
}
trap mailer_finish EXIT
trap 'exit 1' HUP INT TERM
printf '%s
' "$$" > "$portal_lock/pid"
"$portal_node" "$portal_verify" "$portal_release"
portal_prior=$("$portal_node" "$portal_verify" --running-services)
"$portal_runtime/vanly" backup
portal_backup=$(umask 077; mktemp -d "$portal_runtime/.local/backups/mailer-code.XXXXXX")
"$portal_node" "$portal_verify" --backup "$portal_backup"
# Detect source, dependency, build or private configuration edits during backup.
"$portal_node" "$portal_verify" "$portal_release"
portal_recover=true
"$portal_node" "$portal_source/scripts/service.mjs" stop $portal_services
"$portal_node" "$portal_verify" --stopped
"$portal_node" "$portal_verify" --install "$portal_release"
"$portal_runtime/vanly" migrate
if [ -n "$portal_prior" ]; then "$portal_runtime/vanly" start $portal_prior; fi
"$portal_node" "$portal_verify" --ready "$portal_prior"
portal_recover=false
printf 'Wydanie sprawdzone; poprzedni zestaw usług uruchomiony. Kopia poprzedniego kodu: %s
' "$portal_backup"
