# Design Catalog

Pre-implementation design decisions that require judgment — not mechanically checkable.

→ Destination: `AGENTS.md` (# Design Principles section)

## Module Design

- **SRP** — A module should have one, and only one, reason to change: responsible to one actor.
  > Pick when: modules mix unrelated concerns, a change in one feature breaks another, or a class serves multiple actors.

- **OCP** — Software entities should be open for extension but closed for modification.
  > Pick when: adding features requires editing existing working code, switch statements grow with each new variant, or plugin/strategy patterns would eliminate modification.

- **LSP** — Objects of a supertype shall be replaceable with objects of a subtype without altering program correctness.
  > Pick when: subclasses override behavior in ways that surprise callers, downcasts appear in consuming code, or inheritance hierarchies violate parent expectations.

- **ISP** — No client should be forced to depend on methods it does not use; prefer many client-specific interfaces over one general-purpose interface.
  > Pick when: interfaces have methods most implementors stub out, consumers depend on large objects but only use a fraction, or mock setup is painful because of unused surface area.

- **DIP** — High-level modules should not depend on low-level modules — both should depend on abstractions; abstractions should not depend on details.
  > Pick when: business logic imports infrastructure directly, swapping a database or API client requires touching core code, or testing requires standing up real dependencies.

- **Composition Over Inheritance** — Default to composition; use inheritance only when the subtype genuinely satisfies LSP and the hierarchy is closed to further extension.
  > Pick when: class hierarchies deepen beyond two levels, subclasses override parent behavior in surprising ways, or reuse is achieved by inheriting from a concrete class.

- **Command-Query Separation** — Every method should either be a command that performs an action or a query that returns data, but never both.
  > Pick when: methods both mutate state and return values, calling a getter produces side effects, or asking a question changes the answer.

## Meta

- **KISS** — Every system works best when simplicity is a key goal and unnecessary complexity is avoided.
  > Pick when: abstractions exist without concrete need, code is clever instead of clear, or three simple lines would replace a generic framework.

- **YAGNI** — Do not introduce abstractions, parameters, or code paths that serve no current caller. If no concrete use case exercises it today, delete it.
  > Pick when: speculative features sit unused, parameters exist "just in case," or abstractions have a single implementation with no planned second. Note: Forward-First wins for contract surfaces (APIs, schemas, wire formats); YAGNI wins for internal implementation.

- **Forward-First** — Design for the current and next contract version; never introduce backward-compatibility shims or legacy code paths that increase maintenance surface.
  > Pick when: deprecated code paths accumulate, backward-compat shims outnumber active code, or migration cost grows with each deferred cleanup. Note: applies to contract surfaces; for internal implementation, defer to YAGNI.

## Domain Modeling

- **No Primitive Obsession** — Represent domain concepts as named types rather than raw strings, numbers, or booleans. A customer ID is not a string; a price is not a float.
  > Pick when: functions accept raw strings/ints that represent domain concepts, type signatures don't distinguish between an email and a username, or invalid values pass type checks silently.

## Robustness

- **Define Errors Out of Existence** — Design APIs so that routine edge cases are not errors at all (return empty, clamp, no-op) rather than pushing exceptions onto every caller.
  > Pick when: callers must wrap ordinary calls in try/catch for non-exceptional cases, the same null/empty special-case is repeated everywhere, or an "error" is really just an uninteresting boundary condition.

- **No Defensive Garbage** — Trust established preconditions and module contracts; let violated invariants surface as immediate failures instead of masking them with silent fallbacks.
  > Pick when: null checks and default fallbacks mask upstream bugs, defensive code hides the real source of errors, or functions silently return wrong results instead of failing.

### Sources

- [SRP](https://web.archive.org/web/20150924054349/http://www.objectmentor.com/resources/articles/Principles_and_Patterns.pdf) — Robert C. Martin, "Design Principles and Design Patterns" (2000)
- [OCP](https://en.wikipedia.org/wiki/Open%E2%80%93closed_principle) — Bertrand Meyer, "Object-Oriented Software Construction" (1988)
- [LSP](https://en.wikipedia.org/wiki/Liskov_substitution_principle) — Barbara Liskov, "Data Abstraction and Hierarchy" (1987)
- [ISP](https://en.wikipedia.org/wiki/Interface_segregation_principle) — Robert C. Martin, SOLID principles
- [DIP](https://en.wikipedia.org/wiki/Dependency_inversion_principle) — Robert C. Martin, SOLID principles
- [Composition Over Inheritance](https://en.wikipedia.org/wiki/Composition_over_inheritance) — Gang of Four, "Design Patterns" (1994)
- [Command-Query Separation](https://en.wikipedia.org/wiki/Command%E2%80%93query_separation) — Bertrand Meyer, "Object-Oriented Software Construction" (1988)
- [KISS](https://en.wikipedia.org/wiki/KISS_principle) — U.S. Navy design principle (1960), attributed to Kelly Johnson
- [YAGNI](https://en.wikipedia.org/wiki/You_aren%27t_gonna_need_it) — Ron Jeffries, Extreme Programming (1999)
- [Forward-First](https://en.wikipedia.org/wiki/Forward_compatibility) — general engineering principle
- [No Primitive Obsession](https://wiki.c2.com/?PrimitiveObsession) — Martin Fowler, "Refactoring" (1999)
- [Define Errors Out of Existence](https://web.stanford.edu/~ouster/cgi-bin/aposd.php) — John Ousterhout, "A Philosophy of Software Design" (2018)
- [No Defensive Garbage](https://wiki.c2.com/?OffensiveProgramming) — Offensive Programming, c2 wiki
