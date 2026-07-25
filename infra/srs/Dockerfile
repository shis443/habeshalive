# For Fly.io (and any host without docker-compose's volume-mount templating)
# — bakes the config template + entrypoint into the image at build time
# instead of mounting them at runtime.
FROM ossrs/srs:6

# socat relays the public WebRTC UDP port on Fly — SRS's own rtc_server
# listener can only bind 0.0.0.0 (no ip:port form in its `listen`
# directive), which replies with the machine's private address as source
# and gets silently dropped by fly-proxy. See docker-entrypoint.sh.
RUN apt-get update && apt-get install -y --no-install-recommends socat && rm -rf /var/lib/apt/lists/*

COPY conf/srs.conf.template /usr/local/srs/conf/srs.conf.template
COPY docker-entrypoint.sh /entrypoint/docker-entrypoint.sh

ENTRYPOINT ["/entrypoint/docker-entrypoint.sh"]
