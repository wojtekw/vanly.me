#!/bin/sh
# This installation is deliberately limited to the observed home subnet.
# A different network requires explicitly changing and reinstalling this file
# AND the matching Nginx allow rule in the shared nginx-config templates.
vanly_lan_addresses() {
    for vanly_interface in en0 en1; do
        vanly_ip=$(/usr/sbin/ipconfig getifaddr "$vanly_interface" 2>/dev/null || true)
        case "$vanly_ip" in
            192.168.188.*)
                if /sbin/ifconfig "$vanly_interface" | /usr/bin/grep -q 'netmask 0xffffff00 '; then
                    /usr/bin/printf '%s\n' "$vanly_ip"
                fi
                ;;
        esac
    done
}
