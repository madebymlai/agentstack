# Containerfile recipes

Per-language blocks to insert **before** the `USER ${AGENT_UID}:${AGENT_GID}`
line. Each leads with a `# maintain: <lang>` anchor (skip if already present).

Conventions used by every recipe:

- **System-wide install** under `/usr/local`, so the runtime `agent` user finds
  it regardless of `$HOME`.
- **`chmod -R a+w`** on caches, so the non-root agent can read and extend them.
- **DEPS pre-fetch** copies manifests to `/tmp/deps`, never the project root: at
  runtime the worktree is bind-mounted over `/home/agent/workspace`, so an
  in-tree install would be shadowed. The downloaded packages land in the
  system-wide cache, which is *not* shadowed — so tests run offline.
- Replace `<PIN>` with the version from the project's pin file (`go.mod`'s `go`
  directive, `rust-toolchain.toml`, `.tool-versions`, etc.). Omit the version to
  get the latest stable.

## Rust (`Cargo.toml`)

```dockerfile
# maintain: rust
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
      sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable && \
    chmod -R a+w "$RUSTUP_HOME" "$CARGO_HOME"
# deps (only if Cargo.lock exists; also COPY rust-toolchain.toml if the repo pins one)
COPY Cargo.toml Cargo.lock /tmp/deps/
RUN cd /tmp/deps && cargo fetch && chmod -R a+w "$CARGO_HOME"
```

## Python (`pyproject.toml` / `requirements.txt`)

Debian marks the system Python externally-managed (PEP 668), so install into a
shared venv rather than `--break-system-packages`.

```dockerfile
# maintain: python
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip && rm -rf /var/lib/apt/lists/* && \
    python3 -m venv /usr/local/pyenv && chmod -R a+w /usr/local/pyenv
ENV PATH=/usr/local/pyenv/bin:$PATH
# deps — requirements.txt:
COPY requirements.txt /tmp/deps/
RUN pip install --no-cache-dir -r /tmp/deps/requirements.txt
# deps — pyproject (uv): RUN pip install uv && uv pip install --system -r pyproject.toml
# ensure the test runner is present if it isn't a declared dep: RUN pip install pytest
```

## Go (`go.mod`)

```dockerfile
# maintain: go
ENV GOPATH=/usr/local/gopath GOMODCACHE=/usr/local/gopath/pkg/mod \
    PATH=/usr/local/go/bin:/usr/local/gopath/bin:$PATH
RUN curl -fsSL "https://go.dev/dl/go<PIN>.linux-$(dpkg --print-architecture).tar.gz" \
      | tar -C /usr/local -xz && mkdir -p "$GOPATH" && chmod -R a+w /usr/local/go "$GOPATH"
# deps
COPY go.mod go.sum /tmp/deps/
RUN cd /tmp/deps && go mod download && chmod -R a+w "$GOMODCACHE"
```

## Java — Maven (`pom.xml`)

```dockerfile
# maintain: java
RUN apt-get update && apt-get install -y --no-install-recommends default-jdk maven && \
    rm -rf /var/lib/apt/lists/* && mkdir -p /usr/local/m2 && chmod -R a+w /usr/local/m2
ENV MAVEN_OPTS="-Dmaven.repo.local=/usr/local/m2"
# deps
COPY pom.xml /tmp/deps/
RUN cd /tmp/deps && mvn -B -q -Dmaven.repo.local=/usr/local/m2 dependency:go-offline && \
    chmod -R a+w /usr/local/m2
```

Gradle: install `gradle`, set `GRADLE_USER_HOME=/usr/local/gradle` (a+w), and
`COPY build.gradle settings.gradle /tmp/deps/ && gradle --no-daemon dependencies`.

## Dart (`pubspec.yaml`)

```dockerfile
# maintain: dart
RUN apt-get update && apt-get install -y --no-install-recommends gnupg apt-transport-https wget && \
    wget -qO- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/dart.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/dart.gpg] https://storage.googleapis.com/download.dartlang.org/linux/debian stable main" > /etc/apt/sources.list.d/dart.list && \
    apt-get update && apt-get install -y dart && rm -rf /var/lib/apt/lists/*
ENV PUB_CACHE=/usr/local/pub-cache PATH=/usr/lib/dart/bin:$PATH
RUN mkdir -p /usr/local/pub-cache && chmod -R a+w /usr/local/pub-cache
# deps
COPY pubspec.yaml pubspec.lock /tmp/deps/
RUN cd /tmp/deps && dart pub get && chmod -R a+w /usr/local/pub-cache
```

## Flutter (`pubspec.yaml` with `sdk: flutter`)

Not the same as Dart: Flutter bundles its own Dart SDK, so install the whole
(heavier) Flutter SDK and use `flutter`, not the `dart` package. Use this recipe
when `pubspec.yaml` declares a Flutter dependency (`sdk: flutter`) or an
`environment: flutter:` constraint; otherwise use the plain Dart recipe above.

```dockerfile
# maintain: flutter
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl unzip xz-utils ca-certificates && rm -rf /var/lib/apt/lists/*
ENV FLUTTER_HOME=/usr/local/flutter PUB_CACHE=/usr/local/pub-cache \
    PATH=/usr/local/flutter/bin:/usr/local/flutter/bin/cache/dart-sdk/bin:$PATH
RUN git clone --depth 1 -b stable https://github.com/flutter/flutter.git /usr/local/flutter && \
    git config --global --add safe.directory /usr/local/flutter && \
    flutter --version && flutter precache && \
    mkdir -p /usr/local/pub-cache && chmod -R a+w /usr/local/flutter /usr/local/pub-cache
# deps
COPY pubspec.yaml pubspec.lock /tmp/deps/
RUN cd /tmp/deps && flutter pub get && chmod -R a+w /usr/local/pub-cache
```

Notes: the SDK clone is large — pin a version by cloning a tag (`-b 3.x.y`)
instead of `stable`. `chmod -R a+w` on `/usr/local/flutter` is required because
Flutter writes into its own `bin/cache` on first run as the agent user. The test
command is `flutter test`, not `dart test`.

## Node (`package.json`)

Usually **nothing to add** — the `node:22-bookworm` base image already provides
`node`/`npm`, and dependencies reach the worktree via `copyToWorktree`
(`node_modules`) plus the runtime `npm install`. A build-time `npm ci` would be
shadowed by the worktree bind mount. Only add a toolchain block if the project
needs a *different* runtime (e.g. Bun) — install it system-wide like the others.

<a id="verify"></a>
## Verify

```bash
# 1. rebuild from the patched Containerfile
npx @ai-hero/sandcastle podman build-image

# 2. confirm the toolchain resolves for the agent user (image tag = sandcastle:<project>)
podman run --rm --entrypoint cargo  sandcastle:<project> --version
podman run --rm --entrypoint python sandcastle:<project> --version

# 3. (optional) run the project's tests in the container — should pass offline
podman run --rm -v "$PWD:/home/agent/workspace" -w /home/agent/workspace \
  --entrypoint sh sandcastle:<project> -c 'cargo test'   # or pytest / go test / mvn test
```

If step 2 fails with "not found", the install went to `$HOME` instead of
`/usr/local`, or landed after the `USER` line — move it before `USER` and keep
it system-wide.
