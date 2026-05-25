# Mode: tokf Filters

Discovers noisy commands and writes tokf compression filters.

## Learn

Fetch https://tokf.net/docs/writing-filters/ to learn the filter authoring format.

## Discover

Run `tokf discover --json` to find commands that ran without filters.
- Results found: propose filters for top noisy commands, one at a time.
- No results: fall back to codebase exploration.

## Codebase exploration

Only if discover found nothing.

1. `get_architecture` — languages, frameworks, build tools, test runners.
2. `search_graph` / `search_code` — build scripts, task definitions, CLI entry points.

Check for commands in:
- package.json scripts, Makefile targets, justfile recipes
- pyproject.toml entry points, Cargo.toml commands
- CI workflow steps, shell scripts in bin/ or scripts/
- Docker Compose service commands

Cross-reference every candidate against `tokf which "[command]"` — skip commands with built-in filters.
Focus on commands producing 10+ lines of output on success.

## Write

For each accepted filter:
- Write to `.tokf/filters/[tool]/[command].toml` using the learned format.
- Verify each with `tokf verify` after writing.
- For noisy commands lacking unique structure, suggest `.tokf/rewrites.toml` entries instead.
