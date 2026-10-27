import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessAudit } from '../scripts/audit-policy.mjs';
const report = JSON.parse(
  readFileSync(new URL('./fixtures/pi-audit-report.json', import.meta.url))
);
const policy = JSON.parse(
  readFileSync(new URL('../scripts/security-exceptions.json', import.meta.url))
);
const now = Date.parse('2026-10-27T12:00:00Z');
const pi = '@earendil-works/pi-coding-agent';
const graph = {
  manifest: { version: '0.8.0', dependencies: { [pi]: '1.0.4' } },
  lock: {
    version: '0.8.0',
    packages: { '': { version: '0.8.0', dependencies: { [pi]: '1.0.4' } } },
  },
  installed: {},
};
for (const [name, entry] of Object.entries(policy.exceptions[0].packages)) {
  const dependency = {
    name,
    version: entry.version,
    ...(name === pi ? { dependencies: { undici: '8.10.2' } } : {}),
  };
  graph.lock.packages[entry.path] = structuredClone(dependency);
  graph.installed[entry.path] = structuredClone(dependency);
}
function input() {
  return structuredClone({ report, policy, graph, now, exitCode: 1 });
}
function reject(mutate) {
  for (const purpose of ['release', 'validation']) {
    const data = input();
    data.purpose = purpose;
    mutate(data);
    const result = assessAudit(data);
    assert.equal(result.ok, false, purpose);
    assert.ok(result.errors.length);
  }
}

function setVersion(data, version) {
  data.graph.manifest.version = version;
  data.graph.lock.version = version;
  data.graph.lock.packages[''].version = version;
}

