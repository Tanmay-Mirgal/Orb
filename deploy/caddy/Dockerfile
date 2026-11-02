# Caddy with a DNS-01 provider plugin, needed for the wildcard certificate (*.BASE_DOMAIN).
# Swap `cloudflare` for your DNS provider (https://github.com/caddy-dns) and update the Caddyfile `tls { dns ... }` line.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
