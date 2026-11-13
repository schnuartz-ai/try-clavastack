# Retired VNC simulator

The VNC-based simulator and allocator are unsupported and must not be exposed
or restarted. They did not authenticate access to individual VNC sessions and
could expose test seeds and PINs. The current simulator runs in the browser; see
the [setup guide](../SETUP.md). The previous implementation remains in Git
history for audit purposes, not as deployment instructions.

The files that formerly started the VNC pool, its updater and allocator now
exit without starting anything. The old systemd unit definitions have been
removed from this repository. This change does **not** alter any already
installed files, running services, timers, firewall rules or processes on a
server. A static-site release alone cannot complete this retirement.

## Checklist for a server administrator

Inspect the machine before making changes. In particular, enumerate installed
units and running listeners rather than assuming that the checked-in units
describe the entire server. The following commands are read-only examples:

```bash
systemctl list-unit-files 'try-*' --no-pager
systemctl list-units --all 'try-*' --no-pager
systemctl list-timers --all --no-pager
ss -ltnp
```

Review the legacy allocator and updater (`try-allocator.service` and
`try-auto-update.{service,timer}`), all installed `try-diy*`, `try-play*` and
`try-schnuartz*` units, and any separate legacy health or restart services.
Check for Xvfb, x11vnc, websockify and MicroPython processes and listeners on
ports 5900–5924 and 6080–6104, including non-loopback listeners. Confirm firewall
and cloud firewall rules independently. Do not assume that a public HTTP 404
proves that direct VNC ports or old timers are inactive.

After approval and after identifying the owners and dependencies, stop and
disable the obsolete updater and allocator timers/services first. Then stop the
old slot services while their currently installed stop scripts are still
available, clean up any detached processes, remove their listeners and firewall
access, and ensure they cannot return on reboot. Do this before replacing the
installed scripts with the disabled versions: the disabled scripts intentionally
cannot stop pre-existing processes. The old `Type=oneshot` units may leave
detached children when stopped; verify process termination separately. Preserve the current
`try-browser-auto-deploy` and `try-ab-builder` units unless their actual roles
have been confirmed: the former name was reused by the modern deployment.
Install and validate the current Caddy configuration separately, then verify
the retired paths are rejected and the current browser application and A/B API
still work. Recheck listeners after a reboot or service restart.

No safe replacement VNC service is provided. Bringing VNC back would require a
new design with authenticated per-session WebSocket access, loopback-only
backends, lifecycle isolation and tests before deployment.
