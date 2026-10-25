# Build stage — produce the Vite production bundle (dist/)
# (v2 refactor) The server/ directory has been archived (see archive/server/).
# The image now ships ONLY the static frontend. Use any static file server to
# serve dist/. Here we use Caddy because the project's deployment docs already
# reference it; nginx would work equally well.
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml jsconfig.json ./
COPY vite.config.js ./
COPY build-tools/ ./build-tools/

# Enable pnpm via corepack (pnpm is declared in package.json `packageManager`)
# and install from the committed pnpm-lock.yaml. This keeps the dependency
# tree identical across EdgeOne / Docker / local dev (single source of truth).
# Corporate build proxies may supply their public CA as an optional BuildKit
# secret; it is never baked into either image and verification stays enabled.
RUN --mount=type=secret,id=registry_ca \
    if [ -f /run/secrets/registry_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/registry_ca; fi; \
    export NODE_USE_ENV_PROXY=1; \
    corepack enable && corepack prepare pnpm@$(node -p "require('./package.json').packageManager.replace(/pnpm@/, '')") --activate && pnpm install --frozen-lockfile

# Copy source
COPY index.html version.json help.json ./
COPY client/ ./client/
COPY shared/ ./shared/
COPY books/ ./books/

# Build static bundle → /app/dist
RUN pnpm run build

# ---- Runtime stage ---------------------------------------------------------
# Serve dist/ as static files. Caddy is ~30MB, has automatic gzip/br, and
# the project's existing deployment docs already reference it.
FROM caddy:2-alpine
WORKDIR /srv

# Copy built artifacts from the builder stage
COPY --from=builder /app/dist/ /srv/

# Optional: project's static root historically also exposed books/ for the
# reader's local-library file storage. Keep the volume mount point.
RUN mkdir -p /srv/books
VOLUME ["/srv/books"]

# Caddy serves /srv on :80 (see CMD). v2 is a static frontend only — the
# old server's :8866 port no longer exists, so only :80 is exposed.
EXPOSE 80

# Serve only the static production bundle; directory browsing is unnecessary.
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]
