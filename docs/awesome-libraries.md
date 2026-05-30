# Awesome libraries

A curated, opinionated index of best-in-class libraries per domain — chosen for production use in agent stacks, weighing **performance, ergonomics, and maintenance health**. Each index opens with the **profile** it's judged against (the criteria that actually matter for that domain).

Each entry gives the **pick**, a **substitute** (when the pick doesn't fit your shop), and the **mise en place** — the few things to get right when setting it up. Not an exhaustive list.

## Index

- [Logging](#logging)
- [Transcribers](#transcribers)
- [Pre-commit hooks](#pre-commit-hooks)
- [Linters & formatters](#linters--formatters)

---

## Logging

**Profile:** structured JSON output · OpenTelemetry trace/span correlation · low overhead / high throughput · stdout-first (12-factor — the platform collects) · clean ergonomics.

| Language | Pick | Substitute | Mise en place — set it up right |
|----------|------|------------|--------------------------------|
| **Python** | [**structlog**](https://github.com/hynek/structlog) (+ [`orjson`](https://github.com/ijl/orjson), [`BytesLoggerFactory`](https://www.structlog.org/en/stable/api.html#structlog.BytesLoggerFactory)) | [stdlib `logging`](https://docs.python.org/3/library/logging.html) + [python-json-logger](https://github.com/nhairs/python-json-logger) | Wire `orjson` + `BytesLoggerFactory` directly (not via stdlib `ProcessorFormatter`). Add a `trace_id`/`span_id` processor; set context in the same sync/async scope you log from. |
| **Java** | [**SLF4J 2.x**](https://www.slf4j.org/) + [**Log4j2**](https://logging.apache.org/log4j/2.x/) — Disruptor async loggers + JSON Template Layout | [Logback](https://logback.qos.ch/) + [Spring Boot 3.4 structured logging](https://spring.io/blog/2024/08/23/structured-logging-in-spring-boot-3-4/) | Enable async loggers (Disruptor) + JSON Template Layout. Add the [OTel Java agent](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/docs/logger-mdc-instrumentation.md) for MDC `trace_id`/`span_id`. Pin latest 2.x. |
| **Rust** | [**tracing**](https://github.com/tokio-rs/tracing) + [**tracing-subscriber**](https://docs.rs/tracing-subscriber) + [**tracing-bunyan-formatter**](https://github.com/LukeMathWalker/tracing-bunyan-formatter) + [tracing-opentelemetry](https://crates.io/crates/tracing-opentelemetry) | [fastrace](https://github.com/fast/fastrace) (tracing-only, tail-sampling) | Init `tracing-subscriber` (Registry + `tracing-bunyan-formatter` JSON) in `main` before any logging; verify a test line hits stdout. Use `#[instrument]`, never `span.enter()` across `.await`. Pin exact OTel versions. |
| **JS / TS** (Node) | [**Pino**](https://github.com/pinojs/pino) + [`@opentelemetry/instrumentation-pino`](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-pino) | [Winston](https://github.com/winstonjs/winston) | JSON to stdout. Add `@opentelemetry/instrumentation-pino`. Flush on shutdown. |
| **JS / TS** (non-Node: Deno, Bun, browser, edge) | [**LogTape**](https://github.com/dahlia/logtape) | tslog / roarr | Use LogTape's core + per-runtime sinks. Pin a version. |

### The unifying pattern (all languages)

Emit **JSON → stdout**, inject OTel `trace_id`/`span_id` into every line, and let the collector or agent handle export. This gives you identical, correlatable logs across a polyglot stack even though each language uses a different library.

- Trace **correlation** (IDs in the log line) is mature *today* in every language above.
- Full **log-as-OTLP** export SDKs are still pre-1.0 across the board — don't block on them; ship correlation now.
- **Auto-instrumentation agents** inject the IDs for free: the OpenTelemetry Java agent auto-populates MDC (`trace_id`, `span_id`, `trace_flags`); Python and JS auto-instrumentation do the same.

### Two contrarian cases worth taking seriously

1. **Java → Logback + Spring Boot 3.4 native structured logging.** On Boot 3.4+ and not provably logging-bound? `logging.structured.format.console=ecs` + the OTel Java agent gives you JSON, trace correlation, and clean ergonomics with less config and no Log4Shell optics. Adopt Log4j2 only when profiling proves logging is your bottleneck (YAGNI).
2. **Python → stdlib `logging` + `python-json-logger` + OTel `LoggingHandler`.** For a stdout-first 12-factor app, staying on the universally-supported path sidesteps structlog's single-maintainer lock-in. structlog wins on ergonomics; stdlib wins on "boring" and bus-factor.

### Sources

Picks were validated against per-language deep research (2026):

- **Python** — [Dash0](https://www.dash0.com/guides/python-logging-libraries) · [Better Stack](https://betterstack.com/community/guides/logging/best-python-logging-libraries/) · [structlog performance](https://www.structlog.org/en/stable/performance.html)
- **Java** — [Log4j2 async](https://logging.apache.org/log4j/2.x/manual/async.html) · [Log4j2 garbage-free](https://logging.apache.org/log4j/2.x/manual/garbagefree.html) · [OTel logger-MDC](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/docs/logger-mdc-instrumentation.md) · [Spring Boot 3.4 structured logging](https://spring.io/blog/2024/08/23/structured-logging-in-spring-boot-3-4/)
- **Rust** — [tracing docs](https://docs.rs/tracing) · [fastrace](https://github.com/fast/fastrace) · [tracing-bunyan-formatter](https://github.com/LukeMathWalker/tracing-bunyan-formatter) · [opentelemetry-rust releases](https://github.com/open-telemetry/opentelemetry-rust/releases)
- **TS / JS** — [Pino benchmarks](https://github.com/pinojs/pino/blob/main/docs/benchmarks.md) · [LogTape comparison](https://logtape.org/comparison) · [Sentry — JS logging 2026 guide](https://blog.sentry.io/javascript-logging-library-definitive-guide/) · [instrumentation-pino](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-pino)

---

## Transcribers

Speech-to-text for hands-free agent prompting — dictate instead of type.

**Profile:** low dictation latency · accuracy on technical/code speech · local vs cloud (privacy + offline) · clean push-to-talk ergonomics.

| Pick | Mise en place — set it up right |
|------|--------------------------------|
| [**hyprwhspr**](https://github.com/goodroot/hyprwhspr) — Linux push-to-talk dictation that fronts a swappable transcriber backend (local whisper.cpp / faster-whisper / Parakeet, or cloud Groq / OpenAI / Gemini / Cohere over REST or WebSocket) | Linux/Wayland. Pick a backend: local for privacy/offline, cloud for accuracy. |

---

## Pre-commit hooks

Run linters/formatters on staged files before a commit lands.

**Profile:** fast (parallel) · polyglot / no language lock-in · single config · minimal runtime deps · small supply-chain surface.

These two aren't substitutes — they answer different questions. **Lefthook runs *your* commands fast; prek runs *the community's* hooks fast.** Pick by whether you want to own the toolchain or consume a catalog.

| Tool | Use it when | Mise en place |
|------|-------------|---------------|
| [**Lefthook**](https://github.com/evilmartians/lefthook) | You want to run **your own toolchain** (ruff, eslint, cargo…) fast, with a small attack surface (local commands) and a stable 1.0+ API. | Commit `lefthook.yml`; run `lefthook install` in setup; gate with `glob` + `{staged_files}`. |
| [**prek**](https://github.com/j178/prek) | You want the **pre-commit community catalog** (secret/lint/scan hooks) — Rust drop-in, reads `.pre-commit-config.yaml`, 4–10× faster than `pre-commit`, no Python. | Drop in `.pre-commit-config.yaml` (reuses existing pre-commit config unchanged); pin the version — pre-1.0, breaking changes between minors. |

For a pure-Node shop that wants the default instead, [husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged) is fine. Watch [hk](https://github.com/jdx/hk) (Rust) — file-level locking guards against parallel-fixer races.

---

## Linters & formatters

Catch bugs and enforce style — ideally one fast tool, not five.

**Profile:** fast · consolidated (fewer tools) · clean single config · good defaults.

The 2026 trend is **consolidation** — one Rust tool replacing a pile of them (Ruff, oxlint/Biome). Java is the exception: still a multi-tool JVM stack. Note two things stay *separate* concerns: a **type checker** (Python) and **type-aware lint rules** (TS).

| Language | Linter | Formatter | Mise en place |
|----------|--------|-----------|---------------|
| **Python** | [**Ruff**](https://github.com/astral-sh/ruff) (replaces flake8 + isort + pyupgrade…) | **Ruff** (same binary, ~99.9% Black-compatible) | `ruff check` + `ruff format`, one config in `pyproject.toml`. Add a type checker (mypy, or Astral's [`ty`](https://github.com/astral-sh/ty) — beta) and [Bandit](https://github.com/PyCQA/bandit) in CI for framework security. No plugin system — custom rules need Rust. |
| **JS / TS** | [**oxlint**](https://github.com/oxc-project/oxc) (fast pre-pass) **+ [ESLint](https://eslint.org/)** for the long tail | [**Biome**](https://biomejs.dev/) (or [Prettier](https://prettier.io/)) | Run oxlint first; keep [typescript-eslint](https://typescript-eslint.io/) for 100%-correct **type-aware** rules until oxlint's `--type-aware` (tsgolint) stabilizes. Biome formatter is ~97% Prettier-compatible. |
| **Java** | [**Error Prone**](https://errorprone.info/) + [**NullAway**](https://github.com/uber/NullAway) (+ [Checkstyle](https://checkstyle.org/), optional) | [**Spotless**](https://github.com/diffplug/spotless) → [Palantir Java Format](https://github.com/palantir/palantir-java-format) | Spotless `apply` (Palantir engine) + `ratchet` for changed files; Error Prone + NullAway with [JSpecify](https://jspecify.dev/) annotations. Tune Error Prone severity or it floods. Checkstyle only for non-format rules. |
| **Rust** | [**Clippy**](https://doc.rust-lang.org/clippy/) | [**rustfmt**](https://github.com/rust-lang/rustfmt) | `cargo clippy --all-targets --all-features -- -D warnings`; set levels in `[lints.clippy]` (pedantic = warn, `priority = -1`). Add [cargo-deny](https://github.com/EmbarkStudios/cargo-deny) for advisories/licenses. Pin the toolchain — new lints break green builds. |

> **Single-vendor note:** Ruff, `ty`, and `uv` are all by Astral (acquired by OpenAI in 2026). Tools stay open source and forkable, but it concentrates Python tooling under one vendor.

---

> **Adding an index?** Append a new `##` section here, open it with a one-line **Profile** of the criteria that matter for that domain, keep a consistent shape (pick/substitute/mise-en-place, or a domain-appropriate variant like linter/formatter), and add a bullet to the [Index](#index). Link it from the README's *Awesome libraries* section.
