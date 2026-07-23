# OWASP ZAP baseline scan

Against the real running stack, not a synthetic target — start it first
(`docker compose up -d`), then:

```sh
docker run --rm --network habeshalive_default \
  -v "$(pwd)/infra/zap:/zap/wrk/:rw" \
  ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t http://web:3000 -r zap-web-report.html -J zap-web-report.json -I
```

`--network habeshalive_default` puts the scanner on the same Docker
network as the stack, so it can reach `http://web:3000` by service name —
no host networking needed. `-I` shows all findings on stdout even though
the baseline scan only fails the exit code on `FAIL`-level results, not
`WARN`.

**Only the web app is scanned this way.** The baseline scan is a
spider — it crawls HTML pages for links. Pointed at the API
(`http://api:4000`), a pure JSON REST API, it has nothing to spider and
hung for 37+ minutes with no output before being killed (see
`docs/architecture.md`'s Security scanning section for the full story,
including what was verified about the API's security posture directly
instead). A real API-focused DAST pass would use ZAP's *active* scan
against specific documented endpoints, not the baseline spider.

Findings and the fixes made in response are documented in
`docs/architecture.md`'s "Security scanning & load testing" section —
read that before re-running this, so a re-run's diff is meaningful
against what's already known.
