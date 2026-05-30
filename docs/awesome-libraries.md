# Awesome libraries

A curated, opinionated index of best-in-class libraries per domain — chosen for production use in agent stacks, weighing **performance, ergonomics, and maintenance health**. Each index opens with the **profile** it's judged against (the criteria that actually matter for that domain).

Each entry gives the **pick**, a **substitute** (when the pick doesn't fit your shop), and the **mise en place** — the few things to get right when setting it up. Not an exhaustive list.

## Index

- [Logging](#logging)
- [Transcribers](#transcribers)

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

> **Adding an index?** Append a new `##` section here, open it with a one-line **Profile** of the criteria that matter for that domain, keep the pick/substitute/mise-en-place shape, and add a bullet to the [Index](#index). Link it from the README's *Awesome libraries* section.
