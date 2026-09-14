# Security

## Threat model (read this first)

PiBot is a single-user, self-hosted tool. By design it has **no login** and it
can execute shell commands and read/write files **as the user running the
server** — that is what makes it useful. Treat anything that can reach its
port as equivalent to a shell on that machine.

The app is built with that assumption:

- It binds to `127.0.0.1` (loopback only) unless you set `PIBOT_HOST`.
- Every request must carry an expected `Host` header (loopback by default,
  plus `PIBOT_ALLOWED_HOSTS`). This blocks DNS-rebinding attacks.
- State-changing requests must be same-origin, so a random web page cannot
  drive the API from your browser (CSRF), including `no-cors`/`text/plain`
  POSTs that skip CORS preflight.
- `PIBOT_TOKEN` optionally requires a shared secret cookie on every request
  for deployments that are reachable beyond localhost.

Do **not** expose PiBot to the public internet. If you need remote access,
put it behind an authenticated reverse proxy, a VPN, or a tunnel such as
Tailscale, and set `PIBOT_TOKEN`.

## Supported versions

Only the latest commit on `main` is supported. This is a 0.x project; breaking
changes can land at any time.

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub Security Advisories
("Report a vulnerability" on the repo's Security tab) rather than in a public
issue. Include reproduction steps and the affected commit. You can expect an
initial response within a few days.
