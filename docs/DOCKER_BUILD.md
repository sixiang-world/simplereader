# Reproducible static image

`docker build -t simplereader .` installs locked pnpm dependencies with their
lifecycle scripts, copies the preprocessing tools and builds the static reader.
The runtime image contains only Caddy and dist; directory browsing is disabled.

For a corporate HTTPS inspection proxy, keep verification enabled and optionally
provide its public CA bundle with BuildKit:

```sh
docker build --secret id=registry_ca,src=/path/to/trusted-ca-bundle.pem \
  --build-arg HTTPS_PROXY --build-arg HTTP_PROXY --build-arg NO_PROXY \
  -t simplereader .
```

The optional CA mount is available only during installation, is never copied into
a layer, and does not affect the runtime image. Proxy variables are passed by
name from the caller; do not commit proxy credentials. If container DNS cannot
resolve the provided proxy hostname, use the platform-supported proxy routing or
an environment-specific `--add-host` argument; do not hardcode it in this repo.
No TLS, package signature or artifact verification is disabled.
