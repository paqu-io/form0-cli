# CodeQL fixture-literal encoding — 27 October 2026

PR #81 has three medium-severity CodeQL findings, all js/bad-code-sanitization in
tests/fixtures/consumer-compatibility.js at the generated event-handler construction:
[28](https://github.com/paqu-io/form0-cli/security/code-scanning/28),
[29](https://github.com/paqu-io/form0-cli/security/code-scanning/29),
[30](https://github.com/paqu-io/form0-cli/security/code-scanning/30).
The inspected head was 3ea4710; the findings are classified as test code. These findings are separate
from the approved Pi/Undici dependency exception and do not receive a new exception or dismissal.

## Cause and correction

The fixture generator used JSON.stringify directly when inserting field names and values into
JavaScript source. JSON quoting preserves literal HTML script delimiters. A minimal reproducer with
text containing </script> confirms that the generated source retained that delimiter. The new source
encoding regression fails before the fix while its exact-value TRUSTED/SAFE controls already pass.

The generator now routes literal data through a private scriptLiteral helper: JSON serialization
followed by Unicode escaping of <, >, &, U+2028 and U+2029. Quotes, backslashes and control characters
retain their JSON encoding. Root undefined keeps the previous generated undefined-literal behavior.
The same helper handles builtin result-property names. Authored builtin expressions remain code.

This follows [CodeQL's recommendation](https://codeql.github.com/codeql-query-help/javascript/js-bad-code-sanitization/)
to escape potentially dangerous characters after JSON serialization when constructing JavaScript.
No analysis suppression, query exclusion, scanner severity change or alert-state edit was made.

Only the test fixture and its new tests change. The helper has test/script callers and tests are
excluded from the npm archive. No src/bin, core, binding, dependency, version or security-policy
changes. The current package check confirms the same 101 published files. The synthetic inline-HTML
check exercises the flagged encoding boundary; it is not evidence of a live production exploit.

## Verification

Reused the existing independent CLI tree in .local-test-harnesses/form0-plan3-20261022, registry core
0.8.1 and retained Chromium/Playwright. No installation, new dependency tree or local CodeQL bundle.
Checks run sequentially; maintained manifest/lock stay 0.7.0.

- Focused tests: 9 pass, including all six existing catalog cases and three encoding regressions.
  The new tests verify raw delimiter removal, exact decoded strings/nested metadata and caller
  immutability through actual core event execution in TRUSTED and SAFE.
- Full ci:check on Node 22.23.4 and 24.22.1 with FORCE_COLOR=3: **222 tests** each, formatting,
  smoke, unchanged exception-aware production audit and package contents pass.
- Existing real browser catalog audits pass in TRUSTED and SAFE, including choices/Other, media,
  signature, zero, row IDs and lifecycle/custom-validation behavior.
- A Chromium inline-script stress check confirms no injected marker executes, no page error occurs,
  and special-character text/media metadata round-trip exactly.

Evidence under that harness: logs/codeql-fixture-red.log, codeql-encoding-tests-{red,green}.log,
codeql-fixture-browser.{log,json}, codeql-encoding-ci-node{22,24}.log,
codeql-encoding-browser-{trusted,safe}.log and codeql-encoding-gates.json.
The inline-script driver is codeql-fixture-browser.mjs; it uses only synthetic fixture data.

The actual GitHub CodeQL analysis must rerun after the maintainer pushes development to PR #81.
No local CodeQL scan or remote closure is claimed. Do not dismiss or resolve the findings manually
to substitute for that confirmation. No new manual app/device acceptance or package bump is needed.
