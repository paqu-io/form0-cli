# CLI preview polish and submission feedback — 27 October 2026

This implements the maintainer-approved CLI-only follow-up to the
[consumer compatibility audit](../../form0-core/analyses/CONSUMER_COMPATIBILITY_AUDIT.md).
It uses published form0-core 0.8.1. No core, React or Native runtime/default changes are included.

## Selected behavior

- A fresh browser preview enables lifecycle events, classifies the record as new, starts editable,
  and keeps optional focus/blur/click subscriptions off. Explicitly saved opt-outs/classification
  preferences remain respected. Headless createApp/controller callers retain their current defaults.
- React/Native have no preview-settings UI; their host API defaults remain unchanged. Their default
  lifecycle and new/existing classification policy is a separate alignment task, as selected.
- Edit/Save row/Cancel row share Remove's dimensions, font and interaction styling. Remove remains
  destructive red, Save uses a positive tone, and other actions use the existing neutral treatment.
- Disabled row controls have a tooltip and a visible, aria-describedby-linked explanation naming
  the unopened parent. Read-only/closed editor states have their own explanations. Permission checks
  stay server-owned and unchanged.
- Submit stays primary. Prepare draft/Cancel record/Close record are in collapsed Advanced preview
  actions. Draft inspection remains non-persisting and logs an expandable object. Reopen remains
  accessible after the session closes.
- Form Settings uses the existing settings group/checkbox styling. Record preview contains
  classification and read-only opening; Advanced event settings contains lifecycle and optional
  interaction subscriptions. Classification changes hooks; it does not load a database record.
- Submit restores emoji stage messages, logs the exact selected payload as an expandable object,
  reports connector successes and individual failures, and reports validation/HTTP/persistence
  failures without pretending the record was saved. No connectors means explicitly preview-only.
- The coordinated preparation, all-or-none review, save-hook-once flow, final serialization and
  persistence acknowledgements retain their contracts. No legacy submission path was reactivated.

The original console regression occurred when managed submission replaced the normal button path:
legacy logs remained in source, while the new path stringified the record and omitted connector
outcome reporting. The prior audit checked payload/persistence behavior rather than that console
presentation. New browser assertions lock down the reported symptom and exact logged/sent payload.

## Fresh verification

All heavy gates ran sequentially in reused independent dependency trees. No dependency tree was
installed or replaced, no user environment/credential files were read, and no actual database or
external AI provider was contacted. The CLI's independent core copy comes from the public 0.8.1
archive. Maintained dependency/funding edits are preserved.

| Gate                           | Result                                                                                                                                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI check                      | Formatting, all 192 Node tests and smoke pass. Four new preference/localization tests cover browser defaults, explicit opt-out, malformed preferences, four-locale key/parameter parity and unchanged headless defaults.                                                                      |
| New Chromium gate              | Ten cases in TRUSTED and ten in SAFE pass: fresh default, saved opt-out, existing/read-only initialization, non-persisting draft, styled/scoped controls, exact expandable logged/sent snapshot and save hook once, connector success/partial failure, validation rejection and HTTP failure. |
| Existing Chromium controls     | All 24 scenarios in each security mode pass, including immediate signature feedback, queued operations, choice/Other edits, row isolation and container visibility.                                                                                                                           |
| Catalog Chromium gate          | Both catalog interaction cases in each mode pass, retaining builtin/media/record-shape coverage.                                                                                                                                                                                              |
| Persistence and schema watcher | Existing actual browser drivers pass again with separately named evidence files.                                                                                                                                                                                                              |
| Packaging                      | Package-content check passes; final archive runtime bytes match the tested independent candidate and maintained source.                                                                                                                                                                       |
| Documentation                  | EN/ES/FR/IT preview guidance updated. Source formatting, i18n, navigation, page parity, all 23 tests and lint pass. No local docs production build.                                                                                                                                           |

The first seven browser checks failed against the previous UI/feedback/defaults before corrections.
Actual screenshot review confirms the settings group, neutral/danger row actions, nested hint and
collapsed advanced actions. This is browser acceptance; no new physical device run was needed.
No calculation/event executor, scope model, form schema or saved record shape changed.

## Security and release boundary

The production lock audit remains failing: one high Undici package entry with three advisories and
one inherited moderate Pi entry. Upstream latest Pi still pins Undici 8.10.2. The reviewed downgrade
lacks ModelRuntime, so it is not a compatible patch. Body-parser's prior fix remains intact.

The maintainer selected reviewing a short-lived exception. The
[exception proposal](PI_SECURITY_EXCEPTION_PROPOSAL.md) is **not approved or active**. It proposes
one CLI 0.8.0 release, exact dependency/advisory scope and expiry at 2026-11-03 00:00 UTC. CI/publish
continue using the strict production audit; the publication hold has not been lifted. No override,
optional-dependency move, downgrade, fork, bundling, audit bypass or new exception was applied.
Full functional/package gates passing does not mean all release gates pass.

Suggested CLI bump after the release decision: 0.8.0, because this delivery adds public controller
capabilities and changes the browser preview's fresh lifecycle default. Version bumps, dependency
publication, pushes, promotion merges and deployment remain maintainer-owned. Core 0.8.1 is already
published; this UI follow-up requires no further core bump. Public documentation deployment/rendered
validation remains CI/maintainer-owned.

## Reproduction and evidence

Normal gates: npm run check and npm run package:check. The opt-in browser gate is
scripts/verify-preview-polish.mjs, using caller-supplied FORM0_PLAYWRIGHT_MODULE and
FORM0_CHROMIUM_EXECUTABLE. FORM0_PREVIEW_SAFE=1 selects SAFE. It installs nothing and creates only a
temporary empty project. FORM0_SCREENSHOT_DIR optionally records the browser/setting screenshots.

Active harness: .local-test-harnesses/form0-plan3-20261022.

- preview-polish-gates.py and preview-polish-docs-gates.py orchestrate checks.
- logs/preview-polish-red.log: original seven failing interaction/default/console scenarios.
- logs/preview-polish-polish-{trusted,safe}.log: final ten cases, including logged/sent payload equality.
- logs/preview-polish-controls-{trusted,safe}.log and preview-polish-consumer-compatibility-{trusted,safe}.log.
- logs/preview-polish-cli-check.log: final 192 tests, formatting and smoke.
- logs/preview-polish-{persistence,watcher,package}.log and preview-polish-gates.json.
- logs/preview-polish-docs-\*.log and preview-polish-docs-gates.json.
- final-review/preview-polish/: published core tarball, current CLI candidate and preview/settings screenshots.
- logs/preview-polish-audit.json and PI_SECURITY_EXCEPTION_PROPOSAL.md retain the unresolved security boundary.

No existing release evidence or user server was overwritten. Pi's older 4.60 MB archive was inspected
without unpacking/installing its dependency tree. New test sources, logs, screenshots and small
archives do not require another large harness/dependency allocation. No cleanup/deletion of active
harness trees was performed.
