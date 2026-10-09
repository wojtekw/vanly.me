#!/bin/sh
set -eu
portal_dir='/Library/Application Support/Vanly'
[ -f "$portal_dir/proxy-engine" ] && [ "$(/bin/cat "$portal_dir/proxy-engine")" = nginx ] || {
    echo 'Portal wymaga działającej wspólnej usługi Nginx.'; exit 1;
}
exec /bin/sh "$portal_dir/run-proxy.sh" "$@"
