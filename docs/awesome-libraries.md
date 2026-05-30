# Awesome libraries

A curated, opinionated index of best-in-class libraries per domain — chosen for production use in agent stacks, weighing **performance, ergonomics, and maintenance health**. Each index opens with the **profile** it's judged against (the criteria that actually matter for that domain).

Each entry gives the **pick**, a **runner-up**, and the **one caveat** worth knowing before you commit — not an exhaustive list. Contrarian alternatives are called out where the "obvious" winner isn't right for every shop.

## Index

- [Logging](#logging)
- [Transcribers](#transcribers)

---

## Logging

**Profile:** structured JSON output · OpenTelemetry trace/span correlation · low overhead / high throughput · stdout-first (12-factor — the platform collects) · clean ergonomics.

| Language | Pick | Runner-up | Caveat worth knowing |
|----------|------|-----------|----------------------|
| **Python** | [**structlog**](https://github.com/hynek/structlog) (+ [`orjson`](https://github.com/ijl/orjson), [`BytesLoggerFactory`](https://www.structlog.org/en/stable/api.html#structlog.BytesLoggerFactory)) | [stdlib `logging`](https://docs.python.org/3/library/logging.html) + [python-json-logger](https://github.com/nhairs/python-json-logger) | Fast path bypasses stdlib — routing through `ProcessorFormatter` for ecosystem compat loses the perf. `contextvars` don't cross the sync↔async boundary. Bus-factor ~1. (`picologging` is stalled — avoid.) |
| **Java** | [**SLF4J 2.x**](https://www.slf4j.org/) + [**Log4j2**](https://logging.apache.org/log4j/2.x/) — Disruptor async loggers + JSON Template Layout | [Logback](https://logback.qos.ch/) + [Spring Boot 3.4 structured logging](https://spring.io/blog/2024/08/23/structured-logging-in-spring-boot-3-4/) | Throughput edge over Logback is real only *under thread contention* (lock-free ring buffer vs blocking queue). "Garbage-free" is low-alloc, not zero — stack traces always allocate. Log4Shell remains a supply-chain/optics drag; pin the latest 2.x. |
| **Rust** | [**tracing**](https://github.com/tokio-rs/tracing) + [**tracing-bunyan-formatter**](https://github.com/LukeMathWalker/tracing-bunyan-formatter) + [tracing-opentelemetry](https://crates.io/crates/tracing-opentelemetry) | [fastrace](https://github.com/fast/fastrace) (tracing-only, tail-sampling) | Use the bunyan formatter — stock `tracing-subscriber` JSON has [no span-field inheritance](https://github.com/tokio-rs/tracing/issues/218). Never hold `span.enter()` across `.await`; use `#[instrument]`. Pin exact OTel versions (churns every release; traces SDK still pre-1.0). |
| **JS / TS** (Node) | [**Pino**](https://github.com/pinojs/pino) + [`@opentelemetry/instrumentation-pino`](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-pino) | [Winston](https://github.com/winstonjs/winston) | ~2.3× Winston in [Pino's canonical micro-bench](https://github.com/pinojs/pino/blob/main/docs/benchmarks.md) (not the folklore "5–8×"). Async transport can drop logs on crash before the worker boots — flush on shutdown. TS types are a known gripe. |
| **JS / TS** (non-Node: Deno, Bun, browser, edge) | [**LogTape**](https://github.com/dahlia/logtape) | tslog / roarr | The cross-runtime differentiator: Pino degrades badly off-Node (Bun, edge, browser) and its worker transports break on Cloudflare Workers. LogTape is zero-dependency and runs everywhere — but 1.0 is recent and benchmarks are self-reported. |

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

| Pick | Caveat worth knowing |
|------|----------------------|
| [**hyprwhspr**](https://github.com/goodroot/hyprwhspr) — Linux push-to-talk dictation that fronts a swappable transcriber backend (local whisper.cpp / faster-whisper / Parakeet, or cloud Groq / OpenAI / Gemini / Cohere over REST or WebSocket) | Linux-first (Wayland/Hyprland-friendly). It's a *frontend* — your latency, accuracy, and privacy come from whichever backend you wire up. |

---

> **Adding an index?** Append a new `##` section here, open it with a one-line **Profile** of the criteria that matter for that domain, keep the pick/runner-up/caveat shape, and add a bullet to the [Index](#index). Link it from the README's *Awesome libraries* section.
