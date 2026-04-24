# Security Policy — `@axip/mcp-server`

## Supported versions

| Version | Security fixes |
|---|---|
| 0.2.x (current) | ✅ |
| 0.1.x | ❌ end-of-life — please upgrade |

## Reporting a vulnerability

Please report vulnerabilities via email to **security@axiosaiinnovations.com** (preferred) or **ceo@axiosaiinnovations.com** (fallback during transition to the dedicated security inbox).

We commit to:

- **Acknowledgement within 72 hours** of first contact.
- **Triage + initial response within 7 days** (severity assessment and expected timeline).
- **Patches released as fast as the severity warrants** — critical issues within 48 hours, high-severity within 14 days, medium within 30 days.
- **Coordinated disclosure.** We'll agree on a public disclosure date with the reporter before announcing. Typical window: 90 days from report, earlier if users are at risk.
- **Public credit** to the reporter (unless they prefer anonymity) in the release notes and in `SECURITY_ACKNOWLEDGEMENTS.md`.

Please **do not** file public GitHub issues for security reports.

### What to include

- A clear description of the vulnerability, its impact, and affected versions.
- Reproducible steps (proof-of-concept if applicable).
- Your preferred disclosure timeline.
- Whether you'd like public credit.

## Safe-harbor for security research

We welcome good-faith security research on `@axip/mcp-server` and will not pursue legal action against researchers who:

- Make a **good-faith effort** to avoid privacy violations, data destruction, service disruption, or degradation of user experience.
- Give us **reasonable time** to investigate and fix before public disclosure (see timeline above).
- Contact us via `security@axiosaiinnovations.com` before sharing findings with third parties.
- Do **not** access accounts, data, or systems beyond what is necessary to demonstrate the vulnerability.
- Do **not** run destructive scans (DoS, credential stuffing, spam). Passive and non-disruptive testing only.
- Comply with all applicable laws in your jurisdiction.

Research conducted under these conditions is authorized by us and covered by safe-harbor language under the Computer Fraud and Abuse Act (CFAA, USA) and similar statutes in other jurisdictions where Axios AI Innovations operates.

**Out of scope:**

- Social engineering of Axios staff or customers.
- Physical attacks on infrastructure.
- Attacks on third-party services we depend on (Anthropic API, Cloudflare, Stripe, npm registry) — report those directly to the vendor.
- Automated scanning tools run without prior coordination (please email first).

## Supply-chain & build integrity

- All releases are published to npm with **Sigstore provenance attestations** (`npm publish --provenance`). Verify with `npm audit signatures @axip/mcp-server`.
- Git tags on releases are GPG-signed.
- `package-lock.json` is committed and pinned; dependencies cannot drift between releases without a lockfile change visible in the diff.
- Dependabot monitors all dependencies for known CVEs. CI fails on `npm audit --audit-level=moderate` findings.
- We run `osv-scanner` and `gitleaks` on every commit.

## Threat model

See [`THREAT_MODEL.md`](./THREAT_MODEL.md) for the STRIDE-style analysis of known threats and our mitigations.

## Versioning of security-relevant changes

Any release that includes a security fix will:

- Increment at least the patch version (e.g. `0.2.3` → `0.2.4`).
- Include a `[SECURITY]` prefix in the commit subject line.
- Be summarized in `CHANGELOG.md` under a `### Security` heading.
- Trigger a GitHub Security Advisory (GHSA) for critical/high findings.

## Contact

- **Security reports:** security@axiosaiinnovations.com (preferred) or ceo@axiosaiinnovations.com (fallback)
- **General inquiries:** contact@axiosaiinnovations.com (preferred) or ceo@axiosaiinnovations.com (fallback)
- **Company:** Axios AI Innovations — [axiosaiinnovations.com](https://www.axiosaiinnovations.com)

Last updated: 2026-04-24
