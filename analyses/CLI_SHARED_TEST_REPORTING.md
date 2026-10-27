# Shared test console reporting — 28 October 2026

[Main run 40602824677, Node 22 job 122534934516](https://github.com/paqu-io/form0-cli/actions/runs/40602824677/job/122534934516)
checked `753cf82220ab602a61c9bd4847f10ee3610a405e`. The preview reporting regression and corrected
startup-order case pass. The runner instead loses `tests/consumer-compatibility.test.js` after
Unicode registration/removal logs, with `Unable to deserialize cloned data due to invalid or
unsupported version.` Node 24 passes; Node 22 ends at 225 passes and one file-level failure before
the audit step.

## Why the failures kept appearing

The [known Node 22 stdout/report framing bug](https://github.com/nodejs/node/issues/65934) affects
every test file that writes raw Unicode console output. The original preview-only workaround was
too narrow: it protected that file while other suites retained the same exposure. Passing a few
local runs did not prove that the rest of the suite's output was safe. The main and PR workflows
use the same checks; process scheduling changes whether the runner encounters the framing defect.

The [one-millisecond startup observation](CLI_MAIN_STARTUP_TEST_TIMING.md) was a separate timing
flaw in a test and has already been corrected. Neither failure called for changing form logic or
expanding the security exception.

On 28 October, the [official release index](https://nodejs.org/dist/index.json) still lists
22.23.4 as the newest 22.x patch. The [22.x runner source](https://raw.githubusercontent.com/nodejs/node/v22.x/lib/internal/test_runner/runner.js)
still lacks the unsigned-size conversion documented in the upstream report. No verified fixed
Node 22 patch was available to select; the security-patched runtime pins are retained.

## Shared correction

`npm test` now preloads `tests/fixtures/console-setup.js` in every isolated test process. The setup
uses Node's public `Console` constructor with stderr for both console streams. Console messages
remain visible through `test:stderr` events without entering the raw stdout stream that carries
Node's binary reports. This covers module-import logs, test-body logs and process-exit logs, and
methods such as log/info/debug, dir/table, grouping, counters and timers.

The preview-only console mock is removed. Nested color/reporting runners read their arguments from
the package's test command, so they receive the same setup automatically. Test discovery, process
isolation, assertions and failure exit codes stay in place. There is no retry-on-failure, skipped
suite, Node-internal patch, stdout interception or Unicode filtering.

The bootstrap is test-only and excluded from the package's published files. Normal CLI subprocesses
still use their original console and output streams. Existing command-output, banner, diagnostics
and plain/standard/true-color checks exercise that behavior. Runtime source, core, dependencies,
lockfile and security policy are unchanged. The manifest changes only its test command; its version
remains 0.8.1 on development and the selected publication remains 0.8.2.

Run focused cases through `npm test -- tests/consumer-compatibility.test.js`. Tests that exercise
raw command output should capture the subprocess streams rather than forwarding them into the
test worker's stdout. [Contributor instructions](../CONTRIBUTING.md#making-a-change).

## Verification

The existing independent CLI tree was reused; no dependency install or additional dependency tree.

- Before the fix, the new reporting guards fail because console messages are still on raw stdout:
  `logs/cli-shared-console-red.log`.
- The guards run the real **23 preview-event** and **6 catalog** cases plus an independent console
  fixture. All 30 cases must pass, every console message must leave raw stdout, and Unicode logs
  must remain present. A deliberately failed fixture must still return exit 1 with its assertion
  message. The focused pair passes ten consecutive Node 22 runs.
- A separate audit collects **every event from the complete Node 22 suite**: **227 cases pass**,
  **zero raw stdout messages**, **227 diagnostic stderr messages**, including **109 with Unicode**.
  Report size is **35,020 bytes**. This checks suite-wide output coverage, rather than treating
  repeated successful timing as proof that other files are protected.
  Driver: `cli-shared-console-transport.py`; evidence: `logs/cli-shared-console-full-report.json`
  and `logs/cli-shared-console-transport.json`.
- Full `ci:check` on pinned Node **22.23.4 and 24.22.1**: **227 tests**, formatting, smoke,
  existing exception-aware live production audit, and **101-file** package checks pass.
  Logs: `logs/cli-shared-console-ci-v{22.23.4,24.22.1}.log`.
- Full independent **0.8.2** candidate `release:check` passes. A strict release audit at **0.8.1**
  still rejects; temporary risk approval is unchanged. Independent manifest/lockfile versions are
  restored byte-for-byte after candidate verification.
  Logs: `logs/cli-shared-console-release-candidate.log` and
  `logs/cli-shared-console-release-081-rejected.log`.
- Driver/summary: `cli-shared-console-checks.py` and `logs/cli-shared-console-checks.json`, under
  `.local-test-harnesses/form0-plan3-20261022`. Earlier per-file proofs retain their provenance.

## Promotion boundary

The correction is committed on the existing development branch. The original checkout was clean
main at `753cf82`; restore it after committing. Preserve its 0.8.2 version and local release tag.
The maintainer pushes/promotes development → main, waits for fresh CI, then updates the unpublished
local tag to the final tested main commit before publication. This work performs no remote rerun,
push, merge, tag/version change or publication.

The security exception still covers only its exact approved advisories, validation 0.8.1 and
publication 0.8.2, through **3 November 2026, 00:00 UTC / 01:00 Europe/Paris**. The tests' diagnostic
stream correction is separate from that accepted dependency risk.
