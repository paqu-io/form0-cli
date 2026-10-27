import { readFileSync, realpathSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SEVERITY = Object.freeze({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const pinnedVersion = (value) =>
  typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value);
const severity = (value) => Object.hasOwn(SEVERITY, value);
const advisoryPrefix = 'https://github.com/advisories/';

function policyErrors(policy, now) {
  const errors = [];
  if (
    !record(policy) ||
    policy.version !== 1 ||
    !Array.isArray(policy.exceptions) ||
    policy.exceptions.length > 1
  )
    return ['Invalid security exception policy.'];
  if (!Number.isFinite(now)) return ['Invalid audit clock.'];
  for (const entry of policy.exceptions) {
    if (!record(entry)) return ['Invalid exception entry.'];
    const approvedAt = Date.parse(entry.approvedOn + 'T00:00:00Z');
    const expiry = Date.parse(entry.expiresAt);
    if (
      entry.approved !== true ||
      !entry.id ||
      typeof entry.approvedBy !== 'string' ||
      !entry.approvedBy.trim() ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    )
      errors.push('Security exception has no explicit approval record.');
    if (
      !Number.isFinite(approvedAt) ||
      !Number.isFinite(expiry) ||
      expiry <= approvedAt ||
      expiry - approvedAt > 7 * 86400000 ||
      now < approvedAt ||
      now >= expiry
    )
      errors.push('Security exception is expired, not yet valid, or outside its seven-day window.');
    if (
      !pinnedVersion(entry.cliVersion) ||
      !record(entry.packages) ||
      !Object.keys(entry.packages).length
    )
      return [...errors, 'Invalid exception release/package scope.'];
    for (const [name, pkg] of Object.entries(entry.packages)) {
      if (
        !record(pkg) ||
        !pinnedVersion(pkg.version) ||
        typeof pkg.path !== 'string' ||
        !pkg.path.startsWith('node_modules/') ||
        pkg.path.includes('\\') ||
        pkg.path.split('/').some((part) => !part || part === '.' || part === '..') ||
        typeof pkg.direct !== 'boolean' ||
        !severity(pkg.maxSeverity) ||
        SEVERITY[pkg.maxSeverity] > SEVERITY.high
      )
        return [...errors, 'Invalid exception dependency scope: ' + name];
      if (pkg.parent && !Object.hasOwn(entry.packages, pkg.parent))
        errors.push('Unknown exception parent: ' + name);
      if (pkg.inheritedVia) {
        if (
          !Object.hasOwn(entry.packages, pkg.inheritedVia) ||
          pkg.inheritedVia === name ||
          entry.packages[pkg.inheritedVia]?.inheritedVia
        )
          errors.push('Invalid inherited exception chain: ' + name);
      } else if (
        !record(pkg.advisories) ||
        !Object.keys(pkg.advisories).length ||
        Object.entries(pkg.advisories).some(
          ([id, level]) =>
            !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(id) ||
            !severity(level) ||
            SEVERITY[level] > SEVERITY[pkg.maxSeverity]
        )
      )
        errors.push('Invalid exception advisory scope: ' + name);
    }
  }
  return errors;
}

function validateReport(report, exitCode) {
  const errors = [];
  if (
    !record(report) ||
    report.error ||
    report.auditReportVersion !== 2 ||
    !record(report.vulnerabilities) ||
    !record(report.metadata?.vulnerabilities) ||
    ![0, 1].includes(exitCode)
  )
    return ['npm audit failed or returned an unsupported report.'];
  const observed = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (
      !record(finding) ||
      finding.name !== name ||
      !severity(finding.severity) ||
      typeof finding.isDirect !== 'boolean' ||
      !Array.isArray(finding.nodes) ||
      !finding.nodes.length ||
      finding.nodes.some((node) => typeof node !== 'string') ||
      new Set(finding.nodes).size !== finding.nodes.length ||
      !Array.isArray(finding.via) ||
      !finding.via.length
    )
      return ['Malformed audit finding: ' + name];
    observed[finding.severity]++;
    observed.total++;
  }
  const declared = report.metadata.vulnerabilities;
  if (
    Object.keys(declared).length !== Object.keys(observed).length ||
    Object.entries(observed).some(([key, count]) => declared[key] !== count)
  )
    errors.push('Audit severity totals do not match its findings.');
  if (exitCode !== (observed.high + observed.critical > 0 ? 1 : 0))
    errors.push('Audit exit code does not match the high-severity threshold.');
  return errors;
}

/** Pure, fail-closed policy. Callers cannot change the clock or scope through command-line flags. */
export function assessAudit({ report, exitCode, policy, graph, now = Date.now() }) {
  const errors = [...validateReport(report, exitCode), ...policyErrors(policy, now)];
  const accepted = [];
  if (errors.length) return { ok: false, errors, accepted };
  const exception = policy.exceptions[0];
  if (!exception) {
    for (const [name, finding] of Object.entries(report.vulnerabilities))
      if (SEVERITY[finding.severity] >= SEVERITY.high)
        errors.push('Unaccepted audit finding: ' + name);
    return { ok: !errors.length, errors, accepted };
  }
  if (!record(graph?.manifest) || !record(graph?.lock?.packages) || !record(graph?.installed))
    return { ok: false, errors: ['Dependency graph could not be verified.'], accepted };
  for (const version of [
    graph.manifest.version,
    graph.lock.version,
    graph.lock.packages['']?.version,
  ])
    if (version !== exception.cliVersion)
      errors.push(
        'Exception is approved only for form0-cli ' +
          exception.cliVersion +
          '; manifest and lock must match that release.'
      );
  for (const [name, pkg] of Object.entries(exception.packages)) {
    const installed = graph.installed[pkg.path];
    const locked = graph.lock.packages[pkg.path];
    if (
      installed?.name !== name ||
      installed?.version !== pkg.version ||
      locked?.version !== pkg.version
    )
      errors.push('Installed/locked exception dependency differs: ' + name);
    if (
      pkg.direct &&
      (graph.manifest.dependencies?.[name] !== pkg.version ||
        graph.lock.packages['']?.dependencies?.[name] !== pkg.version)
    )
      errors.push('Root dependency is not the exact approved pin: ' + name);
    if (pkg.parent) {
      const parentPath = exception.packages[pkg.parent].path;
      if (
        graph.installed[parentPath]?.dependencies?.[name] !== pkg.version ||
        graph.lock.packages[parentPath]?.dependencies?.[name] !== pkg.version
      )
        errors.push('Parent dependency is not the exact approved pin: ' + name);
    }
  }
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (!Object.hasOwn(exception.packages, name)) {
      errors.push('Unaccepted audit package: ' + name);
      continue;
    }
    const pkg = exception.packages[name];
    if (
      finding.nodes.length !== 1 ||
      finding.nodes[0] !== pkg.path ||
      finding.isDirect !== pkg.direct ||
      SEVERITY[finding.severity] > SEVERITY[pkg.maxSeverity]
    )
      errors.push('Audit finding exceeds approved path/directness/severity: ' + name);
    if (pkg.inheritedVia) {
      if (
        finding.via.length !== 1 ||
        finding.via[0] !== pkg.inheritedVia ||
        !Object.hasOwn(report.vulnerabilities, pkg.inheritedVia)
      )
        errors.push('Unaccepted inherited advisory chain: ' + name);
    } else {
      for (const advisory of finding.via) {
        const id =
          typeof advisory?.url === 'string' && advisory.url.startsWith(advisoryPrefix)
            ? advisory.url.slice(advisoryPrefix.length)
            : null;
        if (
          !record(advisory) ||
          advisory.name !== name ||
          advisory.dependency !== name ||
          !Object.hasOwn(pkg.advisories, id) ||
          advisory.severity !== pkg.advisories[id]
        )
          errors.push('Unaccepted advisory: ' + name + ' / ' + (id || 'unknown'));
      }
    }
    accepted.push({ name, version: pkg.version, path: pkg.path, severity: finding.severity });
  }
  return {
    ok: !errors.length,
    errors,
    accepted: errors.length ? [] : accepted,
    exceptionId: exception.id,
    expiresAt: exception.expiresAt,
  };
}

