# Proposed Pi security exception — 27 October 2026

**Status: proposed, not approved or activated.** The strict production audit and both CI/publish
workflows remain unchanged. This document does not lift the maintainer's earlier publication hold.
The maintainer requested reviewing a short-lived exception rather than preparing a fork.

## Decision proposed

Allow one planned form0-cli 0.8.0 release with the exact known Pi/Undici findings below, expiring at
**2026-11-03 00:00:00 UTC**. This is acceptance of a known dependency risk, not a vulnerability fix.
Version selection, approval, publication and the release date remain maintainer-owned. If another CLI
version is selected, the proposed release scope must be amended explicitly before activation.

A fresh production lockfile audit on 27 October reports two package entries: one high Undici entry
containing three advisories, and one inherited moderate Pi entry. Package count is not advisory count.

| Dependency                      | Exact current scope                                                              |
| ------------------------------- | -------------------------------------------------------------------------------- |
| @earendil-works/pi-coding-agent | 1.0.4 at node_modules/@earendil-works/pi-coding-agent; inherited via Undici only |
| undici                          | 8.10.2 at node_modules/@earendil-works/pi-coding-agent/node_modules/undici       |

| Advisory                                                                 | Severity | Remaining risk                                                                                                                                                                  |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) | High     | A malicious HTTP response with excessive content encodings can crash a process using the affected fetch implementation. Catching fetch rejection does not eliminate this issue. |
| [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) | Moderate | A malicious EventSource peer can exhaust process memory.                                                                                                                        |
| [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472) | Moderate | Mixed-case SRI algorithm tokens can bypass integrity checks.                                                                                                                    |

All three advisories are fixed in Undici 8.12.2; current registry Undici is 8.12.3. Current latest Pi
1.4.0 still pins 8.10.2. This proposal would ship the vulnerable dependency to installed CLI users;
a passing exception-aware CI gate would not make npm audit clean for them.

## Exposure and evidence limits

Form0's maintained AI integration imports Pi's ModelRuntime/session APIs. The installed Pi package
contains a transport which imports Undici and can install its fetch/global dispatcher. Direct
EventSource use or fetch integrity options were not found in Form0's maintained AI source. This
inspection does not prove that every advisory is reachable, or that all provider/SDK/plugin paths
are unreachable. The exception must not be justified by claiming there is no runtime exposure.

The preview server is a trusted development surface. Those existing trust assumptions and keeping
AI network endpoints trusted reduce exposure but do not patch these vulnerabilities. SAFE form
expression mode is not a mitigation for an HTTP client dependency vulnerability. No provider call,
credential access, actual database connection or exploit against an external system was performed.

## Alternatives examined

- A clean upstream Pi release is preferred once available. Check its actual dependency pin and the
  installed graph before removing the exception; upgrading to current 1.4.0 alone does not fix it.
- npm's suggested 0.75.3 downgrade permits a patched Undici range, but its published JS/types export
  ModelRegistry and do not export ModelRuntime. The current Form0 integration imports ModelRuntime.
  It is therefore a migration with its own AI compatibility work, not a drop-in security patch.
  Only its 4.60 MB archive was inspected; no dependency tree or runtime migration was installed.
- A minimally patched, separately published Pi fork/npm alias can protect downstream installations,
  but adds package ownership and maintenance. The maintainer selected exception review instead.
- Root overrides only affect the root project; installed consumers would not inherit them. An extra
  top-level patched Undici also leaves Pi's exact nested pin vulnerable. See
  [npm's override contract](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides).
- Moving Pi to optional dependencies, lowering the global severity threshold, removing the audit,
  or accepting npm audit's failure wholesale are not proposed.
- Prior shrinkwrap/bundling probes and their portability/size limits remain recorded in
  form0-core/analyses/PLAN_3_SECURITY_REVIEW.md. They are not being substituted into this release.

## Activation contract if approved

Replace only the audit script implementation with an exception-aware, fail-closed gate, used by the
existing release:check in both CI and publication. Do not remove either workflow's release checks.
The gate must run a real production npm audit and preserve visible reporting of every accepted
finding. Its policy is checked into the repository with the approval record, owner and expiry.

The gate may accept only:

1. The three exact advisory identifiers above, on the exact nested Undici path and version.
2. Pi 1.0.4's inherited finding, only while its entire via chain consists of those accepted Undici
   findings. A direct Pi advisory or another inherited cause must fail.
3. The explicitly approved CLI release version and the unexpired approval window.

It must reject audit/network/parser failures, any unrecognized advisory/package/path, changed
versions, new critical findings, expired/unapproved policy, and a broadened inherited chain. Root
manifest/lock/installed resolution must agree. A new high/moderate finding must not disappear merely
because this known high finding is accepted. No automatic renewal or expiry extension is permitted.

Automated policy cases required before activation: the current real report is accepted only when
approved; an unknown advisory, direct Pi advisory, extra nested vulnerable copy, changed version,
malformed audit, network failure, absent approval and expiry all fail. A patched clean graph must
pass the strict audit after the exception is removed. CI and the publish gate must use the same policy.

Remove the exception and restore the ordinary strict audit as soon as a verified upstream or patched
fork dependency is adopted. Before expiry, either remediate or stop further publication. Existing
installed releases remain vulnerable until their users upgrade to a fixed distribution.

## Current evidence and next approval

Active harness: .local-test-harnesses/form0-plan3-20261022.

- logs/preview-polish-audit.json: fresh production audit with all three advisory identities.
- logs/preview-polish-pi-downgrade-pack.json and final-review/pi-downgrade-probe/: npm's suggested older
  package archive and metadata; its public index/types lack ModelRuntime.
- Registry queries: Pi latest 1.4.0 → undici 8.10.2; Undici latest 8.12.3.
- Both maintained .github/workflows files still call release:check, whose production audit is strict.

**Approval requested:** accept this exact risk for form0-cli 0.8.0 until 3 November 2026 at 00:00 UTC,
then implement and test the bounded policy above. Reviewing this proposal alone is not approval to
activate it, publish the CLI or change the publication hold. Native/mobile dependency exceptions
remain entirely separate.
