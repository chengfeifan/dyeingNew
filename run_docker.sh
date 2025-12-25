#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

DOMAIN="${DOMAIN:-spec.arkshow.com}"
CERT_DIR="nginx/certs"
FULLCHAIN="$CERT_DIR/fullchain.pem"
PRIVKEY="$CERT_DIR/privkey.pem"

mkdir -p "$CERT_DIR"

if [[ ! -f "$FULLCHAIN" || ! -f "$PRIVKEY" ]]; then
  if ! command -v openssl >/dev/null; then
    echo "ERROR: openssl not found. Please install openssl or place certs in $CERT_DIR." >&2
    exit 1
  fi

  echo "===> Generating self-signed cert for https://${DOMAIN}"
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$PRIVKEY" \
    -out "$FULLCHAIN" \
    -subj "/CN=${DOMAIN}" \
    -addext "subjectAltName=DNS:${DOMAIN}"
fi

docker compose up --build
