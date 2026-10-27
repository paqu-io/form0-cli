# Security Policy

Security reports are taken seriously. Please report vulnerabilities privately so they can be
investigated and fixed before public disclosure.

## Reporting a vulnerability

Use the
[form0-cli private vulnerability report](https://github.com/paqu-io/form0-cli/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include:

- the affected version and runtime;
- a minimal reproduction or proof of concept;
- the impact you believe is possible;
- any mitigations you have already identified; and
- whether the issue has been disclosed anywhere else.

Reports affecting any version are welcome. When possible, reproduce the issue with the latest
release, or the latest default branch for repositories that are not published as packages.
Security fixes are normally released for the latest version; older versions are assessed case by
case.

Maintainers will review the report, may ask for more information, and will coordinate disclosure
after a fix or mitigation is available. Please keep the report private during that process.

For ordinary usage questions, see
[SUPPORT.md](https://github.com/paqu-io/form0-cli/blob/main/SUPPORT.md).

## Temporary dependency risk accepted for CLI 0.8.0

The maintainer approved a one-release exception on 27 October 2026, expiring at
**3 November 2026, 00:00 UTC**. CLI 0.8.0 may ship Pi coding-agent 1.0.4 with its nested Undici 8.10.2.
These dependencies remain vulnerable; this exception is not a patch and does not make users' raw
npm audit reports clean.

Accepted Undici advisories are [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c),
[GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) and
[GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472), plus Pi's inherited finding
through those exact dependencies. Potential effects include denial of service and integrity-check
bypass in the affected HTTP client paths. Form expression SAFE mode does not patch an HTTP library.

The maintainer also approved validation of the unreleased working tree labelled **0.7.0**, preserving
version bumps on main. `npm run ci:check` explicitly selects validation and accepts 0.7.0 or 0.8.0.
`npm run release:check` and the publication workflow remain restricted to **0.8.0 only**. No other
release is approved by the validation allowance. CI environment flags do not select this allowance.

Both paths run a real production-dependency audit. The exception-aware gate verifies the exact
version, approval, expiry, dependency versions/paths, installed resolution and advisory identities.
New findings, broader inherited chains, audit failures and expiry still block. No automatic renewal
is allowed. Remove this exception as soon as the dependency is fixed; after expiry, remediate before
any further publication. Runtime consumers need a fixed package release to remove the vulnerability.

The repository policy is scripts/security-exceptions.json; both workflows use the same audit policy
with an explicit validation context for CI and a strict release context for publication.
The exception does not apply to other CLI releases, packages or the separate Native/mobile policy.
