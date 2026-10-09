#!/bin/zsh
set -euo pipefail
vanly_root="${0:A:h}"
print 'Uruchomienie Vanly w domowej sieci z HTTP i HTTPS.'
print 'Instalator zmieni wyłącznie usługę Vanly i doda na tym Macu zaufanie SSL dla vanly.local.'
print 'Nie zmienia routera, zapory ani usług innych projektów. Nie tworzy usług płatnych.'
print 'Wpisz hasło administratora macOS, gdy poprosi o nie Terminal (znaki nie będą widoczne).'
/usr/bin/sudo /bin/sh "$vanly_root/ops/install-lan.sh"
print ''
print 'Gotowe. Naciśnij Enter, żeby zamknąć to okno.'
read -r
