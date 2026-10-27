# CLI 0.8.1 release failures — 27 October 2026

Status: diagnosis verified; the subsequent expanded exception was explicitly approved by aragornii
on 27 October 2026 and activated for validation **0.8.1** / publication **0.8.2 only**. See
[reviewed scope](PI_SECURITY_EXCEPTION_082_REVIEW.md) and
[activation evidence](PI_SECURITY_EXCEPTION_ACTIVATION.md#approved-082-amendment--27-october-2026).
The failure diagnosis and original gate evidence below are historical. No dependency upgrade,
version bump, tag change or publication was performed by this work.

## Why PR checks passed and main/release failed

The PR's source commit `aaa0adb` declares CLI 0.8.0. Main was then bumped to 0.8.1 in
`ead955311b50d1abc6ac40344a0d6f198a0f5204`. The configured audit exception permits validation
at 0.7.0/0.8.0 and publication at 0.8.0 only. It intentionally rejects 0.8.1.

| Job                                                                                             | Observed result                                                                  |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Node 22 CI](https://github.com/paqu-io/form0-cli/actions/runs/40569267745/job/122418892167)    | Formatting, tests and smoke reach the audit; validation rejects the CLI version. |
| [Node 24 CI](https://github.com/paqu-io/form0-cli/actions/runs/40569267745/job/122418891673)    | All 222 tests pass; validation rejects the CLI version.                          |
| [Publish 0.8.1](https://github.com/paqu-io/form0-cli/actions/runs/40570177935/job/122421972906) | Release checks reject the CLI version before npm publication.                    |

These linked failures do not reproduce the earlier Node 22 test-runner serialization problem.
Neither job uses a weaker audit merely because it is a PR. The meaningful difference is the
manifest version after the maintainer's main-branch bump. Existing required checks stay in place.

## Fresh audit has a second blocker

A subsequent real production audit still finds two package entries, but now eight Undici advisories
instead of the originally approved three. Counts of vulnerable packages and advisories differ.
Changing the exception's version alone leaves five explicit unaccepted-advisory errors.

Newly observed findings in the same nested Undici 8.10.2 copy:

| Advisory                                                                 | Severity | Reported risk                                                                                          |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------ |
| [GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26) | High     | Cross-origin redirects with shared caching can poison cache entries and expose responses across users. |
| [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx) | High     | Agent option cloning can discard a custom TLS identity-verification callback.                          |
| [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) | High     | A TLS 1.2 renegotiation with a changed certificate can crash the client.                               |
| [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6) | Moderate | Automatic WebSocket PONG buffering can exhaust resources.                                              |
| [GHSA-55wc-3pg8-jfw6](https://github.com/advisories/GHSA-55wc-3pg8-jfw6) | Moderate | An exception from a decompression interceptor's downstream handler can escape request-level handling.  |

The primary advisories include Undici 8.10.2 in their affected ranges and list 8.12.2 as patched.
Registry inspection currently reports Undici 8.12.3. Latest Pi coding-agent 1.4.0 still pins Undici
8.10.2; upgrading Pi alone is not a demonstrated fix. The CLI still pins Pi 1.0.4. No dependency
tree was installed, no provider credentials were inspected and no exploit was executed.

The earlier approval is not approval for these additional disclosure/TLS and denial-of-service
findings. Direct Form0 source inspection is not proof that all affected transitive provider paths
are unreachable. The guard correctly rejects new advisory identities even without a severity-count
increase. Do not change the policy to accept every finding or lower the global threshold.

## Concrete next-release decision

Prefer a verified upstream or minimally patched Pi distribution that installs a fixed Undici for
CLI users. Root-only overrides do not repair dependencies for consumers installing the published
CLI; a patched fork has its own ownership/publication work. Existing packaging/downgrade limits
are recorded in [the original exception review](PI_SECURITY_EXCEPTION_PROPOSAL.md).

If the maintainer chooses another temporary exception, the proposed narrow amendment is:

- Publish **0.8.2 only**, with **0.8.1 allowed for pre-release validation**. This preserves bumps on
  main while avoiding movement of the already-created v0.8.1 tag.
- Keep Pi 1.0.4, the exact nested Undici 8.10.2 path, installed/lock verification and existing
  maximum severities. Explicitly review all eight identified advisories and the inherited Pi finding.
- Keep the existing expiry **3 November 2026, 00:00 UTC**. Add no range/wildcard, auto-renewal,
  advisory catch-all or exception for unrelated findings. Later versions remain unapproved.
- Update the approval record, disclosure and tests together only after explicit maintainer approval.
  The original 0.8.0 approval and historical tests retain their provenance.

This proposal was subsequently explicitly approved and activated; see the current checkpoint above.
Its risk includes shipping the vulnerable dependency to installed users. A passing exception-aware
gate does not mean that their npm audits are clean.

The v0.8.1 release points to `ead9553` and is present on GitHub; registry versions stop at 0.8.0 at
inspection. Re-running that old release continues using its old policy. A fix merged into main does
not modify a tag. Prefer a fresh release/tag from the corrected commit; moving v0.8.1 would require
an explicit maintainer decision. No release or tag mutation was performed here.

## Reproducible evidence

The following captures the original diagnosis before the approved amendment was activated.

- Running `node scripts/audit-dependencies.mjs --validation` in the current 0.8.1 checkout fails
  with the version restriction and five unaccepted advisories.
- `node --test tests/security-audit-policy.test.js tests/security-audit-runner.test.js`: **23 pass**.
  These tests verify the current fail-closed policy; they do not approve the proposed amendment.
- Existing active harness `cli081-policy-diagnostic.mjs` exercises the real policy implementation
  with the captured current audit. It proves that a version-only amendment still fails. An in-memory,
  unapproved 0.8.2/0.8.1/eight-advisory simulation permits only its exact proposed scope and still
  rejects expiry and 0.8.3. Maintained policy bytes remain unchanged.
- Current report and probe output: active harness `logs/cli081-current-audit.json` and
  `logs/cli081-policy-diagnostic.json`. No new dependency tree or heavy test run was needed.

Automatic schema click behavior is unrelated: current built-in inputs and choice controls do not
emit click. Choice selection still works and uses change. Explicit controller dispatch remains.
