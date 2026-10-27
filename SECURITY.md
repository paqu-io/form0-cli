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

## Temporary dependency risk accepted for CLI 0.8.2

The maintainer explicitly approved the expanded exception on 27 October 2026, expiring at
**3 November 2026, 00:00 UTC (01:00 Europe/Paris)**. CLI **0.8.2 only** may ship Pi coding-agent
1.0.4 with its nested Undici 8.10.2. These dependencies remain vulnerable; this exception is not a
patch and does not make installed users' raw npm audit reports clean. This replaces the active
0.8.0 release allowance; the original approval and evidence remain historical.

The exact accepted Undici advisories are:

- [GHSA-4qv8-2p9j-2685](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685), moderate: EventSource memory exhaustion.
- [GHSA-f72v-6w45-q472](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472), moderate: integrity-check bypass with mixed-case SRI algorithms.
- [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c), high: fetch process crash from a malicious encoded response.
- [GHSA-4w7w-5xrc-9h26](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26), high: cache poisoning or response disclosure with shared redirect/cache composition.
- [GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx), high: loss of a custom TLS identity callback; ordinary Node certificate/hostname verification still applies.
- [GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm), high: process crash during TLS 1.2 renegotiation.
- [GHSA-9fm3-97px-rjf6](https://github.com/nodejs/undici/security/advisories/GHSA-9fm3-97px-rjf6), moderate: Undici WebSocket PONG buffering can exhaust memory.
- [GHSA-55wc-3pg8-jfw6](https://github.com/nodejs/undici/security/advisories/GHSA-55wc-3pg8-jfw6), moderate: an asynchronous decompression-handler exception can crash the process.

Pi's finding is accepted only through those exact nested dependencies. The CLI is intended mainly
for local developer testing, which reduces exposure compared with an unattended public service.
It does not protect local work or data from affected HTTP paths, malicious/compromised endpoints,
redirects or proxies. Some advisories require specific API/options; this allowance does not claim
that every advisory is reachable or unreachable. Importing Pi can affect Node HTTP dispatch before
entering AI mode. Form expression SAFE mode does not patch an HTTP library.

The maintainer also approved **0.8.1 for pre-release validation**, preserving version bumps on main.
`npm run ci:check` explicitly selects validation and accepts 0.8.1 or 0.8.2.
`npm run release:check` and the publication workflow remain restricted to **0.8.2 only**. No other
release is approved by the validation allowance. CI environment flags do not select this allowance.

Both paths run a real production-dependency audit. The exception-aware gate verifies the exact
version, approval, expiry, dependency versions/paths, installed resolution and advisory identities.
New findings, broader inherited chains, audit failures and expiry still block. No automatic renewal
is allowed. Remove this exception as soon as the dependency is fixed; after expiry, remediate before
any further publication. Runtime consumers need a fixed package release to remove the vulnerability.

The repository policy is scripts/security-exceptions.json; both workflows use the same audit policy
with an explicit validation context for CI and a strict release context for publication.
The exception does not apply to other CLI releases, packages or the separate Native/mobile policy.
