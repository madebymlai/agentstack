# Mode: Principles

Writes coding principles to the `# Principles` section of AGENTS.md.

## Catalog

Read [catalogs/PRINCIPLES.md](catalogs/PRINCIPLES.md) for the full menu of principles with `> Pick when:` signals.

## Flow

1. **Present** — Show the user the full catalog, grouped by section. For each item, show the name and one-line definition.
2. **Recommend** — Probe the codebase (`get_architecture`, `search_code` for anti-patterns). Flag items where you see evidence matching the `> Pick when:` signals, but don't hide the rest.
3. **Select** — The user picks which principles they want. They may pick items you didn't recommend, or skip ones you did.

## Write

Write selected principles to AGENTS.md.
Format: `- **Name** — Academic definition in 1-2 sentences.`

Keep total principles section under 30 lines.