test('the approved 0.7.0 working tree passes validation but cannot pass release checks', () => {
  const data = input();
  data.policy.exceptions[0].validationVersion = '0.7.0';
  setVersion(data, '0.7.0');
  assert.equal(assessAudit(data).ok, false, 'default must remain publication-strict');
  assert.equal(assessAudit({ ...data, purpose: 'release' }).ok, false);
  const result = assessAudit({ ...data, purpose: 'validation' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.accepted.length, 2);
});

test('validation needs explicit approval and keeps manifest and lock versions consistent', () => {
  const data = input();
  data.purpose = 'validation';
  setVersion(data, '0.7.0');
  delete data.policy.exceptions[0].validationVersion;
  assert.equal(assessAudit(data).ok, false);
  data.policy.exceptions[0].validationVersion = '0.7.0';
  assert.equal(assessAudit(data).ok, true);
  for (const mutate of [
    (x) => (x.graph.manifest.version = '0.8.0'),
    (x) => (x.graph.lock.version = '0.8.0'),
    (x) => (x.graph.lock.packages[''].version = '0.8.0'),
  ]) {
    const mixed = structuredClone(data);
    mutate(mixed);
    assert.equal(assessAudit(mixed).ok, false, 'two individually allowed versions cannot be mixed');
  }
});

test('both contexts reject unapproved versions, invalid purposes and broadened validation approval', () => {
  for (const version of ['0.6.0', '0.8.1', '0.9.0', '0.7.0-beta.1'])
    reject((data) => setVersion(data, version));
  for (const purpose of [null, '', 'ci', 'publish', 'anything'])
    assert.equal(assessAudit({ ...input(), purpose }).ok, false);
  for (const validationVersion of [null, '*', '^0.7.0', ['0.7.0'], '0.8.0'])
    reject((data) => (data.policy.exceptions[0].validationVersion = validationVersion));
});

test('0.7.0 validation still rejects new findings, changed pins, revoked approval and expiry', () => {
  const baseline = input();
  baseline.policy.exceptions[0].validationVersion = '0.7.0';
  baseline.purpose = 'validation';
  setVersion(baseline, '0.7.0');
  for (const mutate of [
    (x) => (x.now = Date.parse('2026-11-03T00:00:00Z')),
    (x) => (x.policy.exceptions[0].approved = false),
    (x) => (x.graph.installed[x.policy.exceptions[0].packages.undici.path].version = '8.12.3'),
    (x) => (x.report.vulnerabilities[pi].via = ['other']),
    (x) =>
      (x.report.vulnerabilities.undici.via[0].url =
        'https://github.com/advisories/GHSA-new1-new2-new3'),
  ]) {
    const data = structuredClone(baseline);
    mutate(data);
    assert.equal(assessAudit(data).ok, false);
  }
});

test('the actual known report is accepted only within its exact approved release window', () => {
  const data = input();
  const original = structuredClone(data);
  const result = assessAudit(data);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.accepted.length, 2);
  assert.deepEqual(data, original);
});
test('absent/revoked approval, expiry and invalid clocks fail closed', () => {
  for (const mutate of [
    (x) => (x.policy.exceptions[0].approved = false),
    (x) => delete x.policy.exceptions[0].approvedBy,
    (x) => (x.policy.exceptions[0].expiresAt = 'invalid'),
    (x) => (x.now = Date.parse('2026-11-03T00:00:00Z')),
    (x) => (x.now = NaN),
    (x) => (x.now = Date.parse('2026-10-26T00:00:00Z')),
  ])
    reject(mutate);
});
test('unapproved CLI versions and mismatched root lock versions fail', () => {
  for (const mutate of [
    (x) => (x.graph.manifest.version = '0.7.0'),
    (x) => (x.graph.manifest.version = '0.8.1'),
    (x) => (x.graph.lock.version = '0.7.0'),
    (x) => (x.graph.lock.packages[''].version = '0.7.0'),
  ])
    reject(mutate);
});
test('unknown advisories, direct Pi findings, inherited causes and critical escalation fail', () => {
  for (const mutate of [
    (x) =>
      (x.report.vulnerabilities.undici.via[0].url =
        'https://github.com/advisories/GHSA-new1-new2-new3'),
    (x) =>
      x.report.vulnerabilities[pi].via.push({
        url: 'https://github.com/advisories/GHSA-direct-pi01-test',
      }),
    (x) => (x.report.vulnerabilities[pi].via = ['other']),
    (x) => (x.report.vulnerabilities.undici.severity = 'critical'),
    (x) => (x.report.vulnerabilities.undici.via[0].severity = 'high'),
  ])
    reject(mutate);
});
test('another vulnerable package/copy, unexpected paths and mismatched directness fail', () => {
  for (const mutate of [
    (x) => (x.report.vulnerabilities.other = { ...x.report.vulnerabilities.undici, name: 'other' }),
    (x) => x.report.vulnerabilities.undici.nodes.push('node_modules/other/node_modules/undici'),
    (x) => (x.report.vulnerabilities.undici.nodes = ['node_modules/undici']),
    (x) => (x.report.vulnerabilities.undici.nodes = ['../outside']),
    (x) => (x.report.vulnerabilities.undici.isDirect = true),
  ])
    reject(mutate);
});
test('manifest, lock, installed version and exact parent pin must agree', () => {
  const entries = policy.exceptions[0].packages;
  for (const [name, { path }] of Object.entries(entries)) {
    reject((x) => (x.graph.installed[path].version = '0.0.0'));
    reject((x) => (x.graph.lock.packages[path].version = '0.0.0'));
    reject((x) => delete x.graph.installed[path]);
    reject((x) => (x.graph.installed[path].name = 'wrong'));
  }
  reject((x) => (x.graph.manifest.dependencies[pi] = '^1.0.4'));
  reject((x) => (x.graph.lock.packages[''].dependencies[pi] = '^1.0.4'));
  reject((x) => (x.graph.lock.packages[entries[pi].path].dependencies.undici = '^8.10.2'));
  reject((x) => (x.graph.installed[entries[pi].path].dependencies.undici = '^8.10.2'));
});
test('malformed audit reports, unexpected exit codes and audit errors cannot be accepted', () => {
  for (const mutate of [
    (x) => (x.report = null),
    (x) => (x.report.auditReportVersion = 999),
    (x) => delete x.report.metadata,
    (x) => (x.report.error = { code: 'NETWORK' }),
    (x) => (x.report.vulnerabilities.undici.nodes = null),
    (x) => (x.report.vulnerabilities.undici.via = []),
    (x) => (x.report.metadata.vulnerabilities.total = 0),
    (x) => (x.exitCode = 0),
    (x) => (x.exitCode = 2),
    (x) => (x.exitCode = null),
  ])
    reject(mutate);
});
test('a patched clean graph passes strict audit with exceptions removed', () => {
  const data = input();
  data.policy.exceptions = [];
  data.report.vulnerabilities = {};
  data.report.metadata.vulnerabilities = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };
  data.exitCode = 0;
  const result = assessAudit(data);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.accepted, []);
  data.report.vulnerabilities = report.vulnerabilities;
  data.report.metadata.vulnerabilities = report.metadata.vulnerabilities;
  data.exitCode = 1;
  assert.equal(assessAudit(data).ok, false);
});

test('a well-formed new finding is blocked even below the old high threshold', () => {
  const data = input();
  data.report.vulnerabilities.unapproved = {
    name: 'unapproved',
    severity: 'low',
    isDirect: false,
    nodes: ['node_modules/unapproved'],
    via: [
      {
        name: 'unapproved',
        dependency: 'unapproved',
        severity: 'low',
        url: 'https://github.com/advisories/GHSA-new1-new2-new3',
      },
    ],
  };
  data.report.metadata.vulnerabilities.low = 1;
  data.report.metadata.vulnerabilities.total++;
  const result = assessAudit(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Unaccepted audit package')));
});
test('a critical escalation is blocked with internally consistent totals', () => {
  const data = input();
  data.report.vulnerabilities.undici.severity = 'critical';
  data.report.metadata.vulnerabilities.high--;
  data.report.metadata.vulnerabilities.critical++;
  const result = assessAudit(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('severity')));
});
test('unsafe policy paths, unsupported policy versions and broadened approval windows fail', () => {
  for (const mutate of [
    (x) => (x.policy.version = 2),
    (x) => (x.policy.exceptions[0].packages.undici.path = 'node_modules/../outside'),
    (x) => (x.policy.exceptions[0].packages.undici.path = 'node_modules\\undici'),
    (x) => (x.policy.exceptions[0].expiresAt = '2026-11-04T00:00:00.000Z'),
  ])
    reject(mutate);
});
