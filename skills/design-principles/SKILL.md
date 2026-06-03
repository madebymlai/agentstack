---
name: design-principles
description: Design principles writer — interactively select a project's architecture and design principles from curated catalogs and append them to AGENTS.md so they guide design decisions before implementation. Use when defining or revising design conventions, reviewing a plan against architectural principles, or when a repo has no documented design principles.
---

<purpose>
A design principles writer. Probe the codebase, propose principles one menu at a time, let the user accept or reject each, then append the accepted set to AGENTS.md. These are pre-implementation design decisions that require judgment — they shape how work is structured before and while it is written. Line-level coding style lives elsewhere (the coding-standards skill / CODING_STANDARDS.md), enforced at diff-review time.
</purpose>

<rules>
- All user interaction via direct questions — one catalog section at a time.
- Accumulate accepted items in memory; write the file only at the end.
- Explain what you found in the codebase before each recommendation.
- Recommend, don't gatekeep: surface the full menu, flag the items the code argues for, but let the user pick freely (including items you didn't flag, and skipping ones you did).
- Principles are judgment calls a designer applies — not mechanically checkable lint rules. If a tool can enforce it, it does not belong here.
</rules>

<phase name="locate">
The target is an agent-managed block at the bottom of `AGENTS.md` at the repo root, bounded by `<design-principles>` … `</design-principles>` tags. The tags mark the block as managed by this skill so it can be located and rewritten on later runs without disturbing the rest of AGENTS.md.

- **If the `<design-principles>` block exists** — read it. Treat its current principles as already-decided: do not re-propose them. The session is then an *update* — you are adding to (or, if the user asks, revising) the existing set.
- **If it is missing** — this is a fresh write; you will append a new `<design-principles>` … `</design-principles>` block at the end of AGENTS.md at the end of the session. If AGENTS.md itself does not exist, create it.

Tell the user whether you're creating the block or updating it.
</phase>

## Catalogs

Read both for the full menu. Each item carries a one-line definition and a `> Pick when:` signal describing the design smell it addresses.

- [catalogs/ARCHITECTURE.md](catalogs/ARCHITECTURE.md) — module boundaries, coupling
- [catalogs/DESIGN.md](catalogs/DESIGN.md) — SOLID, simplicity, domain modeling, robustness

<phase name="present">
Show the user each catalog's items, grouped by section, with the name and its one-line definition. Skip any item already present in the target section (from the locate phase). Keep it scannable — the user is choosing from a menu, not reading an essay.
</phase>

<phase name="recommend">
Probe the codebase before recommending. Use the codebase-memory MCP tools first (`get_architecture`, `search_code`, `search_graph`). Flag the catalog items whose `> Pick when:` signal matches evidence you actually found — and say what evidence. Do not hide the items you didn't flag.
</phase>

<phase name="select">
The user picks which principles they want. They may pick items you didn't recommend, or skip ones you did. Confirm the final set before writing.
</phase>

<phase name="write">
Write the selected principles into a `<design-principles>` … `</design-principles>` block at the bottom of AGENTS.md. Inside the tags, the principles sit directly under the same `## ` section headers as the catalogs, each as `- **Name** — definition in 1–2 sentences.`. Do not include the `> Pick when:` signals or source links — only the principle and its definition.

```
<design-principles>
## Module Design
- **SRP** — A module should have one, and only one, reason to change.
...
</design-principles>
```

When updating, rewrite the existing block in place — merge new items under their sections without disturbing the tags, the rest of AGENTS.md, or the items already inside.
</phase>

<phase name="summary">
Report what was written: the path, whether the `<design-principles>` block was created or updated, and the list of principles grouped by section. Note that this block guides design decisions at planning time, not the diff-review loop.
</phase>
