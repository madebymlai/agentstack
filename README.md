<p align="center">
  <a href="docs/groundwork-flow.html">
    <img src="docs/assets/groundwork.png?v=7" alt="groundwork: set up your coding agents with one command" width="830">
  </a>
</p>

One command to set up a coding-agent toolchain: pick the agents you use, and groundwork installs the shared binaries, points each agent's config at them, and writes the conventions every agent reads.

See [`docs/groundwork-flow.html`](docs/groundwork-flow.html) for the full walkthrough of how the pieces fit together.

## Install

Run it interactively and select any mix of Claude Code, Codex, OpenCode, and pi:

```bash
npx github:madebymlai/groundwork
```

Skip the selector with per-agent flags:

```bash
npx github:madebymlai/groundwork --claude --codex
npx github:madebymlai/groundwork --opencode --pi
```

This is a machine-level run. It installs and version-checks shared binaries, then applies the settings each selected agent needs:

| What | Detail |
|------|--------|
| [**codebase-memory**](https://github.com/DeusData/codebase-memory-mcp) | Code knowledge-graph MCP server, installed with auto-indexing enabled (`auto_index_limit 50000`). It registers itself with each agent, including a generated pi extension |
| [**beads**](https://github.com/gastownhall/beads) | Dependency-aware `bd` issue tracker, plus a `PRIME.md` priming guide in the beads config dir |
| Agent permissions | Claude Code `bypassPermissions` (and empty commit/PR attribution), Codex `approval_policy = "never"` + `sandbox_mode = "danger-full-access"`, OpenCode `permission = "allow"`, pi `defaultProjectTrust = "always"` |
| Claude Code context | `CLAUDE_CODE_MAX_CONTEXT_TOKENS=240000` |

Re-running is safe: every step checks the installed version or existing config first and skips what is already in place.

## Project setup

Run inside a git repo to write the per-project conventions and skills. Agent flags are ignored here, because project setup targets every agent:

```bash
npx github:madebymlai/groundwork --project
```

| What | Detail |
|------|--------|
| `AGENTS.md` | Shared [principles and conventions](https://agents.md/) every agent reads; created only if missing |
| `CLAUDE.md` | A one-line `@AGENTS.md` reference, plus a `<code-discovery>` block telling agents to prefer the knowledge graph over grep |
| `.git/info/exclude` | Local-only ignores for the agent config files above, so they never land in a commit |
| `.beads/` | `bd init` when the binary is available |
| Skills | Bundled and curated skills, stored once in `.agents/skills` and symlinked into `.claude/skills`. Codex, OpenCode, and pi read `.agents/skills` directly |

## Bundled skills

Written and versioned in this repo, under [`skills/`](skills/). All four carry the `gw-` prefix so they sort together and never collide with the curated set.

### /gw-setup

Entry point for a repo's written conventions. Asks which writers to run — design principles, coding standards, or both — and whether to run them manually (menus, the user picks every item) or headlessly (the agent selects only what the codebase gives evidence for). Routes to the two writers below; decides nothing itself.

### /gw-beads

Workflow guide for repositories using [beads](https://github.com/gastownhall/beads) as the shared task tracker. Tells agents to use `bd` (not markdown TODOs) for ready-work discovery, atomic claiming, dependency-aware follow-ups, and durable handoff across sessions or contributors.

### /gw-design-principles

Interactive writer for the design section of `AGENTS.md`. Agents pick architecture and design principles from curated catalogs so the conventions are settled before implementation starts, not argued during review.

### /gw-coding-standards

Interactive writer for `CODING_STANDARDS.md`. Helps agents select concrete style and testing rules from curated catalogs so review can enforce them without spending implementation context.

## Curated skills

A pinned subset of [mattpocock/skills](https://github.com/mattpocock/skills) (v1.2.3) installed alongside the bundled ones: the stable engineering and productivity skills such as `/code-review`, `/tdd`, `/diagnosing-bugs`, `/implement`, and `/handoff`. Deprecated, personal, and in-progress skills are deliberately left out. The set lives in `MATTPOCOCK_SKILLS` in [`bin/tools.mjs`](bin/tools.mjs).

## Development

```bash
npm test        # node:test unit suite
npm run check   # syntax check the installer entrypoint
```

## [Awesome libraries](docs/awesome-libraries.md)

One opinionated pick per job: the boring choice that ships, not the trendy one.

- [**Logging**](docs/awesome-libraries.md#logging): structured, low-overhead logging that plays nice with tracing
- [**Transcribers**](docs/awesome-libraries.md#transcribers): hands-free agent prompting by voice
- [**Pre-commit hooks**](docs/awesome-libraries.md#pre-commit-hooks): fast, polyglot gates before a commit lands
- [**Linters & formatters**](docs/awesome-libraries.md#linters--formatters): one fast tool to catch bugs and enforce style

## Candidates

Tools being considered for future inclusion. These are not installed today.

| Area | Tool | Why consider it | Posture |
|------|------|-----------------|---------|
| Token analytics | [**tokscale**](https://github.com/junhoyeo/tokscale) | Multi-agent token and cost dashboard across Claude Code, Codex, OpenCode, Gemini, Cursor, Copilot, Amp, Zed, Goose, and more | Candidate default |
| MCP diagnostics | [**MCP Inspector**](https://github.com/modelcontextprotocol/inspector) | Official UI/CLI debugger for MCP servers, tool schemas, resources, prompts, and config validation | Candidate default |
| Session orchestration | [**Agent Deck**](https://github.com/asheshgoplani/agent-deck) | Tmux-based AI agent command center with worktrees, MCP/skills toggles, status detection, cost dashboard, and sandboxing | Optional |
| Token reduction | [**RTK**](https://github.com/rtk-ai/rtk) | Command-output compaction and savings analytics for many AI coding agents | Optional |
| Session history | [**Agent History**](https://github.com/kvsankar/agent-history) | Local CLI for listing and exporting Claude, Codex, and Gemini sessions across local, WSL, Windows, and SSH homes | Optional |
| Worktree sessions | [**CCManager**](https://github.com/kbwo/ccmanager) | No-tmux TUI for managing AI coding sessions across worktrees with status detection, hooks, devcontainers, and multi-project mode | Optional |
| Parallel workflows | [**parallel-code**](https://github.com/johannesjo/parallel-code) | Desktop GUI for dispatching Claude, Codex, Gemini, and Copilot agents in isolated git worktrees | Optional |
| Usage reports | [**ccusage**](https://github.com/ryoppippi/ccusage) | Mature Claude Code usage analyzer with daily, monthly, session, and 5-hour billing-window reports | Optional |
| Repo packing | [**Repomix**](https://github.com/yamadashy/repomix) | Packs local or remote repos into AI-friendly output with token counts, security checks, compression, and MCP mode | Docs only |
| AI dev workflow | [**compound-engineering**](https://github.com/EveryInc/compound-engineering-plugin) | Plugin for Claude / Codex / OpenCode with brainstorm, plan, review, commit, PR, debug workflows; superseded here by mattpocock/skills | Replaced |
