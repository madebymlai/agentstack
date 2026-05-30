<p align="center">
  <a href="docs/agent-stack-flow.html">
    <img src="docs/assets/agent-stack.png?v=3" alt="agentstack — set up your coding agents with one command" width="830">
  </a>
</p>

See [`docs/agent-stack-flow.html`](docs/agent-stack-flow.html) for the full walkthrough of what gets installed and how the pieces fit together.

## Install

```bash
npx github:madebymlai/agentstack
```

Skip the interactive selector:

```bash
npx github:madebymlai/agentstack --claude --codex
npx github:madebymlai/agentstack --opencode
```

Project setup only (AGENTS.md, CLAUDE.md, `.git/info/exclude` — tool flags ignored):

```bash
npx github:madebymlai/agentstack --project
```

Re-run `sandcastle init` from scratch by wiping `.sandcastle/` first. Your customized `.sandcastle/CODING_STANDARDS.md` is preserved across the rebuild by default; add `--clean` for a full wipe that regenerates it from the template too:

```bash
npx github:madebymlai/agentstack --project --rebuild           # or -r; wipe .sandcastle/ and re-init, keeping CODING_STANDARDS.md
npx github:madebymlai/agentstack --project --rebuild --clean   # or -rc; full wipe, including CODING_STANDARDS.md
```

## afk

Once installed, `afk` is a bare shell command (served onto your PATH with per-OS launchers — POSIX `sh` on Linux/macOS, `.cmd` on Windows). Run it from a project that has been set up with `--project`:

```bash
afk            # runs npx tsx .sandcastle/main.ts in the current project
afk --foo bar  # extra args are forwarded to the run
```

It launches the sandcastle parallel-planner loop so you can step away from the keyboard. If `.sandcastle/` hasn't been set up yet, it fails fast and points you at `npx github:madebymlai/agentstack --project`.

## What it does

Prompts you to pick the agents you use (Claude Code, Codex, OpenCode), then installs and configures each of these for them:

| Tool | Description |
|------|-------------|
| [**tokf**](https://github.com/mpecan/tokf) | Compresses noisy command output to save tokens |
| [**codebase-memory**](https://github.com/DeusData/codebase-memory-mcp) | Code knowledge-graph MCP server for navigating the codebase |
| [**mattpocock/skills**](https://github.com/mattpocock/skills) | Curated, reusable agent skills |
| [**beads**](https://github.com/gastownhall/beads) | Dependency-aware `bd` issue tracker |
| [**pi**](https://github.com/earendil-works/pi-mono) | Minimal coding agent, the default sandcastle executor |
| [**sandcastle**](https://github.com/mattpocock/sandcastle) | Sandboxed agent orchestration |
| [**AGENTS.md**](https://agents.md/) | Shared principles and conventions for every agent |
| [**.git/info/exclude**](https://git-scm.com/docs/gitignore) | Local-only ignores for agent config files |

## Built-in skills

Bundled skills installed globally for every selected tool.

### /agentstack

Drives an interactive Q&A — propose, you accept or reject. If `tokf` is installed, you choose principles, filters, or both; otherwise it runs principles-only:

- **Principles** — probes the codebase (languages, frameworks, anti-patterns) and proposes additions; writes accepted ones to AGENTS.md's `# Principles` section
- **tokf filters** — runs `tokf discover` to find noisy commands, falls back to scanning build scripts (package.json, Makefile, justfile, pyproject.toml, etc.); writes per-command filters under `.tokf/filters/` or rewrites to `.tokf/rewrites.toml`

### /beads

Workflow guide for repositories using [beads](https://github.com/gastownhall/beads) as the shared task tracker. Tells agents to use `bd` (not markdown TODOs) for ready-work discovery, atomic claiming, dependency-aware follow-ups, and durable handoff across sessions or contributors.

## [Awesome libraries](docs/awesome-libraries.md)

One opinionated pick per job — the boring choice that ships, not the trendy one.

- [**Logging**](docs/awesome-libraries.md#logging) — structured, low-overhead logging that plays nice with tracing
- [**Transcribers**](docs/awesome-libraries.md#transcribers) — hands-free agent prompting by voice
- [**Pre-commit hooks**](docs/awesome-libraries.md#pre-commit-hooks) — fast, polyglot gates before a commit lands
- [**Linters & formatters**](docs/awesome-libraries.md#linters--formatters) — one fast tool to catch bugs and enforce style

## Candidates

Tools being considered for future inclusion. These are not installed today.

| Area | Tool | Why consider it | Posture |
|------|------|-----------------|---------|
| Token analytics | [**tokscale**](https://github.com/junhoyeo/tokscale) | Multi-agent token and cost dashboard across Claude Code, Codex, OpenCode, Gemini, Cursor, Copilot, Amp, Zed, Goose, and more | Candidate default |
| MCP diagnostics | [**MCP Inspector**](https://github.com/modelcontextprotocol/inspector) | Official UI/CLI debugger for MCP servers, tool schemas, resources, prompts, and config validation | Candidate default |
| Session orchestration | [**Agent Deck**](https://github.com/asheshgoplani/agent-deck) | Tmux-based AI agent command center with worktrees, MCP/skills toggles, status detection, cost dashboard, and sandboxing | Optional |
| Token reduction | [**RTK**](https://github.com/rtk-ai/rtk) | Command-output compaction and savings analytics for many AI coding agents; overlaps with tokf | Alternative to tokf |
| Session history | [**Agent History**](https://github.com/kvsankar/agent-history) | Local CLI for listing and exporting Claude, Codex, and Gemini sessions across local, WSL, Windows, and SSH homes | Optional |
| Worktree sessions | [**CCManager**](https://github.com/kbwo/ccmanager) | No-tmux TUI for managing AI coding sessions across worktrees with status detection, hooks, devcontainers, and multi-project mode | Optional |
| Parallel workflows | [**parallel-code**](https://github.com/johannesjo/parallel-code) | Desktop GUI for dispatching Claude, Codex, Gemini, and Copilot agents in isolated git worktrees | Optional |
| Usage reports | [**ccusage**](https://github.com/ryoppippi/ccusage) | Mature Claude Code usage analyzer with daily, monthly, session, and 5-hour billing-window reports | Optional |
| Repo packing | [**Repomix**](https://github.com/yamadashy/repomix) | Packs local or remote repos into AI-friendly output with token counts, security checks, compression, and MCP mode | Docs only |
| AI dev workflow | [**compound-engineering**](https://github.com/EveryInc/compound-engineering-plugin) | Plugin for Claude / Codex / OpenCode with brainstorm, plan, review, commit, PR, debug workflows; superseded here by mattpocock/skills | Replaced |
