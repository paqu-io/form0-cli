# Pi exception activation — 27 October 2026

The maintainer approved the exact temporary risk described in
[the reviewed proposal](PI_SECURITY_EXCEPTION_PROPOSAL.md). This change activates that policy for
**form0-cli 0.8.0 only**, until **3 November 2026, 00:00 UTC**. It does not patch Pi/Undici or make
installed users' raw npm audit reports clean. No release operation was performed.

## Implementation

`security:audit:prod` runs a real production npm audit through `scripts/audit-dependencies.mjs`.
`scripts/audit-policy.mjs` verifies its report against `scripts/security-exceptions.json` and checks
the manifest, lockfile, installed package metadata and Node package resolution. Package lookup
supports Pi's import-only exports without executing its entrypoint. Both existing workflows still
call `release:check`; no workflow/check name or global audit severity threshold was removed.

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

The maintained manifest remains **0.7.0**. Before publication, bump the CLI manifest/lockfile to
**0.8.0**, run `npm run release:check` again, and publish before the exception expires. A different
release needs an explicitly reviewed policy change. CI will reject 0.7.0 under this exact exception;
that is intentional, not evidence of a clean current-version release gate.

Remove the exception as soon as a verified fixed Pi/fork dependency is adopted. Existing installed
releases require users to upgrade to that fixed distribution; approval expiry does not repair them.

The subsequent [terminal-color test correction](TERMINAL_COLOR_TEST_FAILURES.md) raises verification
to **212 passing tests** and full release checks on both Node lines with true-color forced. The
208-test result above retains its original provenance. Exception scope, expiry and dependencies
are unchanged.
