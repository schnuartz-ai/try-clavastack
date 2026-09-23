# VPS configuration

Production serves the static WebAssembly simulators and a separate on-demand
build API for the `/ab/` page. No interactive Specter process, Xvfb, x11vnc,
websockify, noVNC or simulator allocator is required on the VPS.

`Caddyfile.root` is installed as `/etc/caddy/Caddyfile` and imports independent
site blocks from `/etc/caddy/sites-enabled/*.caddy`. `Caddyfile` is the public
`try.clavastack.com` site block. Keeping them separate allows a future CRM to
listen only on a Tailscale address without involving Cloudflare or the public
website.

The tested static site is published as a checksummed GitHub release asset and
pulled by `try-browser-auto-deploy.timer`. Releases are installed below
`/var/www/try-clavastack-deploy/releases/` and activated with an atomic
`current` symlink. The unprivileged deployer can write only the static webroot
and its deployment state. Caddy configuration is installed separately by root
and cannot be changed by GitHub release artifacts.

Install the mechanism from a trusted checkout as root:

```bash
bash deploy/install-server.sh
```

The production units owned by this repository are:

- `try-browser-auto-deploy.service`
- `try-browser-auto-deploy.timer`
- `try-ab-builder.service`

The A/B builder listens only on `127.0.0.1:9002`, accepts approved public
Specter DIY and Playground repositories, and publishes generated immutable
firmware below `/var/lib/try-clavastack/ab-builds`. It runs as the separate
unprivileged `clavastack-ab` user.

See the repository-level [`SETUP.md`](../SETUP.md) for build, deployment and
rollback details.
