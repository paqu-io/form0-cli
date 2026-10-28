# Pi exception activation — 27 October 2026

Latest checkpoint: [approved 0.8.2 amendment](#approved-082-amendment--27-october-2026), following
the [CLI 0.8.1 failure diagnosis](CLI_081_RELEASE_FAILURES.md) and
[expanded exception review](PI_SECURITY_EXCEPTION_082_REVIEW.md). The historical approval and
evidence below retain their recorded version/findings; the current policy permits validation at
0.8.1 and publication at 0.8.2 only, with the original expiry unchanged.

The subsequent [PR 85 Node 22 reporting correction](CLI_085_NODE22_TEST_REPORTING.md) retains this
policy and raises full CLI verification to **226 passing tests** on both pinned Node lines. Its
test-runner failure occurred before the audit; it required no security-policy expansion.

The later [shared test-console correction](CLI_SHARED_TEST_REPORTING.md) replaces the per-file
workaround, verifies output across the entire suite, and passes **227 tests** on both Node lines.
Approval scope, expiry and dependency findings remain unchanged.

## Historical 0.8.0 activation

The maintainer approved the exact temporary risk described in
[the reviewed proposal](PI_SECURITY_EXCEPTION_PROPOSAL.md). This change activates that policy for
**publication of form0-cli 0.8.0 only**, until **3 November 2026, 00:00 UTC**. On the same date the
maintainer also approved pre-release validation at 0.7.0; see the amendment below. It does not patch Pi/Undici or make
installed users' raw npm audit reports clean. No release operation was performed.

## Implementation

`security:audit:prod` runs a real production npm audit through `scripts/audit-dependencies.mjs`.
`scripts/audit-policy.mjs` verifies its report against `scripts/security-exceptions.json` and checks
the manifest, lockfile, installed package metadata and Node package resolution. Package lookup
supports Pi's import-only exports without executing its entrypoint. CI now runs `ci:check`; the
publication workflow retains strict `release:check`. Both retain the full checks and real production
dependency audit. Required job names and the global audit severity threshold are unchanged.

Only Pi coding-agent 1.0.4's inherited finding and its exact nested Undici 8.10.2 advisories are
accepted: GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472 and GHSA-xjj6-f33q-929c. Unknown findings, additional
vulnerable copies, changed versions/paths, new direct Pi advisories, widened inherited chains,
critical escalation, invalid/expired approval and audit/network/parser failures reject the gate.
There is no command-line/environment clock override or automatic renewal. An expired policy must
be removed with remediation; a clean graph with no exceptions uses the original strict threshold.

The public `SECURITY.md` discloses the accepted remaining risks. Dependencies and the lockfile are
unchanged. Native/mobile exceptions and documentation deployment policy are unaffected.

## Automated evidence

All commands reuse the existing independent tree at
`.local-test-harnesses/form0-plan3-20261022/cli`, with registry core 0.8.1. No dependency installation,
maintained dependency-tree replacement, browser/device rerun or new provider/network integration
was needed. Only the real public npm audit endpoint was queried.

- Full Node 24 `release:check`: **208 tests pass**, formatting/smoke pass, production audit accepts
  exactly the approved two package entries/three advisories, package contents pass (101 files).
  Log: `logs/pi-exception-release-check.log`.
- The 16 policy/runner cases cover positive approval and the failures listed above, including
  import-only exports without entrypoint execution and a dependency symlink escaping the project.
  The same cases and real audit also pass on Node 22.23.4; see
  `logs/pi-exception-node22-tests.log` and `logs/pi-exception-node22-audit.log`.
- A real audit against version **0.7.0** fails explicitly, despite matching dependency findings:
  `logs/pi-exception-wrong-release.log`. Versioning the independent candidate as **0.8.0** then
  permits the known risk. Root manifest and both lockfile version locations must agree.

## Maintainer release boundary

The maintained manifest remains **0.7.0**. Run `npm run ci:check` while preparing the PR, merge
development to main, then bump the CLI manifest/lockfile on main to **0.8.0** before publication.
Run `npm run release:check` and publish before the exception expires. A different release needs an
explicitly reviewed policy change. Release checks still reject 0.7.0; CI validation may accept it
under the explicit amendment below.

Remove the exception as soon as a verified fixed Pi/fork dependency is adopted. Existing installed
releases require users to upgrade to that fixed distribution; approval expiry does not repair them.

The subsequent [terminal-color test correction](TERMINAL_COLOR_TEST_FAILURES.md) raises verification
to **212 passing tests** and full release checks on both Node lines with true-color forced. The
208-test result above retains its original provenance. Exception scope, expiry and dependencies
are unchanged.

## Approved pre-release validation amendment — 27 October 2026

The maintainer explicitly approved **0.7.0 for pre-release validation while publication remains
restricted to 0.8.0**. The policy now records validationVersion:0.7.0 alongside cliVersion:0.8.0.
Only `--validation`, selected by `ci:check`, permits the former. The default audit remains strict;
unknown arguments/purposes reject. Manifest and both root lockfile version locations must agree,
even when each mismatched version would individually be allowed for validation.

No advisory, dependency version/path, severity, approval expiry or production persistence behavior
changed. The workflow triggered by pushed version tags and the publication workflow are unchanged.
See [amendment verification](PRE_RELEASE_VALIDATION_EXCEPTION.md) for current evidence. Earlier
208/212-test and 0.7.0 rejection logs above retain their original strict-release provenance.

## Approved 0.8.2 amendment — 27 October 2026

After reviewing the eight-advisory scope and observed transport exposure, aragornii explicitly
approved activating it. The maintainer also clarified that form0-cli will be used mainly locally
while developers test. That intended usage reduces exposure compared with an unattended public
service, but does not remove affected HTTP paths or protect local work/data from malicious or
compromised responses, endpoints, redirects or proxies. It is context for the risk acceptance,
not a dependency patch or proof that every advisory is unreachable.

The active policy is now `pi-undici-cli-082-20261027`:

| Boundary                    | Active approval                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Publication                 | **0.8.2 only**, through the default/release purpose                                                                                    |
| Additional validation label | **0.8.1 only**, through explicit validation; 0.8.2 also passes validation                                                              |
| Approval                    | aragornii, 27 October 2026                                                                                                             |
| Expiry                      | **3 November 2026, 00:00 UTC / 01:00 Europe/Paris**, unchanged                                                                         |
| Dependencies                | Exact Pi **1.0.4**, inherited through the same nested Undici **8.10.2** path/pin only                                                  |
| Advisories                  | The **eight exact identities/severities** in [the reviewed matrix](PI_SECURITY_EXCEPTION_082_REVIEW.md#primary-source-advisory-matrix) |
| Other releases/findings     | Rejected; no wildcard, extension or automatic renewal                                                                                  |

The policy, public disclosure and captured audit fixture were updated together. The policy/runner
implementation, workflow commands, global audit threshold, manifest, lockfile and dependency trees
are unchanged. Approval cannot hide a direct Pi advisory, new package/copy/path, changed pin,
different advisory severity, critical escalation, audit failure or expiry. The tests verify each
advisory requires explicit approval and that amending versions alone still rejects the five additions.

### Automated verification

The existing independent CLI tree was reused, with registry core 0.8.1 and no dependency install.
Heavy checks ran sequentially. No browser, Android or provider test was needed for this policy-only
change; accepted calculation/event/device evidence retains its existing provenance.

- Updated tests first fail against the historical policy: `logs/cli082-activation-red.log`.
  After activation, the **26 focused policy/runner tests pass**, including expiry, all eight exact
  identities, a ninth identity, rejected 0.8.0/0.8.3 releases, mixed root versions and network failures.
  Result: `logs/cli082-activation-green.log`.
- Full `ci:check` at **0.8.1**, Node **24.22.1** and **22.23.4**: **225 tests pass** on each,
  formatting/smoke pass, live production audits accept only the reviewed Pi/Undici entries and eight
  advisory identities, and package contents pass (**101 files**).
  Logs: `logs/cli082-activation-ci-v24.22.1.log` and `logs/cli082-activation-ci-v22.23.4.log`.
- Full `release:check` with **only the independent candidate** labelled **0.8.2**, Node 24.22.1:
  **225 tests**, formatting, smoke, live exception-aware audit and package contents pass.
  Log: `logs/cli082-activation-release-candidate.log`.
- A real strict-release audit at **0.8.1** still exits 1 for the version restriction, despite matching
  dependency findings: `logs/cli082-activation-release-081-rejected.log`.
- Driver and machine-readable summary: `cli082-activation-checks.py` and
  `logs/cli082-activation-checks.json`, under `.local-test-harnesses/form0-plan3-20261022`.
  The independent manifest/lockfile were restored byte-for-byte after the candidate check.
  Maintained manifest/lockfile SHA-256 before/after match; the maintained version stays **0.8.1**.
- Active policy SHA-256:
  `7f3145d57d3ae73179d005fa733e5a7281f4f796082b2d6b1a094cd364176077`.

Passing checks represent the approved temporary risk acceptance, not a clean dependency audit.
Historical pre-activation probes are not rerun or rewritten to imply they had approved the amendment.

### Maintainer release sequence

1. Push the development commits and use the existing **development → main** PR workflow.
   CI validates the unchanged working-tree version **0.8.1**.
2. After merging, bump manifest/lockfile to **0.8.2 on main**, preserving the usual release-note flow.
3. Run `npm run release:check` and create a **fresh v0.8.2 release/tag from that corrected commit**
   before expiry. Publication remains maintainer-owned.

Re-running the old v0.8.1 publication job continues to check its old tagged policy. This work does
not move or delete that tag, publish 0.8.1, or authorize 0.8.3. New findings or expiry still block.
Remove the allowance as soon as a verified consumer-installable fixed upstream/patched Pi
distribution passes compatibility and strict audit. Existing vulnerable installations require users
to upgrade; intended local usage and approval expiry do not repair them.
