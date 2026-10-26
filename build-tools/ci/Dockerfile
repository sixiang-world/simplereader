# CI builder image referenced by .cnb.yml via `docker.build` — this is NOT the
# runtime image at the repo root (that one ships Caddy + dist for self-hosting).
#
# CNB builds this image once, caches it by content hash and reuses it for later
# pipelines (see https://docs.cnb.cool/zh/build/build-env.md). Bake only the
# stable system toolchain here; app dependencies stay in the install stage so a
# lockfile bump does not force an image rebuild.
FROM node:22-alpine

# python3  — build-tools/*.py and test/test_build_tooling.py (validate gate)
# chromium — real-browser regression (test/browser-*.mjs resolves /usr/bin/chromium)
RUN apk add --no-cache python3 chromium
