#!/bin/sh
set -eu
. '/Library/Application Support/Vanly/lan-network.sh'
portal_pids=''
portal_previous=''
portal_cleanup() { for portal_pid in $portal_pids; do kill "$portal_pid" 2>/dev/null || true; done; portal_pids=''; }
trap 'portal_cleanup; exit 0' INT TERM
trap portal_cleanup EXIT
while :; do
 portal_ip=$(vanly_lan_addresses | head -n 1)
 if [ "$portal_ip" != "$portal_previous" ]; then
  portal_cleanup
  if [ -n "$portal_ip" ]; then
   for portal_name in vanly.me.local owner.vanly.me.local admin.vanly.me.local; do
    /usr/bin/dns-sd -P "$portal_name" _https._tcp local 443 "$portal_name" "$portal_ip" path=/ &
    portal_pids="$portal_pids $!"
   done
  fi
  portal_previous=$portal_ip
 fi
 sleep 15
done
