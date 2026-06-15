#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "=============================="
echo " STAC-OIE — tests E2E déploiement"
echo "=============================="

bash scripts/e2e/direct.sh
echo
bash scripts/e2e/proxy-https.sh

echo
echo "=============================="
echo " Tous les tests E2E ont réussi"
echo "=============================="
