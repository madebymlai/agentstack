---
name: agentstack
description: Interactive project setup — coding principles and tokf filters. Use when setting up a new project, configuring agent coding conventions, or adding tokf compression filters.
argument-hint: ""
---

<purpose>
Interactive project setup with two independent modes. Each mode probes the codebase, proposes items one at a time, and writes accepted items at the end.
</purpose>

<rules>
- All user interaction via direct questions — one topic at a time
- Accumulate accepted items in memory, write files only at the end
- Explain what you found before each proposal
- Keep each mode self-contained — any mode can run alone
</rules>

<phase name="detection">
Check what's available:
- Is `tokf` binary on the system?
</phase>

<phase name="mode-selection">
Ask: "What would you like to set up?"
Offer all applicable modes:
- Coding principles (AGENTS.md) — see [principles.md](principles.md)
- tokf filters (requires tokf) — see [tokf-filters.md](tokf-filters.md)
</phase>

Load the reference file for each selected mode and follow its phases.

<phase name="summary">
Report what was written:
- Principles added to AGENTS.md
- Filters written to `.tokf/filters/`
- Rewrites added to `.tokf/rewrites.toml`
</phase>
