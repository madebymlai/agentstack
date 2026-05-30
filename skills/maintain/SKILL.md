---
name: maintain
description: Inspect a project's toolchain/dependency files and patch .sandcastle/Containerfile so the sandboxed agent can run the project's tests. Use when the sandcastle container is missing a language runtime or dependencies, when `cargo`/`pytest`/`go test`/`mvn` is "not found" in the sandbox, or when the user asks to maintain the Containerfile, provision the sandbox toolchain, or make tests runnable in the container.
argument-hint: ""
---

<purpose>
Provision toolchains and dependencies at IMAGE BUILD TIME by editing
`.sandcastle/Containerfile`, so the agent running inside the sandcastle podman
sandbox can run the project's tests reliably — no slow, timeout-prone runtime
installs, and deps are baked into bounded image layers.
</purpose>

<rules>
- Build time only. Install toolchains and pre-fetch deps in the Containerfile,
  never via a runtime hook (heavy toolchains time out the onSandboxReady hook).
- Toolchain installs run as root, system-wide (/usr/local), and MUST be inserted
  BEFORE the `USER ${AGENT_UID}:${AGENT_GID}` line. Make caches world-writable
  (`chmod -R a+w`) so the non-root agent user can use and extend them.
- Detect, don't assume. Only add a language's block if its marker file exists.
- Idempotent. Anchor each block with a `# maintain: <lang>` comment; skip if it
  is already present. Never duplicate a block on re-run.
- Don't break the build. Keep the existing FROM/USER/WORKDIR/ENTRYPOINT intact;
  only insert before the USER line.
- Always rebuild when done. Containerfile edits do nothing until the image is
  rebuilt, and sandcastle never auto-rebuilds — so the final action is always
  `npx @ai-hero/sandcastle podman build-image`. Never finish on an edit alone.
</rules>

<phase name="detect">
Scan the project root for marker files → languages to provision:
- `Cargo.toml` → Rust
- `pyproject.toml` / `requirements.txt` / `Pipfile` → Python
- `go.mod` → Go
- `pom.xml` / `build.gradle[.kts]` → Java
- `pubspec.yaml` → Flutter if it declares `sdk: flutter` / `environment: flutter:`, else plain Dart (different SDK — see recipes)
- `package.json` → Node (runtime already in the base image; deps via
  copyToWorktree — usually nothing to add)

Also read existing toolchain pins so the install matches: `rust-toolchain.toml`,
`.tool-versions`, `.nvmrc`/`.node-version`, `.python-version`, `go.mod`'s `go`
directive. Report what you found before editing.
</phase>

<phase name="plan">
For each detected language, pick the recipe from [RECIPES.md](RECIPES.md). A
recipe has two parts: a TOOLCHAIN block (install runtime + tools) and a DEPS
block (COPY the manifests to /tmp and pre-fetch into the system-wide cache).
Confirm the plan with the user — list the languages and pinned versions.
</phase>

<phase name="edit">
Read `.sandcastle/Containerfile`. For each language not already marked:
1. Insert its TOOLCHAIN + DEPS block immediately before the
   `USER ${AGENT_UID}:${AGENT_GID}` line (root context, after the base setup).
2. Lead each block with `# maintain: <lang>` so re-runs are idempotent.
Use the existing `ARG AGENT_UID/AGENT_GID` already declared above the USER line.
</phase>

<phase name="build">
ALWAYS run, as the final step, so the edits take effect:

    npx @ai-hero/sandcastle podman build-image

This is mandatory, not optional — a patched Containerfile has zero effect until
the image is rebuilt, and sandcastle does not rebuild on its own. Wait for it to
finish and report success or the build error. If it fails, surface the error —
do not leave a half-patched, unbuilt Containerfile.
</phase>

<phase name="verify">
After the build succeeds, smoke-test in the sandbox — see
[RECIPES.md](RECIPES.md#verify):
1. `podman run --rm --entrypoint <tool> sandcastle:<image> --version` to confirm
   the toolchain resolves for the agent user.
2. If quick, run the project's test command in the container and confirm it
   passes offline (deps were pre-fetched).
Report the result.
</phase>
