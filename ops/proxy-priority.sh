#!/bin/sh
set -eu
proxy_plist='/Library/LaunchDaemons/local.vanly.proxy.plist'
cp -p "$proxy_plist" '/Library/Application Support/Vanly/local.vanly.proxy.before-portal-priority.plist'
/usr/libexec/PlistBuddy -c 'Set :ProcessType Interactive' "$proxy_plist"
launchctl bootout system/local.vanly.proxy
for attempt in 1 2 3 4 5; do
 if launchctl bootstrap system "$proxy_plist"; then exit 0; fi
 sleep 2
done
cp -p '/Library/Application Support/Vanly/local.vanly.proxy.before-portal-priority.plist' "$proxy_plist"
launchctl bootstrap system "$proxy_plist"
exit 1
