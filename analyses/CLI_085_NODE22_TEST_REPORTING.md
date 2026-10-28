# PR 85 Node 22 test-reporting failure — 28 October 2026

Latest checkpoint: the [shared test-console correction](CLI_SHARED_TEST_REPORTING.md) supersedes
this per-file workaround after the same runner bug appeared in the consumer catalog suite. The
original diagnosis and verification below remain historical; the common setup now covers all files.

[Run 40599302867, Node 22 job 122523135316](https://github.com/paqu-io/form0-cli/actions/runs/40599302867/job/122523135316?pr=85)
fails while executing `tests/preview-events.test.js`. Node 24 passes. The failing stack is inside
Node's `FileTest.#processRawBuffer` / `parseMessage`, with
`Unable to deserialize cloned data due to invalid or unsupported version.` No form assertion
failure precedes it. The file's remaining cases are lost when the runner fails; the job ends with
207 passing tests and one file-level failure. It never reaches the audit step.

## Diagnosis and bounded correction

This matches the known [Node 22 Unicode stdout/report framing bug](https://github.com/nodejs/node/issues/65934)
and the [original upstream issue](https://github.com/nodejs/node/issues/64061). The pinned Node
22.23.4 lacks the unsigned-length correction present in 24.22.1. The earlier recommendation to
rerun retained coverage, but the repeated CI occurrence warrants a durable test-only correction.

The existing minimal upstream stream-pattern probe reproduces the exact error on Node 22 with
Unicode. Its ASCII variant passes; both variants pass on Node 24. All 23 actual preview-event cases
also pass when run separately, confirming the intermittent reporting failure rather than a failing
event expectation. The probe is kept in the local diagnostic harness, outside the maintained tests.

Each preview-event test now routes its incidental `console.log` messages through
`TestContext.diagnostic()`, using a context-owned mock that restores after each case. The messages,
including Unicode registration markers, remain visible through structured reporter events. The
test does not write them directly into the vulnerable raw child-report stream. CLI/core logging,
event execution, schema behavior, assertions, process isolation, runtime pins, dependencies and
security policy remain unchanged. There is no retry-on-failure or skipped test.

The new regression case launches the **real 23-case preview-event suite** with a collecting test
reporter. It requires every case to pass, requires the Unicode registration messages as structured
diagnostics, and rejects those messages on raw stdout. This fails deterministically before the
fix even when a particular run avoids Node's intermittent parser crash. The fixture reporter is
test-only and is excluded from the published package.

## Automated evidence

Reused `.local-test-harnesses/form0-plan3-20261022/cli`, without a dependency install or new tree.
Heavy checks ran sequentially. Maintained manifest/lockfile remain byte-identical at **0.8.1**.

- Exact upstream-pattern reproduction: `node --test --test-reporter=tap
node22-ci-diagnostic/mixed-stdout.mjs`, using pinned Node 22.23.4 and 24.22.1 with
  `PROBE_ASCII=0/1`. Logs: `logs/cli085-upstream-v{22.23.4,24.22.1}-ascii{0,1}.log`.
- Red-before-fix regression: `node --test --test-reporter=tap
tests/preview-test-reporting.test.js`; `logs/cli085-reporting-red.log`.
- Green regression and original suite: `node --test --test-reporter=tap
tests/preview-test-reporting.test.js tests/preview-events.test.js`; **24 pass**.
  Log: `logs/cli085-reporting-green.log`.
- **Ten consecutive** Node 22 runs of those 24 checks pass, with no skips or failures:
  `logs/cli085-reporting-repeat-{01..10}.log`.
- Full `ci:check` at **0.8.1** passes on Node **22.23.4 and 24.22.1**: **226 tests**, formatting,
  smoke, live production audit under the approved exception, and **101-file** package checks.
  Logs: `logs/cli085-reporting-ci-v{22.23.4,24.22.1}.log`.
- Full `release:check` passes for the independent **0.8.2** candidate on Node 24.22.1; its
  manifest/lockfile are restored afterward. A real strict-release audit still rejects **0.8.1**.
  Logs: `logs/cli085-reporting-release-candidate.log` and
  `logs/cli085-reporting-release-081-rejected.log`.
- Driver/summary: `cli085-reporting-checks.py` and `logs/cli085-reporting-checks.json`.

## Release boundary

Push this correction on the existing development branch to update PR 85 and get fresh CI evidence.
The agent does not rerun jobs, push, merge, bump or publish. After merge, the maintainer's selected
release stays **0.8.2**, using a fresh tag from the corrected main commit. No new core or binding
release is needed for this test-only change.

The [approved security exception](PI_SECURITY_EXCEPTION_ACTIVATION.md#approved-082-amendment--27-october-2026)
is unchanged: exact eight advisories, validation 0.8.1 / publication 0.8.2, expiry
**3 November 2026, 00:00 UTC / 01:00 Europe/Paris**. Passing that audit continues to represent
temporary risk acceptance; it is separate from this Node test-runner correction.
