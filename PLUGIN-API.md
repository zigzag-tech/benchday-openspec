# benchday.plugin/1 — extension authoring guide

This is the contract a Benchday project plugin targets. The machine-readable
vocabulary and limits live in [`plugin-api.json`](./plugin-api.json) (a published
snapshot of the host's single source of truth); this document explains how to use
them. `benchday.openspec` in this repo is the reference implementation — read its
descriptors alongside this guide.

## Principle: a plugin is data, never code

A package is a `manifest.json` plus JSON descriptors. The host never executes
plugin-supplied code. The one place a plugin ships markup is an `extension.web`
action, whose HTML/JS runs **sealed inside a WebView** with no host privileges —
it receives a data snapshot and renders; it cannot call back into the host.

Everything is package-relative. The host refuses any path that escapes the
package root and loads only files the manifest declares. Identity is a content +
relative-path digest, so a package loads identically from a folder, a repository
checkout, or a submodule.

## Manifest (`benchday.plugin/1`)

```jsonc
{
  "schema": "benchday.plugin/1",
  "id": "publisher.name",           // [a-z0-9._-], ≤64; namespaced
  "version": "0.6.0",               // semver
  "display_name": "OpenSpec",
  "publisher": { "id": "benchday", "trust": "first-party" },
  "api": { "min": 1, "max": 1 },    // ABI versions this package supports
  "description": "...",             // ≤512
  "permissions": ["project.read.metadata", "process.exec:openspec"],
  "matches": { "probe": "has_openspec" },   // the probe that gates the whole package
  "probes": ["probes/*.json"],
  "report": {
    "payload_schema": "publisher.name.report/1",
    "schema": "report/schema.json",
    "map": "report/map.json",
    "ttl_ms": 60000
  },
  "actions": ["actions/*.json"],
  "contributions": ["contrib/*.json"]
}
```

The schema is **strict** — unknown keys are rejected. There is intentionally no
manifest `license` field on `benchday.plugin/1`; ship a `LICENSE` file instead.

**Trust is a property of origin, not of bytes.** A manifest may *claim*
`first-party`, but the host caps it at what the install origin can vouch for and
can only ever demote the claim. A community install of a package claiming
`first-party` is served as `community`.

**Permissions** are declared, never implicit, and an update cannot silently
widen them: a capability the previous version did not hold arrives ungranted and
its contributions stay dark until a human approves. Classes are in
`plugin-api.json.permission_classes` (`project.read.metadata`,
`project.read.files:<glob>`, `process.exec:<binary>`).

## Probes — detection and data collection

Probes run on the machine that owns the project's filesystem. Kinds
(`plugin-api.json.probe_kinds`): `path_exists`, `path_capture`, `file_meta`,
`exec_version`, `exec_json`, `exec_text`. Context keys a probe may read
(`probe_context_keys`): `pane.cwd`, `pane.id`, `project.root`.

```jsonc
// probes/has_openspec.json — gate the package on evidence
{ "kind": "path_exists", "id": "has_openspec", "path": "openspec", "type": "dir", "search": "ancestors" }

// probes/list.json — structured CLI output
{ "kind": "exec_json", "id": "list", "binary": "openspec", "args": ["list", "--json"], "timeout_ms": 20000 }

// probes/active_change.json — capture a token from the pane's cwd
{ "kind": "path_capture", "id": "active_change", "from": "pane.cwd", "pattern": "openspec/changes/{change}" }
```

Timeouts and output sizes are bounded by `plugin-api.json.limits`.

## Report — one canonical payload

`report/map.json` (schema `benchday.plugin.report-map/1`) declaratively projects
probe results into the payload described by `report/schema.json`. It supports JSON
pointers into probe output (`get`), existence (`exists`), bounded arrays with a
per-item shape (`item`, `max`), and cross-probe lookups (`find` … `where` /
`equals_probe` / `select`). Every contribution and action-availability decision
derives from this one report — surfaces never run their own probes. Reports are
bounded (`report_max_bytes`) and carry freshness/completeness/diagnostics in a
common envelope (`benchday.plugin.report/1`).

Keep unbounded material out: summarize, reference evidence, never embed raw file
or command output.

## Actions (`benchday.plugin.action/1`)

An action is either a **command** run on the owning daemon, or a **destination**
that opens a surface.

- `effect` ∈ `plugin-api.json.effect_classes` (`read`, `validate`,
  `write-project`, `external`); `write-project`/`external` require confirmation.
- Command actions declare `{ binary, args, timeout_ms, result }`, where `args`
  entries are `{ "const": "..." }` or `{ "report": "<field>" }`.
- Destination actions declare `{ surface, view }` from `plugin-api.json.surfaces`
  (`extension.popup/status`, `extension.web/page`, `files/*`).
- `refreshes_report: true` re-evaluates the report after the action runs.
- A destination action MAY declare `footer_actions`: ≤3 references to the
  package's *own* actions, each with an optional `when` guard, rendered as a
  native button bar in the sheet chrome (outside the sealed WebView).

## Contributions (`benchday.plugin.contribution/1`)

A contribution places a `decoration` (badge/label with `tone`, `icon`, optional
`progress`) or an `action` into a named **slot**, optionally gated by a `when`
predicate over the report (`exists`, `eq`, `not`, `all`, `any`).

Slots (`plugin-api.json.slots`) include `work.row.badges`, `work.detail.actions`,
`terminal.header.badges`, `terminal.context.actions`, `project.summary`. Icon and
tone vocabularies, label lengths, and per-slot caps (`max_contributions_per_slot`,
`max_contributions_per_plugin_per_slot`) are in `plugin-api.json`.

## The `extension.web` contract

An `extension.web` action ships `web.html` (≤`web_page_max_bytes`), plus:

- `web.data` — a projection of the report, injected as `window.__BENCHDAY__`.
- `web.context` — declares `keys` the host resolves and injects as
  `window.__BENCHDAY_CONTEXT__` (e.g. `surface.summary`, a pane digest). Each key
  carries a `status` (`available` / stale / `unavailable`); rank only on fresh
  values and degrade honestly otherwise.

- `web.rank` — declares a candidate array plus the `id`/`text` fields on each,
  and a context key to use as the query. The host scores every candidate against
  it (lexical + semantic) and injects `window.__BENCHDAY_RELEVANCE__`. This is a
  RESEMBLANCE signal: use it to order candidates you know nothing else about.
- `web.rank.evidence` — declares `path_pattern`, the path shape that binds a
  path the pane demonstrably **wrote** to a candidate id, with `{id}` marking the
  capture. The host injects `window.__BENCHDAY_EVIDENCE__`, keyed by candidate id
  and carrying `{tier, write_count, last_write_ms}`.

### Evidence beats resemblance

These two are not interchangeable, and the ordering between them is the whole
point. A relevance score answers "what does this look like?"; evidence answers
"what did this pane actually do?" A pane that *discusses* one entity while
*building* another mentions the discussed one far more often — measured, 72
mentions to 51 — so a page that ranks on resemblance alone will confidently name
the wrong thing.

So: render evidence-carrying candidates ABOVE scored ones, exclude them from the
scored set entirely, and label them with what is known rather than with a claim
of similarity. A page that says "related to your work" about something it merely
pattern-matched is asserting a relationship it has not established.

A worked example, from a hypothetical issue-tracker package whose issues live in
`tickets/<id>/`:

```json
"web": {
  "rank": {
    "candidates": "issues",
    "id": "key",
    "text": "title",
    "query": "surface.summary",
    "evidence": { "path_pattern": "tickets/{id}/" }
  }
}
```

A pane that edited `tickets/PROJ-419/notes.md` is now ASSOCIATED with `PROJ-419`
— no scoring involved, and no floor, summary freshness, or embedding provider
can move it. Every other issue is still ranked softly against the summary, as
before. Both globals are absent when the host computes nothing, so a page must
treat missing as "nothing is known", never as "nothing matched".

Style against the host's CSS custom properties (`--bd-primary`, `--bd-muted`,
`--bd-line`, `--bd-radius-sm`, …) so the page tracks the host theme. The page is
sealed: it cannot fetch, cannot reach the host, and its only inputs are those two
globals. See `actions/view_status.json` for a complete example (it ranks changes
by pane relevance — logic the report language is deliberately too weak to
express, which is the reason the HTML lane exists).

## Limits

All caps — file counts and sizes, probe/action counts and timeouts, report size,
decoration/label lengths, per-slot caps, cache and backoff — are in
`plugin-api.json.limits`. Exceeding one fails validation; the package is isolated
with a diagnostic and the rest of the catalog keeps serving.
