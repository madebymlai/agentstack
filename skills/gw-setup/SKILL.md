---
name: gw-setup
description: Groundwork conventions setup — run the design-principles and coding-standards writers, either interactively or on the agent's own judgement. Use when setting up a repo's conventions from scratch, when the user asks to configure standards or principles, or when a repo has neither documented.
---

<purpose>
The entry point for a repo's written conventions. Establishes what the two writers produce, asks which ones to run and how much say the user wants, then hands off to them. This skill decides nothing about the conventions themselves — it only routes.
</purpose>

<rules>
- Ask both questions before running anything. Do not assume scope or mode.
- Do not propose principles or standards yourself. The writers own their catalogs.
- Run the writers one at a time, to completion, in the order below.
- Report at the end which files were touched, so the user sees the whole result in one place.
</rules>

<phase name="scope">
Ask which conventions to write, offering three choices and a one-line summary of each:

- **Design principles** — architecture and design decisions that shape work before it is written. Appended to a `<design-principles>` block in AGENTS.md.
- **Coding standards** — line-level style and testing rules a reviewer checks against a diff. Written to CODING_STANDARDS.md.
- **Both** — principles first, then standards.

Say which of the target files already exist, so the user knows whether they are creating or updating before they choose.
</phase>

<phase name="mode">
Ask how the selection should be made:

- **Manual** — the writer presents each catalog section as a menu and the user accepts or rejects each item. Slower, and the user owns every choice.
- **Headless** — the writer probes the codebase and decides on its own, selecting the catalog items whose `> Pick when:` signal matches evidence it actually found. No menus.

Headless is the agent's judgement, not a default set: it selects only what the codebase argues for, and it still reports every choice with the evidence behind it so the user can revise afterwards.
</phase>

<phase name="run">
Run the selected writers in this order — principles first, since design decisions frame the style rules:

1. `gw-design-principles`
2. `gw-coding-standards`

Load the skill's SKILL.md and follow it. Carry the chosen mode into each one:

- **Manual** — follow the writer exactly as written.
- **Headless** — skip its `present` and `select` phases. Run `locate` and `recommend` as written, then take the items you flagged in `recommend` as the selected set and go straight to `write`. Flag nothing you found no evidence for; an empty section is a valid result. In the writer's `summary`, state the evidence for each item you chose.

Finish one writer completely, including its write and summary, before starting the next.
</phase>

<phase name="summary">
Report the whole run in one place: the mode used, each writer that ran, the file it wrote, whether it created or updated, and the count of items written per section.

If the run was headless, tell the user how to revise: re-run this skill in manual mode to add items from the catalogs, or edit the target files directly.
</phase>
