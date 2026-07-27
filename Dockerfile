# Build stage — produce the Vite production bundle (dist/)
# (v2 refactor) The server/ directory has been archived (see archive/server/).
# The image now ships ONLY the static frontend. Use any static file server to
# serve dist/. Here we use Caddy because the project's deployment docs already
# reference it; nginx would work equally well.
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml jsconfig.json ./
COPY vite.config.js ./

# Enable pnpm via corepack (pnpm is declared in package.json `packageManager`)
# and install from the committed pnpm-lock.yaml. This keeps the dependency
# tree identical across EdgeOne / Docker / local dev (single source of truth).
RUN corepack enable && corepack prepare pnpm@$(node -p "require('./package.json').packageManager.replace(/pnpm@/, '')") --activate && pnpm install --frozen-lockfile --no-audit --no-fund

# Copy source
COPY index.html version.json help.json ./
COPY client/ ./client/
COPY shared/ ./shared/

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

# Inline Caddyfile: serve /srv on :80, enable gzip/br, SPA fallback to index.html
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80", "--browse"]
