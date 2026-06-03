# Architecture Catalog

Structural design decisions that require judgment, applied before and while code is written, not mechanically checkable.

→ Destination: `AGENTS.md` (# Design Principles section)

## Module Boundaries

- **Deep Modules** → Prefer modules with simple interfaces that hide substantial implementation; depth, not a thin pass-through, is what earns a module its interface.
  > Pick when: classes are mostly thin wrappers, the interface is nearly as wide as the implementation, or many tiny single-method classes ("classitis") fragment the logic.

- **Information Hiding** → A design decision (file format, schema, protocol, algorithm) lives in exactly one module; the same knowledge must not surface in modules that then have to change together.
  > Pick when: the same format or assumption is duplicated across modules, or one conceptual change forces edits in several places that each "know" the detail.

- **Tell, Don't Ask** → Tell an object what to do and let it act on its own state, rather than querying its state and deciding on its behalf.
  > Pick when: callers inspect an object's fields to decide what to do, logic that belongs inside a type leaks into its consumers, or feature envy appears across boundaries.

## Coupling

- **Law of Demeter** → Talk only to immediate collaborators: call methods on self, parameters, owned fields, or objects you created; never on objects returned by other calls.
  > Pick when: chains of three or more calls reach through object graphs ("train wrecks"), or a change in a distant class breaks unrelated callers.

### Sources

- [Deep Modules](https://web.stanford.edu/~ouster/cgi-bin/aposd.php) → John Ousterhout, "A Philosophy of Software Design" (2018)
- [Information Hiding](https://en.wikipedia.org/wiki/Information_hiding) → David Parnas (1972); revived as "information leakage" by Ousterhout (2018)
- [Tell, Don't Ask](https://martinfowler.com/bliki/TellDontAsk.html) → Martin Fowler; origin Andy Hunt & Dave Thomas, "The Pragmatic Programmer"
- [Law of Demeter](https://en.wikipedia.org/wiki/Law_of_Demeter) → Karl Lieberherr et al., Demeter Project (1987)
