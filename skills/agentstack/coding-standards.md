# Mode: Coding Standards

Writes project coding standards to `.sandcastle/CODING_STANDARDS.md` for the sandcastle review agent.

## Catalogs

Read all three for the full menu with `> Pick when:` signals:
- [catalogs/STYLE.md](catalogs/STYLE.md) — control flow, error handling, duplication
- [catalogs/TESTING.md](catalogs/TESTING.md) — structure, scope, assertions, reliability
- [catalogs/ARCHITECTURE.md](catalogs/ARCHITECTURE.md) — module boundaries, dependency direction

## Flow

1. **Present** — Show the user each catalog's items, grouped by section. For each item, show the name and one-line definition.
2. **Recommend** — Probe the codebase (`get_architecture`, `search_code`, read linter/formatter configs). Flag items where you see evidence matching the `> Pick when:` signals, but don't hide the rest.
3. **Select** — The user picks which standards they want. They may pick items you didn't recommend, or skip ones you did.

## Write

Write selected standards to `.sandcastle/CODING_STANDARDS.md` grouped by section.
Format: imperative one-liners under each section header.

This file is loaded by the sandcastle reviewer via `@.sandcastle/CODING_STANDARDS.md` — zero token cost during implementation, enforced only during code review.
