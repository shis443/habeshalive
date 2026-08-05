# For Fly.io (and any host without docker-compose's volume-mount templating)
# — bakes the config template + entrypoint into the image at build time
# instead of mounting them at runtime.
FROM ossrs/srs:6

# socat relays the public WebRTC UDP port on Fly — SRS's own rtc_server
# listener can only bind 0.0.0.0 (no ip:port form in its `listen`
# directive), which replies with the machine's private address as source
# and gets silently dropped by fly-proxy. See docker-entrypoint.sh.
#
# cloudflared: runs the Cloudflare Tunnel connecting this machine to
# stream.birq.live (docs/egress-protection-plan.md §2) — an outbound-only
# connection, no public port needed for it. Static binary from Cloudflare's
# own GitHub releases (no apt repo to add just for one binary); amd64
# matches this Fly app's shared-cpu-1x machine size (infra/srs/fly.toml).
#
# nginx: fronts SRS's http_api port with a path-filtering reverse proxy —
# see conf/whip-proxy.nginx.conf's file comment for exactly why (SRS has
# no path-scoped ACL of its own for http_api, and its blanket Basic Auth
# option would also lock out public WHIP publish). Plain "nginx", not
# "nginx-light"/"nginx-core" — package naming/availability for the slimmer
# variants has churned across Debian releases and this base image's exact
# release isn't pinned to a version checked against that, so the always-
# available full package is the safer bet; the size difference doesn't
# matter for this workload.
RUN apt-get update && apt-get install -y --no-install-recommends socat curl ca-certificates nginx && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  && chmod +x /usr/local/bin/cloudflared

COPY conf/srs.conf.template /usr/local/srs/conf/srs.conf.template
COPY conf/whip-proxy.nginx.conf /usr/local/srs/conf/whip-proxy.nginx.conf
COPY docker-entrypoint.sh /entrypoint/docker-entrypoint.sh

ENTRYPOINT ["/entrypoint/docker-entrypoint.sh"]
