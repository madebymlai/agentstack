---
name: agentstack
description: Interactive project setup — tokf compression filters. Use when setting up a new project or adding tokf compression filters. (Design principles live in the design-principles skill; coding standards in the coding-standards skill.)
argument-hint: ""
---

<purpose>
Interactive project setup. Probe the codebase, propose items one at a time, and write accepted items at the end.
</purpose>

<rules>
- All user interaction via direct questions — one topic at a time
- Accumulate accepted items in memory, write files only at the end
- Explain what you found before each proposal
</rules>

<phase name="detection">
Check what's available:
- Is `tokf` binary on the system? (If not, this skill has nothing to set up — point the user at the design-principles or coding-standards skills instead.)
</phase>

<phase name="setup">
Set up tokf filters — see [tokf-filters.md](tokf-filters.md). Load it and follow its phases.
</phase>

<phase name="summary">
Report what was written:
- Filters written to `.tokf/filters/`
- Rewrites added to `.tokf/rewrites.toml`
</phase>
