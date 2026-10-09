#!/bin/sh
set -eu
portal_source="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec /bin/sh "$portal_source/install-portal.sh" "$@"
