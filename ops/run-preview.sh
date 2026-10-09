#!/bin/sh
set -eu
portal_dir='/Library/Application Support/Vanly'
[ -f "$portal_dir/proxy-engine" ] && [ "$(/bin/cat "$portal_dir/proxy-engine")" = nginx ] || {
    echo 'Portal wymaga działającej wspólnej usługi Nginx.'; exit 1;
}
echo 'Podgląd portalu obsługuje Nginx: https://vanly.me.local/ oraz http://127.0.0.1:8181/.'
