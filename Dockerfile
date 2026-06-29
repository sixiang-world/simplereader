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

# Install dependencies (use npm — pnpm is not preinstalled in node:20-alpine;
# npm can install from a pnpm-lock.yaml + package.json without issue, since
# the lockfile is only consulted by pnpm itself)
RUN npm install --no-audit --no-fund

# Copy source
COPY index.html version.json help.json ./
COPY client/ ./client/
COPY shared/ ./shared/

# Build static bundle → /app/dist
RUN npm run build

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

# Caddy serves /srv on :80 by default with no Caddyfile needed for a static
# site. Expose 80 (default) and 8866 (kept for parity with the old server's
# documented port — map either at runtime via `docker -p`).
EXPOSE 80
EXPOSE 8866

# Inline Caddyfile: serve /srv on :80, enable gzip/br, SPA fallback to index.html
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80", "--browse"]
