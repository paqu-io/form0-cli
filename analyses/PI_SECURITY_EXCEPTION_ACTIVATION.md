# Pi exception activation — 27 October 2026

Latest next-release checkpoint: [CLI 0.8.1 failure diagnosis](CLI_081_RELEASE_FAILURES.md).
Main/publish reject 0.8.1, and a newer audit adds five unapproved advisories. The historical approval
and evidence below remain scoped to their recorded version/findings; no amendment is activated.
The [expanded exception review](PI_SECURITY_EXCEPTION_082_REVIEW.md) records exact proposed scope,
primary advisory conditions and observed import/transport exposure; explicit approval is still pending.

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
