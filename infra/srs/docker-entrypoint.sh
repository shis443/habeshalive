#!/bin/sh
set -e

secret="${SRS_WEBHOOK_SECRET:-dev-only-change-me}"
# Defaults to the docker-compose internal hostname for local dev; the Fly.io
# deployment overrides this to the real public API URL (SRS's http_hooks
# can only call a real reachable URL, no internal-network shortcut there).
api_webhook_base="${API_WEBHOOK_BASE:-http://api:4000}"
# WebRTC ICE candidate SRS advertises for WHIP publishing. `*` (local dev
# default) auto-detects every network interface, which on Fly also picks up
# container-private IPs (172.19.x.x) that no real client can ever reach —
# harmless for HTTP but WebRTC candidates get tried directly by the browser,
# so noise here is candidate-pairs that can only fail. Fly production pins
# this to the app's dedicated IPv4 (UDP requires one — see infra/srs/fly.toml)
# so SRS advertises exactly one, actually-reachable candidate.
webrtc_candidate="${SRS_WEBRTC_CANDIDATE:-*}"

# Fly-specific: a UDP socket bound to 0.0.0.0 replies with the machine's
# private 6PN address as its source IP (that's just how the kernel picks a
# source for a wildcard-bound socket) — fly-proxy doesn't recognize that as
# the app's public IP and silently drops the reply. Fly's documented fix is
# to bind to the `fly-global-services` address instead, but SRS's
# rtc_server `listen` directive only accepts a bare port — passing it
# "ip:port" doesn't error, it silently mis-binds (confirmed live: SRS logged
# "rtc listen at udp://0.0.0.0:172" for `listen 172.19.48.163:8000;`, i.e.
# it fed the whole string through something like atoi() and kept the
# 0.0.0.0 default). So SRS can't be pointed at fly-global-services itself.
# Workaround: SRS binds an internal-only port, and socat — which *can* bind
# a specific address — sits in front on the real public port, correctly
# bound to fly-global-services, relaying raw datagrams both ways. socat
# doesn't need to understand STUN/DTLS/SRTP; they're all just UDP payloads
# to it, and it's the standard fix for this exact class of Fly.io problem.
# Not present in local docker-compose dev (no Fly networking, no socat in
# that image either — see docker-compose.yml), so this falls back to SRS
# binding 0.0.0.0:8000 directly there, same as before.
webrtc_listen_port="8000"
fly_global_ip=$(getent hosts fly-global-services 2>/dev/null | awk '{print $1}')
if [ -n "$fly_global_ip" ]; then
  webrtc_listen_port="18000"
fi

sed \
  -e "s|__SRS_WEBHOOK_SECRET__|${secret}|g" \
  -e "s|__API_WEBHOOK_BASE__|${api_webhook_base}|g" \
  -e "s|__SRS_WEBRTC_CANDIDATE__|${webrtc_candidate}|g" \
  -e "s|__SRS_WEBRTC_LISTEN__|${webrtc_listen_port}|g" \
  /usr/local/srs/conf/srs.conf.template > /usr/local/srs/conf/srs.conf

if [ -n "$fly_global_ip" ]; then
  # -T: idle timeout per relayed peer session, well past any STUN/RTCP
  # keepalive interval so an active publish never gets reaped mid-stream.
  socat -T 120 UDP4-LISTEN:8000,bind="${fly_global_ip}",fork,reuseaddr UDP4:127.0.0.1:${webrtc_listen_port} &
fi

# Cloudflare Tunnel — connects this machine to stream.birq.live
# (docs/egress-protection-plan.md §2), routing to SRS's own http_server on
# localhost:8080 per the tunnel's ingress config (set via the Cloudflare
# API, not baked in here). Same background-then-exec pattern as socat
# above: started before the final exec, keeps running as an independent
# process regardless of what exec does to this shell. Absent
# (CLOUDFLARE_TUNNEL_TOKEN unset) in local dev — no Cloudflare setup there.
if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  cloudflared tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN" &
fi

# Path-filtering proxy in front of SRS's http_api (1985) — see
# conf/whip-proxy.nginx.conf's file comment. fly.toml's WHIP [[services]]
# block points its public 8443 mapping at this proxy's port (1986), not
# SRS's real 1985 directly, so this must be running before SRS starts
# accepting the traffic Fly forwards to it.
nginx -c /usr/local/srs/conf/whip-proxy.nginx.conf -g "daemon off;" &

exec /usr/local/srs/objs/srs -c /usr/local/srs/conf/srs.conf
