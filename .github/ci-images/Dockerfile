# This Dockerfile is never built. It exists only so Dependabot's `docker`
# ecosystem (which reads FROM lines but not workflow `services.*.image`,
# see dependabot-core#5819) can track and bump the digests of the CI
# service container images used by .github/workflows/ci.yml. The
# `ci-images` job in that workflow parses these FROM lines by stage name.

FROM postgres:17@sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232 AS postgres

FROM ghcr.io/timowilhelm/local-neon-http-proxy:main@sha256:cd2ae14edf2feafbc3330492de5c80506f77274c3bd013154cdef697bdeb768a AS neon-proxy
