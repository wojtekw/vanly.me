#!/bin/zsh
set -eu
cd "${0:A:h}"
sudo /bin/sh '/Users/wojtek/.local/share/vanly-portal/ops/install-portal.sh'
printf '\nNaciśnij Enter, aby zamknąć okno.'
read
