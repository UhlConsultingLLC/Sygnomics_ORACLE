# Security Policy

Thank you for helping keep ORACLE secure.

## Supported versions

Security fixes land on the `main` branch and are cut into the next patch
release. Only the latest `MAJOR.MINOR` line receives fixes; older minor
versions are not patched.

| Version | Status |
|---------|--------|
| 1.0.x   | ✅ Supported |
| < 1.0   | ❌ Unsupported (pre-release) |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**
Public issues are indexed by search engines within minutes and can be
exploited before a fix is in place.

Instead, use one of:

1. **GitHub Security Advisories** (preferred) — on the repository page,
   go to the *Security* tab → *Report a vulnerability*. This creates a
   private advisory visible only to repo maintainers, lets you propose
   a fix via a private fork, and coordinates disclosure timing.
2. **Email** — send the details to the maintainer address listed in the
   repository owner's GitHub profile. Include enough detail to reproduce
   (affected commit SHA + minimal repro steps).

Please include in your report:

- A clear description of the vulnerability.
- The commit SHA and environment (OS, Python version, Node version) where
  you reproduced it. The `/version` endpoint or the sidebar version badge
  can give you the build ID in one click.
- Step-by-step reproduction, or a proof-of-concept payload.
- Your assessment of the impact (information disclosure, RCE, DoS, etc.).

## Response expectations

- We aim to **acknowledge** new reports within **48 hours** (business days).
- We aim to provide a **fix or mitigation timeline** within **10 business
  days** of acknowledgment.
- Critical vulnerabilities are prioritized over planned feature work.
- Once a patch is released we'll credit reporters in the CHANGELOG (with
  your permission) and in the Security Advisory.

## Out-of-scope

The following are **not** considered security issues:

- Attacks requiring physical access to a running dev machine.
- Reports against a self-hosted deployment without a reverse-proxy /
  authentication layer (ORACLE is designed for single-user local /
  intranet use — see *Known limitations* in the README).
- Version-fingerprinting via the public `/version` endpoint (intentional;
  exposing the build ID is a feature for reproducibility, not a vuln).
- Denial-of-service via excessively large simulation requests on a shared
  deployment without rate limiting.

## Disclosures to date

None as of `1.0.0`. Historical disclosures will be listed here as they
are resolved.
