# For Fly.io (and any host without docker-compose's volume-mount templating)
# — bakes the config template + entrypoint into the image at build time
# instead of mounting them at runtime.
FROM ossrs/srs:6

COPY conf/srs.conf.template /usr/local/srs/conf/srs.conf.template
COPY docker-entrypoint.sh /entrypoint/docker-entrypoint.sh

ENTRYPOINT ["/entrypoint/docker-entrypoint.sh"]
