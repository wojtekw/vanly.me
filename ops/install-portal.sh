#!/bin/sh
set -eu
portal_dir='/Library/Application Support/Vanly'
[ -f "$portal_dir/proxy-engine" ] && [ "$(/bin/cat "$portal_dir/proxy-engine")" = nginx ] || {
    echo 'Portal wymaga działającej wspólnej usługi Nginx.'; exit 1;
}
[ -f "$portal_dir/check-nginx.py" ] || { echo "Brak narzędzia kontroli wspólnego Nginx."; exit 1; }
/usr/bin/python3 "$portal_dir/check-nginx.py"
echo "Portal korzysta ze wspólnego Nginx; trasy i certyfikaty zostały sprawdzone."
