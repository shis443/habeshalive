#!/bin/sh
set -e

secret="${SRS_WEBHOOK_SECRET:-dev-only-change-me}"

sed \
  -e "s|__SRS_WEBHOOK_SECRET__|${secret}|g" \
  /usr/local/srs/conf/srs.conf.template > /usr/local/srs/conf/srs.conf

exec /usr/local/srs/objs/srs -c /usr/local/srs/conf/srs.conf
