# Pi security exception for CLI 0.8.2 — review and approval, 27 October 2026

**Status: explicitly approved by aragornii on 27 October 2026 and activated.** The maintainer
approved the reviewed eight-advisory scope for publication **0.8.2 only**, with **0.8.1** permitted
for pre-release validation only, and the unchanged expiry **2026-11-03T00:00:00Z**. The earlier
publication **0.8.0** / validation **0.7.0** approval remains historical; it did not itself authorize
the five additional findings. [Current policy](../scripts/security-exceptions.json),
[activation and verification](PI_SECURITY_EXCEPTION_ACTIVATION.md#approved-082-amendment--27-october-2026).

The approved exception deliberately permits distributing vulnerable Undici 8.10.2. It accepts
eight identified advisories, including conditional confidentiality/integrity failures and
process-wide denial of service. A passing exception-aware gate does not patch the dependency or
make installed users' raw npm audits clean. Prefer a verified fixed upstream Pi distribution or a
separately reviewed patched distribution when available.

## Primary-source advisory matrix

The following are the Undici maintainers' own security advisories, inspected on 27 October 2026.
All eight list **`>=8.0.0, <8.12.2`** as affected and **8.12.2** as the patched 8.x release.
Therefore the locked **8.10.2** falls within every affected range. The matrix intentionally shows
the 8.x ranges relevant to this dependency graph; other supported branches have separate fixes.
"Added" means newly observed in the subsequent audit, not newly published today: the linked
upstream advisories were published on 15 October 2026.

| Scope    | Advisory and primary source                                                                     | Severity / CVSS v3.1 | Affected 8.x / fixed         | Concrete prerequisite and consequence                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------- | -------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original | [GHSA-4qv8-2p9j-2685](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685) | Moderate / 5.9       | `>=8.0.0 <8.12.2` / `8.12.2` | Undici `EventSource` connects to a malicious or compromised SSE peer. Many tiny `data:` fields without an event separator, or an unfinished line split across many chunks, accumulate parser state until memory exhaustion. Byte limits do not adequately bound retained parser state; compressed responses increase the imbalance. This is availability impact. Ordinary manually parsed fetch streaming is not itself evidence of `EventSource` use.                |
| Original | [GHSA-f72v-6w45-q472](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472) | Moderate / 5.9       | `>=8.0.0 <8.12.2` / `8.12.2` | `fetch` receives valid uppercase/mixed-case SRI algorithm metadata. If no recognized lowercase algorithm remains, the intended digest check is skipped and an attacker-controlled response can be accepted. The attacker controls the body; they need not change the application's integrity metadata. Lowercase `sha256`/`sha384`/`sha512` tokens are the documented workaround.                                                                                     |
| Original | [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) | High / 7.5           | `>=8.0.0 <8.12.2` / `8.12.2` | A malicious HTTP peer returns more than five content codings and closes before its declared body is sent. An orphaned internal response stream emits an unhandled error and terminates the process. One response suffices; catching the `fetch` rejection does not contain it. No workaround is listed.                                                                                                                                                               |
| Added    | [GHSA-4w7w-5xrc-9h26](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26) | High / 7.4           | `>=8.0.0 <8.12.2` / `8.12.2` | Requires an originless `Agent`, shared `MemoryCacheStore` or `SqliteCacheStore`, and `compose(redirect(), cache())`. Cross-origin redirect responses can be cached under the initial trusted URL: attacker content can persist, or a user's private response can reach another caller despite a private/no-store redirect hop. Origin-bound `Client`/`Pool` and reverse composition `compose(cache(), redirect())` are outside the advisory's affected configuration. |
| Added    | [GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx) | High / 7.4           | `>=8.0.0 <8.12.2` / `8.12.2` | `Agent` JSON-clones options and loses a function-valued `tls.checkServerIdentity`, such as certificate/public-key pinning. A peer passing Node's default hostname and chain checks may be accepted despite the custom verifier's intended rejection. `EnvHttpProxyAgent` direct/`NO_PROXY` routes can inherit this. Equivalent callbacks passed through `connect` are unaffected.                                                                                     |
| Added    | [GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm) | High / 7.5           | `>=8.0.0 <8.12.2` / `8.12.2` | A malicious/compromised HTTPS endpoint establishes TLS 1.2, then renegotiates with a different CA-trusted certificate that fails hostname verification. An unexpected socket error becomes an uncaught assertion and crashes the process, including other in-flight work. HTTP/1.1 and HTTP/2 paths are affected. No CA compromise is needed; TLS 1.3 has no renegotiation.                                                                                           |
| Added    | [GHSA-9fm3-97px-rjf6](https://github.com/nodejs/undici/security/advisories/GHSA-9fm3-97px-rjf6) | Moderate / 5.9       | `>=8.0.0 <8.12.2` / `8.12.2` | Requires an affected Undici WebSocket client connected to a malicious/compromised WebSocket peer. Repeated small PINGs cause automatic PONG writes while the peer refuses to read them; ignored backpressure lets the outbound queue grow until memory exhaustion. This is availability impact, not a generic finding against every WebSocket implementation. No workaround is listed.                                                                                |
| Added    | [GHSA-55wc-3pg8-jfw6](https://github.com/nodejs/undici/security/advisories/GHSA-55wc-3pg8-jfw6) | Moderate / 5.9       | `>=8.0.0 <8.12.2` / `8.12.2` | Requires the `decompress` interceptor with a downstream response handler that throws, such as `dump` when decompressed bytes exceed `maxSize`. A small compressed response can trigger a throw from an asynchronous zlib callback outside request-level protection and crash the process. A global uncaught-exception handler instead leaves the request hanging until its body timeout. Avoiding that interceptor/handler composition is the documented workaround.  |

These are **four high and four moderate advisories**, not eight vulnerable package instances.
The reported graph has one high Undici entry and an inherited moderate Pi entry; inherited Pi
severity does not reduce the severity or consequences of its Undici dependency.
[Recorded audit diagnosis](CLI_081_RELEASE_FAILURES.md).

## Residual risk and interpretation

The TLS callback advisory does **not** establish that ordinary TLS validation is disabled. It
bypasses an application's additional function-valued verification in the specific `tls` option
path; Node's normal certificate-chain and hostname checks still apply. Conversely, normal TLS
validation is not a mitigation for the TLS 1.2 renegotiation crash: the expected hostname rejection
is what reaches the faulty assertion. Upstream documents `connect` for the callback workaround
and TLS 1.3-only connections for the renegotiation workaround, where endpoints support them.
Neither workaround has been introduced by this review.
[Custom-verifier advisory](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx),
[renegotiation advisory](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm).

The strongest generally relevant residual issue remains a process crash from an affected HTTP
client reaching a malicious or compromised response source. The new TLS 1.2 issue adds another
such path. Trusted provider selection reduces exposure but cannot establish that endpoints,
redirect targets, proxies, custom providers and extensions will always remain trustworthy.
This is a risk assessment, not an exploit demonstration.
[Fetch crash](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c),
[TLS crash](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm).

The cache issue can affect confidentiality/integrity only when its exact shared-cache composition
exists. The decompression issue needs its interceptor and throwing-handler combination. The
EventSource and WebSocket findings require their respective Undici APIs; an SSE stream or a
separate `ws` server is not sufficient evidence by name alone. Absence of these calls in Form0
source narrows the observed surface but does not establish absence in every SDK, plugin or custom
provider. Those distinctions should be preserved in the local reachability assessment rather
than declaring all eight exploitable or all eight unreachable.

## Observed Form0 exposure

The inspected checkout is CLI 0.8.1 with Pi coding-agent 1.0.4 and its nested Undici 8.10.2.
The current production audit still reports exactly the eight identities above, on the same two
package entries. Registry metadata again reports Pi 1.4.0 pinning Undici 8.10.2 and latest Undici
8.12.3. No package upgrade was performed.
[Pi metadata](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest),
[Undici metadata](https://registry.npmjs.org/undici/latest).

The interactive shell imports AIManager while initializing its managers, before the user enters
AI mode. AIManager imports Form0PiSession, which imports Pi's SDK. This review does not claim that
every one-shot CLI command loads Pi. The existing `FORM0_AI_DISABLED` check prevents entering AI
and creating a session, but occurs after that interactive import. It is not transport isolation.
[Shell initialization](../src/commands/interactive/shell-core.js),
[AI entry](../src/commands/interactive/managers/ai-manager.js),
[Pi session](../src/ai/pi-session.js).

Pi's installed `dist/core/http-dispatcher.js` imports Undici. Although Form0 does not call Pi's
`configureHttpDispatcher()` or standalone `main()`, the imported Undici's `lib/global.js` can initialize
`undici.globalDispatcher.2` and write a `Dispatcher1Wrapper` into the legacy
`undici.globalDispatcher.1` slot. Existing dispatcher state and initialization order matter. Therefore
an unchanged `globalThis.fetch` function is not proof that Node fetch avoids the vulnerable transport.

An isolated import-only probe confirmed this on both supported pinned Node lines:

| Probe                                                                           | Node 22.23.4 | Node 24.22.1                                             |
| ------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------- |
| Node's bundled Undici                                                           | 6.29.1       | 7.30.1                                                   |
| Global fetch property descriptor replaced                                       | No           | No                                                       |
| Both global dispatcher slots installed/changed                                  | Yes          | Yes                                                      |
| Original Node fetch reached the injected legacy-dispatcher test double          | Once         | Once                                                     |
| Selected dispatcher proven to be the nested Undici 8.10.2 Agent/wrapper         | Yes          | Not established: selected Agent was not the nested class |
| Global WebSocket/EventSource constructors replaced                              | No           | No                                                       |
| Network connections, credential reads, filesystem mutations or sessions created | None         | None                                                     |

The synthetic HTTPS request was intercepted by a test double before any connection. Filesystem
guards blocked protected-file reads/writes if attempted, and network connection functions were
blocked; all attempt counters remained zero. The Node 22 probe confirmed constructor identity against
the exact nested Undici Agent/wrapper. On Node 24 the selected Agent did not match that class, so
the general dispatch observation does not prove selection of the vulnerable copy there. These are
dispatch-route observations, not exploits. Node 22 establishes a runtime path beyond a dormant
lockfile entry; do not generalize the same transport selection to every runtime or initialization order.

Concrete consequence on the observed Node 22 path: an interactive session can route an ordinary fetch
through the vulnerable npm transport even without an AI prompt. Form0's Reform client uses global fetch. A compromised
HTTPS peer could therefore matter beyond the selected AI provider. This example combines the
observed dispatch route with static call sites; no actual Reform API request was made.
[Reform request path](../src/utils/reform-client.js).

Conversely, transport routing alone does not prove that vulnerable npm fetch parsing, EventSource
or WebSocket code runs. The Node web-API functions/constructors above stayed unchanged. The
review did not find custom `tls.checkServerIdentity`, Undici shared-cache/redirect composition,
Undici EventSource, SRI `integrity` options or the throwing decompression composition in maintained
Form0 source. The docs client's `Map` cache and `redirect: 'manual'` are not the Undici shared-cache
composition in the advisory. Pi's Codex provider can use a global WebSocket, so broader provider
and host behavior still requires care. No user provider configuration or credentials were read.
[Docs client](../src/ai/docs-client.js), [Pi session](../src/ai/pi-session.js).

The practical remaining concern is process-level availability when affected transport code reaches
a malicious or compromised HTTP/TLS peer. The TLS 1.2 client crash has a plausible transport path;
the probe did not demonstrate it. Other findings retain their specific API/configuration
prerequisites. Catching a request promise, limiting documentation body size, disabling built-in
agent tools or selecting SAFE form expressions does not establish containment of transport-level
process failures. Do not describe all eight as either proven exploitable or proven unreachable.

## Exact approved amendment

The maintainer's separate, explicit approval authorizes activation of this amendment. It replaces
the earlier version/advisory scope while preserving its dependency boundaries and expiry.
Bumps, tags, merges and publication remain maintainer-owned.

| Boundary                                | Approved value                                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication version                     | `form0-cli` **0.8.2 only**                                                                                                                                                                                |
| Additional pre-release validation label | **0.8.1 only**, through the existing explicit validation purpose; 0.8.2 remains valid under its release scope                                                                                             |
| Maintainer approval                     | **Explicitly approved by aragornii on 27 October 2026**, including predominantly local developer/testing use as exposure context                                                                          |
| Expiry                                  | **2026-11-03T00:00:00Z** (**3 November, 01:00 Europe/Paris**), unchanged; no automatic renewal or extension                                                                                               |
| Direct Pi dependency                    | `@earendil-works/pi-coding-agent` **1.0.4**, exactly `node_modules/@earendil-works/pi-coding-agent`, direct, inherited through `undici` only, maximum package severity **moderate**                       |
| Nested vulnerable dependency            | `undici` **8.10.2**, exactly `node_modules/@earendil-works/pi-coding-agent/node_modules/undici`, indirect, parent Pi above, maximum package severity **high**                                             |
| Exact advisory allowance                | **Only the eight GHSA identities in the matrix**, at their listed severities; original three plus five explicitly reviewed additions                                                                      |
| Required verification                   | Root manifest and both root lockfile versions agree; locked/installed dependency versions, exact parent pin, paths and Node resolution agree; real production audit and visible findings remain mandatory |
| Other controls                          | Existing global audit threshold, CI/publication checks, seven-day policy limit and failure handling remain in place; no generic severity or inherited-chain allowance                                     |

Activation updates the approval record, public disclosure and focused policy tests together.
A version-only amendment cannot accept the five added identities. Previously recorded approvals
and successful test logs retain their historical scope; current verification is recorded in the
activation document.
[Policy](../scripts/security-exceptions.json), [gate](../scripts/audit-policy.mjs),
[prior diagnosis](CLI_081_RELEASE_FAILURES.md).

## Recommendation and approval boundary

The current gate enforces the exact expanded scope without weakening its general audit rules.
The maintainer accepted the residual risk as a short bridge ending at the original expiry;
remediation remains the exit requirement. It still
ships a vulnerable transport that can participate in ordinary interactive HTTP requests. This is
not an assessment that the dependency is harmless or isolated to unused functionality.

The maintainer explicitly approved **all eight advisories**, publication **0.8.2**, validation
**0.8.1**, the exact existing dependency paths/pins and the unchanged expiry. The additional
context is that form0-cli will mainly run locally while developers test. This reduces exposure
compared with an unattended public service; local data/work, outbound responses, redirects,
proxies and compromised/custom endpoints remain relevant. The approval does not claim transport
isolation or treat the intended usage as a patch.

Policy, disclosure and regression cases are updated together and real CI/release checks use an
independent tree. Bumps, merge, tag and publication remain maintainer-owned. The existing v0.8.1
tag must not be moved by this activation.

## Exit and stop conditions

- **Remove the exception on remediation:** verify a consumer-installable upstream or patched Pi
  distribution actually resolves a non-vulnerable Undici version, run compatibility and ordinary
  strict release checks, then retire the allowance. Merely changing the top-level Undici, changing
  the Node executable, or assuming a later Pi version contains the fix is insufficient evidence.
- **Stop at expiry:** at or after **3 November 2026, 00:00 UTC**, reject the exception; remediate
  before further publication. Previously installed vulnerable releases remain vulnerable until
  users upgrade to a fixed distribution.
- **Stop on scope changes:** any additional advisory/package/copy/path, changed dependency pin,
  direct Pi advisory, different inherited cause, higher/different advisory severity, critical
  escalation, mismatched metadata/resolution, absent approval or audit/network/parser failure
  requires rejection under the existing gate.
- **Stop outside the chosen version purpose:** no publication of 0.8.1, 0.8.3 or another label is
  authorized by this amendment. Do not reinterpret validation permission as publication approval.
  Existing release tags are outside this change.
- **Reassess when exposure changes:** adoption of custom TLS verification, shared redirect caching,
  Undici EventSource/WebSocket, throwing decompression handlers or broader provider/extension
  access should trigger a new reachability/risk review rather than relying on the present surface.

These are the approved acceptance conditions and existing gate constraints.
[Current gate](../scripts/audit-policy.mjs).

## Original review evidence and limits — before activation

- This review inspected upstream owner advisories and the repository's manifest, lockfile,
  exception policy, policy implementation and prior release diagnosis. It produced this Markdown
  review only; no executable policy, dependency, version or release metadata changed.
- Local `package.json` and lockfile identify CLI **0.8.1**, `form0-core` **^0.8.1** and Pi **1.0.4**;
  Pi's lockfile entry pins nested Undici **8.10.2**. Those are dependency facts, not proof that
  every listed API is invoked. [Manifest](../package.json), [lockfile](../package-lock.json).
- The preceding live registry/audit diagnosis reported latest Pi **1.4.0** still pinning **8.10.2**,
  latest Undici **8.12.3**, and all eight advisories. Those registry values are a time-specific
  snapshot, not an ongoing guarantee; verify the actual graph again before selecting remediation.
  [Diagnostic evidence](CLI_081_RELEASE_FAILURES.md#reproducible-evidence).
- Fresh production report: active harness `logs/cli082-review-current-audit.json`. Policy simulation
  `cli082-review-policy.mjs` uses the real gate with cloned, hypothetical policy/graph inputs;
  **34 cases pass**, including every advisory removed individually, unexpected findings/copies,
  changed pins/severity, revoked approval, version-purpose restrictions and expiry. It never writes
  the hypothetical policy into the repository. The result explicitly records approval as absent.
- The existing audit-policy/runner suites also pass **23 tests** and retain their active, historical
  approval scope. Those passes do not approve or activate the expanded policy.
- Import-only probe: active harness `cli082-import-exposure.mjs`; results in
  `logs/cli082-import-exposure-node22.json` and `logs/cli082-import-exposure-node24.json`.
  Source inspected in the installed Pi and nested Undici packages; SHA-256 of Pi's dispatcher file
  is `f9aa2c81b0a5958ffba6368506f24c9b202904c234ada19494cdc9c4a1d0e97b`, and Undici's global file is
  `ad78c73866021cae34d47f7896561c56294e5c1f15915d6ef1780f763a816b9d`.
- Before activation the policy SHA-256 was
  `029aa2bea384f50a1a3e0a688fbfb1b78b0800e071212eb096d045846073cd67`.
- No dependency installation, provider call, credential access, exploit, browser/device test,
  release check, publication, tag change or executable-policy change was performed for this review.
  Static inspection and the synthetic route probe cannot prove end-to-end exploitability or complete
  unreachability across user-supplied extensions and provider SDK behavior.
