#!/bin/sh
set -e

secret="${SRS_WEBHOOK_SECRET:-dev-only-change-me}"
# Defaults to the docker-compose internal hostname for local dev; the Fly.io
# deployment overrides this to the real public API URL (SRS's http_hooks
# can only call a real reachable URL, no internal-network shortcut there).
api_webhook_base="${API_WEBHOOK_BASE:-http://api:4000}"

sed \
  -e "s|__SRS_WEBHOOK_SECRET__|${secret}|g" \
  -e "s|__API_WEBHOOK_BASE__|${api_webhook_base}|g" \
  /usr/local/srs/conf/srs.conf.template > /usr/local/srs/conf/srs.conf

exec /usr/local/srs/objs/srs -c /usr/local/srs/conf/srs.conf
