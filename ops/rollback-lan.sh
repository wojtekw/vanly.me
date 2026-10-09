#!/bin/sh
set -eu
portal_dir='/Library/Application Support/Vanly'
exec /bin/sh "$portal_dir/rollback-nginx.sh" "$@"