/** Inspect package metadata and Node package resolution; never execute installed dependency code. */
export function readAuditGraph(projectRoot, policy, now = Date.now()) {
  const invalid = policyErrors(policy, now);
  if (invalid.length) throw new Error(invalid.join('\n'));
  const root = realpathSync(projectRoot);
  const readJSON = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const graph = {
    manifest: readJSON(path.join(root, 'package.json')),
    lock: readJSON(path.join(root, 'package-lock.json')),
    installed: {},
  };
  const exception = policy.exceptions[0];
  if (!exception) return graph;
  function within(parent, target) {
    const relative = path.relative(parent, target);
    return (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    );
  }
  for (const [name, pkg] of Object.entries(exception.packages)) {
    const location = realpathSync(path.join(root, pkg.path));
    if (!within(root, location))
      throw new Error('Exception dependency resolves outside the project: ' + name);
    const requester = path.join(
      root,
      pkg.parent ? exception.packages[pkg.parent].path : '',
      'package.json'
    );
    // Native package lookup supports import-only exports (Pi) without loading its entrypoint.
    const resolved = findPackageJSON(name, pathToFileURL(requester));
    if (!resolved || realpathSync(resolved) !== realpathSync(path.join(location, 'package.json')))
      throw new Error('Exception dependency resolution does not match its approved path: ' + name);
    graph.installed[pkg.path] = readJSON(path.join(location, 'package.json'));
  }
  return graph;
}
