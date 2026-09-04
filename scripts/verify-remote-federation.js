#!/usr/bin/env node
// Verify a built extension remote is a well-formed Native Federation remote that the
// Angular 22 portal can actually load. Run AFTER `npm run build` in the extension's frontend/.
//
//   node scripts/verify-remote-federation.js <extension-dir> [host-remote-entry.json]
//
// Checks, in order:
//   1. frontend/dist/remoteEntry.json exists (i.e. this is an NF build, not a Webpack one)
//   2. frontend/dist/browser/ does NOT exist (angular.json must flatten outputPath.browser to "",
//      because build-extension.sh copies frontend/dist/. straight into the bundle's fe/)
//   3. remoteEntry.json .name === manifest .frontend.remote.remoteName
//   4. manifest .frontend.remote.remoteEntry ends in /remoteEntry.json
//   5. the exposed module named in the manifest is present in remoteEntry.json .exposes
//   6. (when a host entry is given) every shared package the remote declares is also published
//      by the host at the same MAJOR version. Major only: the shared configs use
//      strictVersion:false, which tolerates minor/patch skew between independent deploys but
//      not a major mismatch.
//
// Every check is gated only on ITS OWN inputs being readable, never on whether an earlier check
// failed — one run must report every problem it can see, or a dev fixes one and rediscovers the
// next on the following run. Unreadable/malformed JSON is reported as a FAIL line like any other
// problem, never as an uncaught exception.
'use strict';
const fs = require('fs');
const path = require('path');

const [dir, hostEntryPath] = process.argv.slice(2);
if (!dir) {
  console.error('usage: verify-remote-federation.js <extension-dir> [host-remote-entry.json]');
  process.exit(2);
}

const problems = [];
const fail = (msg) => problems.push(msg);
const major = (v) => String(v ?? '').replace(/^[^\d]*/, '').split('.')[0];

// Never throws: a malformed file becomes a FAIL line, preserving the "one FAIL: <reason> per
// problem on stderr" contract that callers rely on instead of dumping a Node stack trace.
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    fail(`${p} is not readable as JSON: ${err.message}`);
    return null;
  }
};

const finish = () => {
  if (problems.length) {
    for (const p of problems) console.error(`FAIL: ${p}`);
    process.exit(1);
  }
  console.log(`OK: ${dir} is a loadable Native Federation remote`);
  process.exit(0);
};

const manifestPath = path.join(dir, 'manifest.json');
const distDir = path.join(dir, 'frontend', 'dist');
const entryPath = path.join(distDir, 'remoteEntry.json');

if (!fs.existsSync(manifestPath)) {
  fail(`no manifest.json at ${manifestPath}`);
  finish();
}

const manifest = readJson(manifestPath);
const remote = manifest && manifest.frontend && manifest.frontend.remote;
if (manifest && !remote) {
  fail('manifest has no frontend.remote block');
}
if (remote && !/\/remoteEntry\.json$/.test(remote.remoteEntry || '')) {
  fail(`manifest frontend.remote.remoteEntry is '${remote.remoteEntry}' — must end in /remoteEntry.json`);
}

if (fs.existsSync(path.join(distDir, 'browser'))) {
  fail(`${distDir}/browser/ exists — set angular.json outputPath to { "base": "dist", "browser": "" }`);
}

let entry = null;
if (!fs.existsSync(entryPath)) {
  fail(`no ${entryPath} — the frontend did not produce a Native Federation entry (build it first)`);
} else {
  entry = readJson(entryPath);
}

if (entry && remote) {
  if (entry.name !== remote.remoteName) {
    fail(`remoteEntry.json name '${entry.name}' !== manifest remoteName '${remote.remoteName}'`);
  }
  const exposedKeys = (entry.exposes || []).map((e) => e.key);
  if (!exposedKeys.includes(remote.exposedModule)) {
    fail(`manifest exposedModule '${remote.exposedModule}' not in remoteEntry exposes [${exposedKeys}]`);
  }
}

if (entry && hostEntryPath) {
  if (!fs.existsSync(hostEntryPath)) {
    fail(`no host remoteEntry.json at ${hostEntryPath}`);
  } else {
    const hostEntry = readJson(hostEntryPath);
    if (hostEntry && !Array.isArray(hostEntry.shared)) {
      // Distinct from "the host omits one package": an absent shared array means the wrong file was
      // passed (a Webpack-era entry, some other JSON), which would otherwise report every single
      // remote-declared package as unpublished and bury the real cause.
      fail(`${hostEntryPath} has no 'shared' array — is it a Native Federation host remoteEntry.json?`);
    } else if (hostEntry) {
      const hostShared = new Map(hostEntry.shared.map((s) => [s.packageName, s]));
      for (const s of entry.shared || []) {
        // Native Federation injects per-build, hash-named pseudo-entries (@nf-internal/chunk-*)
        // into the shared array. Their hashes differ on every build, so they can never match
        // across two independently built remoteEntry.json files — skip them, not real packages.
        if (s.packageName.startsWith('@nf-internal/')) continue;
        const hostPkg = hostShared.get(s.packageName);
        if (!hostPkg) {
          fail(`shared '${s.packageName}' is declared by the remote but not published by the host`);
        } else if (major(hostPkg.version) !== major(s.version)) {
          fail(
            `shared '${s.packageName}' major mismatch: remote ${s.version} vs host ${hostPkg.version}`
          );
        }
      }
    }
  }
}

finish();
