# agentstack

Setup tool for AI coding agents. Installs and configures tools across Claude Code, Codex, and OpenCode.

## Install

```bash
npx github:madebymlai/agentstack
```

Skip the interactive selector:

```bash
npx github:madebymlai/agentstack --claude --codex
npx github:madebymlai/agentstack --opencode
```

Project setup only (AGENTS.md, .gitignore):

```bash
npx github:madebymlai/agentstack --project
npx github:madebymlai/agentstack --project --codex
```

## What it does

Prompts you to select which tools you use (Claude Code, Codex, OpenCode), then:

| Tool | Description |
|------|-------------|
| [**tokf**](https://github.com/mpecan/tokf) | Token compression binary + global hooks for selected tools (Linux/MacOS only) |
| [**codebase-memory**](https://github.com/DeusData/codebase-memory-mcp) | Code knowledge graph MCP server for all selected tools |
| [**mattpocock/skills**](https://github.com/mattpocock/skills) | Curated agent skills, installed globally for selected tools via `npx skills@latest add` |
| **AGENTS.md** | Principles template + tokf section |
| **.gitignore** | Ignores .claude/, .codex/, .opencode/, CLAUDE.md, AGENTS.md |

## /agentstack skill

Bundled skill installed globally for all selected tools. Interactive project setup:

- **Principles** - reviews AGENTS.md principles, probes codebase for project-specific additions
- **tokf filters** - discovers noisy commands, writes project-local filters

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
