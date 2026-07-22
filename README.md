# benchday.openspec

The first open-source [Benchday](https://github.com/moezakura/mux-pod) project
plugin, and the reference implementation of the `benchday.plugin/1` extension
ABI. It surfaces a project's [OpenSpec](https://github.com/Fission-AI/OpenSpec)
state — open changes, per-change task progress, and validation — on Benchday's
work rows, terminal header, and in a relevance-ranked status page.

**It is pure data.** There is no build step and no code to run: the package is a
manifest plus JSON descriptors (the status page's HTML/JS is inlined in
`actions/view_status.json`). A Benchday host loads it; it imports nothing.

## What it does

- **Detects** an OpenSpec project by finding an `openspec/` directory at or above
  a pane's working directory, and separately reports whether a compatible
  `openspec` CLI is available.
- **Reports** a bounded, versioned payload (`benchday.openspec.report/1`): the
  count of open changes, per-change `completed/total` task counts and status, and
  — only when a pane's cwd is genuinely inside `openspec/changes/<name>` — the
  change that pane is working on.
- **Contributes** a work-row change-count badge, a terminal-header badge, an
  active-change tag, a "Choose change" picker, and `Validate specs` /
  `Validate change` actions.
- **Ranks**, in its status page, the changes most relevant to the current pane
  (association is proven evidence and pins first; a soft match against the pane
  summary is suggested; the rest is a plain alphabetical inventory).

The only permissions requested are `project.read.metadata` and
`process.exec:openspec`. All descriptor paths are package-relative and confined
to this folder.

## Layout

```
manifest.json          # package descriptor (schema benchday.plugin/1)
plugin-api.json        # published snapshot of the ABI this package targets
PLUGIN-API.md          # human authoring guide for benchday.plugin/1
check.mjs              # standalone validator (node check.mjs) — no dependencies
probes/                # detection + data collection (path_exists, exec_json, path_capture)
report/                # schema + declarative probe→payload map
actions/               # commands and destinations (validate, choose_change, view_status)
contrib/               # slot placements (work-row / terminal / detail badges + actions)
```

## Validate it

```
node check.mjs
```

Parses the manifest, confirms every declared file exists and is well-formed,
and checks the package against the limits and vocabularies in `plugin-api.json`
(slot ids, probe kinds, contribution/action/probe counts). Exits non-zero on any
problem. This is a shape/contract check — the full behavioral conformance tests
run inside the Benchday host.

## How a host loads it

A Benchday hub discovers every folder under its plugins directory that contains a
`manifest.json`, validates the package against `benchday.plugin/1`, runs the
probes on the machine that owns the project's filesystem, resolves the declared
`report/map.json` into the canonical report payload, and serves each client only
the contributions it can render. See `PLUGIN-API.md`.

## License

MIT — see `LICENSE`.
