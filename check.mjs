#!/usr/bin/env node
// @ts-check
/**
 * Standalone, dependency-free shape/contract check for a benchday.plugin/1
 * package. It is NOT the host's behavioral conformance suite — it validates that
 * the package is well-formed and stays within the ABI vocabulary and limits
 * published in plugin-api.json, so a contributor gets a red build on a malformed
 * descriptor without needing the whole Benchday host.
 *
 *   node check.mjs            # validate the package in this folder
 *
 * Exits 0 if clean, 1 (with itemized errors) otherwise.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
/** @type {string[]} */
const errors = [];
/** @param {string} m */
const fail = (m) => errors.push(m);

/**
 * Read + parse a package-relative JSON file, guarding path escape + existence.
 * @param {string} rel
 */
function readJson(rel) {
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) {
    fail(`path escapes package root: ${rel}`);
    return null;
  }
  if (!existsSync(abs)) {
    fail(`declared file missing: ${rel}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    fail(`not valid JSON: ${rel} — ${e.message}`);
    return null;
  }
}

const api = readJson('plugin-api.json');
const manifest = readJson('manifest.json');

if (api && manifest) {
  const L = api.limits || {};

  // Manifest essentials.
  if (manifest.schema !== api.manifest_schema) {
    fail(`manifest.schema is ${JSON.stringify(manifest.schema)}, expected ${JSON.stringify(api.manifest_schema)}`);
  }
  for (const k of ['id', 'version', 'display_name', 'publisher', 'api', 'matches', 'report']) {
    if (manifest[k] == null) fail(`manifest missing required key: ${k}`);
  }
  if (manifest.publisher && !api.publisher_trust_tiers.includes(manifest.publisher.trust)) {
    fail(`publisher.trust ${JSON.stringify(manifest.publisher?.trust)} not in ${api.publisher_trust_tiers.join(', ')}`);
  }

  // Declared file lists exist, parse, and stay within limits.
  const probes = manifest.probes || [];
  const actions = manifest.actions || [];
  const contributions = manifest.contributions || [];
  const fixtures = manifest.fixtures || [];
  if (probes.length > L.max_probes) fail(`${probes.length} probes exceeds max_probes ${L.max_probes}`);
  if (actions.length > L.max_actions) fail(`${actions.length} actions exceeds max_actions ${L.max_actions}`);
  if (contributions.length > L.max_contributions) fail(`${contributions.length} contributions exceeds max_contributions ${L.max_contributions}`);

  const probeKinds = new Set(api.probe_kinds);
  for (const rel of probes) {
    const p = readJson(rel);
    if (p && !probeKinds.has(p.kind)) fail(`probe ${rel}: kind ${JSON.stringify(p.kind)} not in ${api.probe_kinds.join(', ')}`);
  }

  // report schema + map exist and parse.
  if (manifest.report) {
    if (manifest.report.schema) readJson(manifest.report.schema);
    if (manifest.report.map) readJson(manifest.report.map);
  }

  // Contributions: slot must be a published slot. The per-plugin-per-slot cap is
  // a RESOLVE-time rule the host enforces after `when` guards filter, so a package
  // may legitimately DECLARE more than the cap as long as no more than `cap` are
  // ever simultaneously visible (e.g. two contributions gated on opposite states).
  // Statically we can only be sure about UNCONDITIONAL contributions (no `when`) —
  // those are always present together, so only they can be safely counted.
  const slotIds = new Set((api.slots || []).map((/** @type {any} */ s) => s.id));
  /** @type {Map<string, number>} */
  const perSlotAlways = new Map();
  for (const rel of contributions) {
    const c = readJson(rel);
    if (!c) continue;
    if (c.slot && !slotIds.has(c.slot)) fail(`contribution ${rel}: slot ${JSON.stringify(c.slot)} not in ${[...slotIds].join(', ')}`);
    if (c.slot && c.when == null) perSlotAlways.set(c.slot, (perSlotAlways.get(c.slot) || 0) + 1);
  }
  const cap = L.max_contributions_per_plugin_per_slot;
  for (const [slot, n] of perSlotAlways) {
    if (cap && n > cap) fail(`slot ${slot}: ${n} unconditional contributions exceed max_contributions_per_plugin_per_slot ${cap}`);
  }

  // Actions parse; destination surfaces/views are published.
  const surfaces = new Map((api.surfaces || []).map((/** @type {any} */ s) => [s.id, new Set(s.views)]));
  for (const rel of actions) {
    const a = readJson(rel);
    if (!a) continue;
    const dest = a.destination;
    if (dest) {
      if (!surfaces.has(dest.surface)) fail(`action ${rel}: surface ${JSON.stringify(dest.surface)} not in ${[...surfaces.keys()].join(', ')}`);
      else if (dest.view && !surfaces.get(dest.surface).has(dest.view)) fail(`action ${rel}: view ${JSON.stringify(dest.view)} not valid for surface ${dest.surface}`);
    }
    if (a.effect && !api.effect_classes.includes(a.effect)) fail(`action ${rel}: effect ${JSON.stringify(a.effect)} not in ${api.effect_classes.join(', ')}`);
    // A work-association request reads panes and work items OUTSIDE the current
    // one — the first such read in this ABI — so the package must ask for it.
    // Declaring the request without the permission is a packaging error, not a
    // runtime surprise.
    if (a.web && a.web.work) {
      const perms = manifest.permissions || [];
      if (!perms.includes('work.read.associations')) {
        fail(`action ${rel}: declares web.work but the manifest does not request work.read.associations`);
      }
      if (a.web.work.include_possible && !a.web.work.text) {
        fail(`action ${rel}: web.work.include_possible needs web.work.text to compare against`);
      }
    }
  }
  for (const rel of fixtures) readJson(rel);
}

// License completeness — must be full text with a copyright holder, not a stub.
const licPath = join(root, 'LICENSE');
if (!existsSync(licPath)) {
  fail('LICENSE file missing');
} else {
  const lic = readFileSync(licPath, 'utf8');
  if (lic.trim().length < 200 || !/copyright/i.test(lic)) {
    fail('LICENSE looks like a stub — needs full license text and a copyright holder');
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('✓ package is well-formed and within benchday.plugin/1 limits');
