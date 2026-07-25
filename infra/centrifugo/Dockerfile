# For Fly.io — bakes the structural (non-secret) config into the image.
# Secrets (token_hmac_secret_key, api_key, admin_password, admin_secret)
# are supplied via CENTRIFUGO_* environment variables (Fly secrets), never
# baked into the image — see fly.toml's comment and the deploy steps in
# docs/architecture.md.
FROM centrifugo/centrifugo:v5

COPY config.json /centrifugo/config.json

CMD ["centrifugo", "--config=/centrifugo/config.json"]
