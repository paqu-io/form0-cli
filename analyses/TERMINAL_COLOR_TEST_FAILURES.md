# Terminal-color release-check failures — 27 October 2026

The maintainer's release check passed 204/208 tests. Four text assertions failed in AI authoring,
calculation reporting, standalone diagnostics and server banners. The check stopped before smoke,
audit and package verification; those failures were not caused by the security exception.

## Reproduction and cause

In the existing independent CLI tree, selecting the four named cases with FORCE_COLOR=3 reproduced
all four failures in about two seconds. The same cases with FORCE_COLOR unset and NO_COLOR=1 all
passed. A new regression matrix was then run before the fix: plain output passed; standard-color
and true-color output failed.

ANSI styling surrounded otherwise correct visible messages. Exact array membership and multiline
regexes compared the escape codes as text. The banner helper trimmed before stripping styling,
leaving a leading blank line and reporting four lines rather than three.

The tests now use Node's stripVTControlCharacters when capturing human-readable output. Diagnostic
stdout stays raw so payload/stream assertions remain intact. No src/bin code, dependencies, core,
security policy, schema, record format or public behavior changes. Terminal colors remain enabled
for users. The added matrix runs the four actual affected tests at FORCE_COLOR levels 0, 1 and 3,
and verifies that all four cases ran rather than accepting an empty/filtered suite.

## Verification

Reused `.local-test-harnesses/form0-plan3-20261022/cli` without installing dependencies. Only that
independent candidate is versioned 0.8.0; the maintained manifest remains 0.7.0.

- Node 24.22.1 and Node 22.23.4 both pass full release:check with FORCE_COLOR=3: **212 tests**, format,
  smoke, exception-aware production audit and package contents (101 files).
- The new plain/standard/true-color matrix passes; before/after logs preserve the regression proof.
- Logs under `form0-plan3-20261022/logs/`: terminal-color-repro-{red,plain}.log,
  terminal-color-matrix-{red,green}.log, terminal-color-release-node{22,24}.log,
  terminal-color-gates.json.

No new manual check, browser/device run, core release or dependency installation is needed for this
test-only correction. Before the maintainer's final release check, bump the CLI manifest/lockfile to
0.8.0: the approved exception intentionally rejects 0.7.0 and expires 3 November at 00:00 UTC.
No bump, push, tag, merge, publication or issue closure was performed.
