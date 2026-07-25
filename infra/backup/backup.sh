#!/bin/sh
set -eu

mc alias set backupstore "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
mc mb --ignore-existing "backupstore/${BACKUP_S3_BUCKET:-habeshalive-backups}" >/dev/null

run_backup() {
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  file="/tmp/habeshalive-${ts}.sql.gz"
  bucket="${BACKUP_S3_BUCKET:-habeshalive-backups}"
  echo "[backup] ${ts} starting pg_dump -> ${file}"
  pg_dump "$DATABASE_URL" | gzip > "$file"
  mc cp "$file" "backupstore/${bucket}/$(basename "$file")"
  rm -f "$file"
  echo "[backup] ${ts} uploaded $(basename "$file")"
  # Retention: drop backups older than BACKUP_RETENTION_DAYS so the bucket
  # doesn't grow unbounded.
  mc rm --recursive --force --older-than "${BACKUP_RETENTION_DAYS:-14}d" "backupstore/${bucket}/" >/dev/null 2>&1 || true
}

seconds_until_next_run() {
  # BACKUP_HOUR_UTC (0-23) is when the nightly backup runs, UTC. Computed
  # with plain arithmetic on `date -u` fields (no GNU `date -d`/BSD `date -v`
  # flags) so this works unmodified on busybox ash (this image's shell).
  target_hour="${BACKUP_HOUR_UTC:-2}"
  now_h="$(date -u +%H)"
  now_m="$(date -u +%M)"
  now_s="$(date -u +%S)"
  since_midnight=$((10#$now_h * 3600 + 10#$now_m * 60 + 10#$now_s))
  target=$((target_hour * 3600))
  if [ "$since_midnight" -lt "$target" ]; then
    echo $((target - since_midnight))
  else
    echo $((86400 - since_midnight + target))
  fi
}

# Run once on start so a fresh deployment has a baseline backup immediately,
# rather than waiting up to 24h for the first scheduled run.
run_backup

while true; do
  sleep_secs="$(seconds_until_next_run)"
  echo "[backup] sleeping ${sleep_secs}s until next scheduled run"
  sleep "$sleep_secs"
  run_backup
done
