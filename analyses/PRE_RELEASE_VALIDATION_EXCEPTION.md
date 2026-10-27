# Pre-release validation exception — 27 October 2026

The maintainer explicitly approved **0.7.0 for pre-release validation while publication remains
restricted to 0.8.0**. This preserves the established development → main promotion and version bump
on main. It does not approve another 0.7.0 publication or extend the risk-acceptance window.

## Contracts

| Context | Command | Approved versions under the temporary exception |
| --- | --- | --- |
| PR/branch and local development validation | npm run ci:check | 0.7.0 or 0.8.0 |
| Final release/publication | npm run release:check | 0.8.0 only |

Both commands run formatting, tests, smoke, a real production-dependency audit and package checks.
They use the same checked-in policy. The validation command explicitly selects --validation;
omitting it remains strict. CI-related environment variables do not select validation. Unknown
arguments/purposes reject. Manifest and both root lockfile version locations must agree, including
when a mixture would use two individually allowed versions.

The policy records validationVersion:0.7.0 alongside cliVersion:0.8.0. Exact Pi/Undici pins, paths,
advisories, severity checks, approval ownership and **3 November 2026 at 00:00 UTC** expiry remain
unchanged. New findings, changed metadata/resolution, audit failures and expiry still reject both
contexts. The dependency remains vulnerable and installed users' raw audit reports remain affected.

Only the CI workflow selects ci:check. Required quality job names/Node pins are unchanged. The
publication workflow retains strict release:check before npm publish and its tag/version check.
The pushed-version-tag release-note workflow is unchanged. No environment-driven bypass, dependency
override, new release branch, version bump, tag or publication was introduced.

## Automated evidence

Reused `.local-test-harnesses/form0-plan3-20261022/cli` with independent dependencies and registry
core 0.8.1. No installation or maintained dependency-tree replacement. Checks run sequentially
with FORCE_COLOR=3. Only the independent candidate's manifest/lock versions were changed to cover
both labels; they were restored to 0.7.0 afterwards. Maintained manifest/lock remain 0.7.0.

| Check | Node 22.23.4 | Node 24.22.1 |
| --- | --- | --- |
| 0.7.0 full ci:check | Pass: 219 tests and all gates | Pass: 219 tests and all gates |
| 0.7.0 strict release audit | Rejected with the expected release-version error | Rejected with the expected release-version error |
| 0.8.0 full release:check | Pass: 219 tests and all gates | Pass: 219 tests and all gates |
| 0.8.0 validation audit | Pass | Pass |

The package check still verifies 101 files. The full suite includes 23 policy/runner cases covering
the two contexts, explicit approval, invalid purposes/arguments, unapproved versions, mixed allowed
versions, unchanged vulnerability/expiry checks, Node resolution, transport failure, and the actual
workflow/script wiring. Initial policy tests fail before implementation; the final suite passes.

Reproducer: `pre-release-exception-gates.py` in the active harness. Logs under its logs/ directory:
pre-release-policy-red.log, pre-release-ci-070-node{22,24}.log,
pre-release-release-070-rejected-node{22,24}.log, pre-release-release-080-node{22,24}.log,
pre-release-validation-080-node{22,24}.log and pre-release-gates.json.

## Maintainer next steps

Push the committed development branch to update PR #81. GitHub CI should now validate its 0.7.0
working-tree label; this report records local verification, not a completed remote rerun. After
merging, bump to 0.8.0 on main and run release:check before the usual tag/release/publication steps.
The strict release gate still rejects 0.7.0. No new manual acceptance or core/binding release is
needed for this CI-policy adjustment. Earlier evidence and the separate Native/mobile exceptions
remain unchanged.
