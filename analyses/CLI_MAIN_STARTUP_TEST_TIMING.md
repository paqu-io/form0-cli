# Main startup-order test timing — 28 October 2026

[Run 40600717784, Node 22 job 122527848690](https://github.com/paqu-io/form0-cli/actions/runs/40600717784/job/122527848690)
checks merge commit `c33104ee3b9c8ac1e6c8ed4fe44abbe5adfd3b55`, which includes the PR 85
reporter correction. That reporter regression passes in this run. Node 24 passes its complete job.
Node 22 reports **225 passes and one failure**, in `tests/serve-app-order.test.js`, before audit.

The failing case expects the app to be listening before the interactive dev server starts. Its
callback performs a second `waitForPort(appPort, { timeoutMs: 1 })` and records `false`, despite
the manager already completing its normal readiness wait and providing the expected app URL.

## Reproduction and correction

`waitForPort` calculates a deadline, then checks the clock before attempting a connection. If even
one millisecond elapses between those operations, this extra observation can expire without a
connection attempt. CI scheduling can cause that in either branch; PR and main use the same gates.
There is no Node deserialization failure or security-policy rejection in this job.

Two focused diagnostic controls reproduce the distinction:

- A real listening server passes a normal connection probe, but the same helper with a 1 ms
  deadline returns false when a controlled 2 ms clock advance occurs before its first check.
- Applying that clock advance only inside the original test's observation reproduces the exact
  failed order-array assertion: `app listening: false` with the correct app banner URL.

The test now reads the fixture server's `app.listening` state directly when the dev server would
start. This observes the same startup contract without another timing-dependent network probe.
The real `ServerManager` startup wait still runs. Runtime code, its timeout behavior, all other
assertions, dependencies and the security policy are unchanged.

The corrected test passes with the same controlled clock advance. As a negative control, bypassing
the real manager wait in the independent harness makes the corrected test fail: it still detects
the dev server starting too early. All instrumented fixture/runtime files are restored afterward;
no diagnostic clock manipulation or bypass is included in the maintained test.

## Verification

Reused `.local-test-harnesses/form0-plan3-20261022/cli`; no dependency install or new tree.

- `cli-main-readiness-probe.mjs`, `logs/cli-main-readiness-red.log`: real listener versus 1 ms probe.
- `cli-main-startup-controls.py before/after/bypass-wait`: original observation fails, corrected
  observation passes, deliberately broken startup order still fails. Logs:
  `logs/cli-main-startup-{before,after,bypass-wait}.log`.
- Ten consecutive targeted Node 22 runs pass: `logs/cli-main-startup-repeat-{01..10}.log`.
- Full `ci:check` on Node **22.23.4 and 24.22.1**: **226 passing tests**, formatting, smoke,
  live production audit under the existing exception, and **101-file** package checks.
  Logs: `logs/cli-main-startup-ci-v{22.23.4,24.22.1}.log`.
- Independent **0.8.2** candidate passes full `release:check`; strict release audit at **0.8.1**
  still rejects. Logs: `logs/cli-main-startup-release-candidate.log` and
  `logs/cli-main-startup-release-081-rejected.log`.
- Driver/summary: `cli-main-startup-checks.py`, `logs/cli-main-startup-checks.json`.
  The independent candidate's manifest/lockfile are restored byte-for-byte.

## Branch and release boundary

The checkout initially had clean main at local `431b8fd` (version/tag **0.8.2**), one commit ahead
of origin/main. The existing development branch was selected for this correction. The main version
commit and local tag are preserved. At inspection, the remote has no v0.8.2 tag or GitHub release.

Push the development correction and promote through the normal development → main PR. The
maintainer owns updating the unpublished release/tag to include the final corrected main commit.
No push, remote rerun, merge, version/tag mutation or publication is performed by this work.
Security approval remains validation **0.8.1** / publication **0.8.2**, expiring
**3 November 2026, 00:00 UTC / 01:00 Europe/Paris**; no expansion is required for this test fix.
