#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ -e .env ]; then
  echo ".env bestaat al; er is niets overschreven."
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL ontbreekt. Maak .env handmatig op basis van .env.example."
  exit 1
fi

cp .env.example .env
database_password=$(openssl rand -hex 24)
camera_key=$(openssl rand -hex 32)
sed -i "s/CHANGE_ME_USE_A_LONG_RANDOM_DATABASE_PASSWORD/$database_password/g" .env
sed -i "s/CHANGE_ME_64_HEX_CHARACTERS/$camera_key/g" .env
chmod 600 .env
echo ".env is aangemaakt met willekeurige lokale ontwikkelsleutels en permissie 600."
