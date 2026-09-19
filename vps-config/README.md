# VPS configuration

Production serves only the static WebAssembly simulator. No Specter process,
Xvfb, x11vnc, websockify, noVNC or allocator is required on the VPS.

`Caddyfile.root` is installed as `/etc/caddy/Caddyfile` and imports independent
site blocks from `/etc/caddy/sites-enabled/*.caddy`. `Caddyfile` is the public
`try.clavastack.com` site block. Keeping them separate allows a future CRM to
listen only on a Tailscale address without involving Cloudflare or the public
website.

The tested static site is published as a checksummed GitHub release asset and
pulled by `try-browser-auto-deploy.timer`. Releases are installed below
`/var/www/try-clavastack-deploy/releases/` and activated with an atomic
`current` symlink. The deployer also validates and atomically updates only the
public site's Caddy snippet.

Install the mechanism from a trusted checkout as root:

```bash
bash deploy/install-server.sh
```

The only production units owned by this repository are:

- `try-browser-auto-deploy.service`
- `try-browser-auto-deploy.timer`

See the repository-level [`SETUP.md`](../SETUP.md) for build, deployment and
rollback details.
