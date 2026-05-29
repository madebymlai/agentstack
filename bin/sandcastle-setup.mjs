// Sandcastle project setup: scaffold .sandcastle/ via `sandcastle init`, then patch the
// generated template to this project's conventions — the ~/.pi/agent mount, .beads in the
// worktree, project-agnostic test prompts, and polyglot toolchain provisioning via mise.
//
// Toolchains are provisioned with mise (jdx): the Containerfile installs mise and bakes the
// project's pinned toolchain into image layers at build time (bounded by `podman image prune`,
// no per-worktree re-download). Project deps install at runtime through one bounded pkg-cache
// mount with an age-based prune step — so neither toolchains nor caches grow without bound.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { getInstalledVersion, getNpmLatestVersion } from './versions.mjs';
import { singleSelect } from './tui.mjs';

function getPiModels() {
  try {
    const output = execSync('pi --list-models 2>&1', {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = output.trim().split('\n').slice(1);
    const byProvider = new Map();
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 2) continue;
      const [provider, model, context] = cols;
      if (!byProvider.has(provider)) byProvider.set(provider, []);
      byProvider.get(provider).push({
        label: `${model}${context ? ` (${context})` : ''}`,
        value: `${provider}/${model}`,
      });
    }
    return byProvider;
  } catch {
    return new Map();
  }
}

export async function setupSandcastleForProject({ rebuild = false, clean = false } = {}) {
  if (!getInstalledVersion('pi')) {
    console.log('  pi: not installed, skipping sandcastle init (run `npx agentstack` first to install globally)');
    return;
  }

  console.log('  Installing @ai-hero/sandcastle...');
  execSync('npm install --save-dev --loglevel=error @ai-hero/sandcastle@latest', { stdio: 'pipe' });
  const scVer = getNpmLatestVersion('@ai-hero/sandcastle');
  console.log(`  sandcastle ${scVer || 'latest'} installed`);

  if (existsSync('.sandcastle') && !rebuild) {
    console.log('  sandcastle: .sandcastle/ already exists, skipping init');
  } else {
    const modelsByProvider = getPiModels();
    if (!modelsByProvider.size) {
      console.log('  pi: no models found. Run `pi` then `/login` to authenticate, then re-run.');
      return;
    }

    const providers = [...modelsByProvider.keys()];
    let models;
    if (providers.length === 1) {
      models = modelsByProvider.get(providers[0]);
    } else {
      const provider = await singleSelect(
        'Which provider?',
        providers.map(p => ({ label: p, value: p })),
      );
      models = modelsByProvider.get(provider);
    }

    const selectedModel = await singleSelect('Which model?', models);

    // Wipe only after interactive selection succeeds, so an aborted prompt leaves .sandcastle/ intact.
    // CODING_STANDARDS.md is preserved across the rebuild (it's typically customized per project)
    // unless --clean opts into a full wipe.
    let standardsBackup = null;
    if (rebuild && existsSync('.sandcastle')) {
      if (!clean) standardsBackup = backupCodingStandards();
      rmSync('.sandcastle', { recursive: true, force: true });
      console.log(`  sandcastle: removed .sandcastle/ for rebuild${clean ? ' (clean: regenerating CODING_STANDARDS.md)' : ''}`);
    }

    const initCmd = `npx @ai-hero/sandcastle init --agent pi --model ${JSON.stringify(selectedModel)} --template parallel-planner-with-review --sandbox podman`;
    console.log(`  ${initCmd}`);
    // init offers to build the image; decline it, since we build it explicitly below so the
    // overall flow stays deterministic and non-interactive.
    console.log("  Decline init's build prompt; the image is built right after.");
    execSync(initCmd, { stdio: 'inherit' });

    rewriteSandcastleMain();
    rewriteSandcastleContainerfile();
    buildSandcastleImage();

    if (standardsBackup) restoreCodingStandards(standardsBackup);
  }

  rewriteSandcastlePlanPrompt();
  rewriteSandcastleImplementPrompt();
  rewriteSandcastleMergePrompt();
}

// Build the podman image after the Containerfile is patched (mise + cache env). sandcastle only
// offers to build during `init` (from the unpatched template, which we decline) and never
// rebuilds on Containerfile changes — so build explicitly here, or the sandbox runs a stale image
// where `mise` is missing. Failure is non-fatal: .sandcastle/ is set up, so we warn and let the
// user build manually.
function buildSandcastleImage() {
  const cmd = 'npx @ai-hero/sandcastle podman build-image';
  console.log(`  ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log('  sandcastle: podman image built');
  } catch (err) {
    console.log(`  sandcastle: image build failed — run \`${cmd}\` manually once podman is ready (${err.message})`);
  }
}

const CODING_STANDARDS_FILE = 'CODING_STANDARDS.md';

function backupCodingStandards() {
  const src = resolve('.sandcastle', CODING_STANDARDS_FILE);
  if (!existsSync(src)) {
    console.log(`  sandcastle: no ${CODING_STANDARDS_FILE} to preserve`);
    return null;
  }
  const backupPath = resolve(mkdtempSync(resolve(tmpdir(), 'agentstack-standards-')), CODING_STANDARDS_FILE);
  copyFileSync(src, backupPath);
  console.log(`  sandcastle: preserved ${CODING_STANDARDS_FILE} → ${backupPath}`);
  return backupPath;
}

function restoreCodingStandards(backupPath) {
  copyFileSync(backupPath, resolve('.sandcastle', CODING_STANDARDS_FILE));
  rmSync(dirname(backupPath), { recursive: true, force: true });
  console.log(`  sandcastle: restored preserved ${CODING_STANDARDS_FILE} after init`);
}

// Each language's marker file(s) → the in-tree dependency/build directory worth copying into a
// worktree instead of regenerating it there. Detection is by marker, not by whether the directory
// already exists, so it's deterministic regardless of whether deps are installed when setup runs;
// copying a directory that isn't there yet is a harmless no-op. Only languages that keep deps
// in-tree are listed — Go and the like use an out-of-tree module cache, so there's nothing to copy.
const LANGUAGE_WORKTREE_DIRS = [
  { markers: ['package.json'], dir: 'node_modules' },
  { markers: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'], dir: '.venv' },
  { markers: ['Cargo.toml'], dir: 'target' },
  { markers: ['pubspec.yaml'], dir: '.dart_tool' },
];

// Build the copyToWorktree list for this project: the dependency dirs of whatever languages the
// project uses, plus .beads (git-excluded in stealth mode, so the Dolt DB must be copied in).
export function detectWorktreeCopyDirs(cwd = process.cwd()) {
  const dirs = LANGUAGE_WORKTREE_DIRS
    .filter(({ markers }) => markers.some(m => existsSync(resolve(cwd, m))))
    .map(({ dir }) => dir);
  dirs.push('.beads');
  return dirs;
}

// IO wrapper: read the generated main.ts, apply the mise patch (mounts/hooks/copyToWorktree),
// write it back. The transform lives in patchMainForMise so it's unit-tested without the FS.
function rewriteSandcastleMain() {
  const candidates = ['main.ts', 'main.mts'];
  const mainFile = candidates.find(f => existsSync(resolve('.sandcastle', f)));
  if (!mainFile) return;

  const mainPath = resolve('.sandcastle', mainFile);
  const original = readFileSync(mainPath, 'utf-8');
  const content = patchMainForMise(original, detectWorktreeCopyDirs(), detectDepInstallCommands());

  if (content === original) {
    console.log('  sandcastle: main.ts did not match expected patterns, skipping rewrite');
    return;
  }

  writeFileSync(mainPath, content);
  console.log('  sandcastle: rewrote main.ts → ~/.pi/agent + pkg-cache mounts, mise install/prune hooks, copyToWorktree');
}

// IO wrapper: read the generated Containerfile, apply the mise patch (install + build-time
// toolchain bake + cache env), write it back. The transform lives in patchContainerfileForMise.
function rewriteSandcastleContainerfile() {
  const containerPath = resolve('.sandcastle', 'Containerfile');
  if (!existsSync(containerPath)) return;

  const original = readFileSync(containerPath, 'utf-8');
  const versionFiles = detectMiseVersionFiles();
  const content = patchContainerfileForMise(original, versionFiles);

  if (content === original) {
    console.log('  sandcastle: Containerfile already mise-patched or anchor missing, skipping');
    return;
  }

  writeFileSync(containerPath, content);
  const baked = versionFiles.length ? ` (baking ${versionFiles.join(', ')})` : ' (no version files to bake)';
  console.log(`  sandcastle: added mise + cache env to Containerfile${baked}`);
}

// The system-deps block the generated Containerfile ships with; the mise install is inserted
// right after it. Anchored on the literal block so a template change surfaces (the patch no-ops
// and warns) rather than silently mis-inserting.
const CONTAINERFILE_SYSDEPS_ANCHOR = [
  '# Install system dependencies',
  'RUN apt-get update && apt-get install -y \\',
  '  git \\',
  '  curl \\',
  '  jq \\',
  '  && rm -rf /var/lib/apt/lists/*',
].join('\n');

// Install mise (jdx): one polyglot binary that provisions Python/Node/Rust/Java/Go/etc. The
// toolchains themselves are baked in at build time (see patchContainerfileForMise) so they land
// in image layers — bounded by `podman image prune`, never an unbounded runtime mount.
const MISE_INSTALL_BLOCK = [
  '',
  '# Install mise (jdx): a project-agnostic, polyglot toolchain manager. One binary provisions',
  '# Python, Node, Rust, Java, Go, etc., with shims on PATH so plain `python`/`cargo`/`java`',
  '# resolve in the non-interactive shells the agent uses.',
  'RUN curl https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh',
  '# Shared, root-owned data dir: toolchains baked in at build time (below) live here in image',
  "# layers and are visible to the agent user at runtime, so no runtime mount is needed and",
  '# nothing re-downloads per worktree. Bounded by `podman image prune`.',
  'ENV MISE_DATA_DIR="/usr/local/share/mise"',
  'ENV PATH="/usr/local/share/mise/shims:$PATH"',
  '# Auto-trust the bind-mounted worktree so mise loads its config without prompting.',
  'ENV MISE_TRUSTED_CONFIG_PATHS="/home/agent/workspace"',
  "# Honor projects' native version files (.nvmrc/.python-version/.java-version/rust-toolchain…)",
  '# so repos with no mise.toml still get their pinned runtime.',
  'ENV MISE_IDIOMATIC_VERSION_FILE_ENABLE_TOOLS="node,python,java,go,ruby,rust"',
  '',
  "# Redirect every package manager's cache into one dir so the runtime pkg-cache mount (see",
  '# main.ts) captures all downloads in one place — heavy deps download once across worktrees.',
  '# That mount is bounded by a prune step in the onSandboxReady hook.',
  'ENV XDG_CACHE_HOME="/home/agent/.cache"',
  'ENV CARGO_HOME="/home/agent/.cache/cargo"',
  'ENV GRADLE_USER_HOME="/home/agent/.cache/gradle"',
  'ENV NPM_CONFIG_CACHE="/home/agent/.cache/npm"',
  'ENV GOMODCACHE="/home/agent/.cache/go/mod"',
  'ENV MAVEN_ARGS="-Dmaven.repo.local=/home/agent/.cache/maven"',
].join('\n');

// Bake the project's pinned toolchain into an image layer at build time by COPYing its version
// files and running `mise install`. Image layers are bounded by `podman image prune` and never
// re-download per worktree — the fix for the old unbounded runtime mise mount.
function miseBakeBlock(versionFiles) {
  return [
    '',
    '# Bake the pinned toolchain into an image layer at build time: bounded by `podman image',
    '# prune`, no per-worktree re-download. Rebuild the image when pinned versions change.',
    `COPY ${versionFiles.join(' ')} /opt/mise-bake/`,
    'RUN mise trust --yes /opt/mise-bake && mise install -C /opt/mise-bake',
  ].join('\n');
}

// Patch the generated Containerfile to provision toolchains via mise. Pure: takes the file
// content and the project's version files (to COPY for the build-time install) and returns the
// patched content. Idempotent — re-running over an already-patched Containerfile is a no-op.
export function patchContainerfileForMise(content, versionFiles = []) {
  if (content.includes('mise.run')) return content; // already patched
  if (!content.includes(CONTAINERFILE_SYSDEPS_ANCHOR)) return content; // anchor gone; caller warns

  const bake = versionFiles.length ? `\n${miseBakeBlock(versionFiles)}` : '';
  return content.replace(
    CONTAINERFILE_SYSDEPS_ANCHOR,
    `${CONTAINERFILE_SYSDEPS_ANCHOR}\n${MISE_INSTALL_BLOCK}${bake}`,
  );
}

// Version manifests mise reads to pin a project's toolchain. Detected so the Containerfile can
// COPY exactly the ones present and bake them in at build time.
const MISE_VERSION_FILES = [
  'mise.toml', '.mise.toml', '.tool-versions',
  '.nvmrc', '.node-version', '.python-version', '.ruby-version', '.java-version',
  'rust-toolchain.toml', 'rust-toolchain', 'go.mod',
];

export function detectMiseVersionFiles(cwd = process.cwd()) {
  return MISE_VERSION_FILES.filter(f => existsSync(resolve(cwd, f)));
}

// Per-language dependency-install commands for the onSandboxReady hook, so a project's deps
// (pytest, crates, etc.) are present before the agent runs its tests — not just npm's. Each
// language's candidates are ordered most-specific-first (lockfile before loose manifest); the
// first match wins, so a project gets exactly one install command per language it uses.
const DEP_INSTALL_RULES = [
  [ // Node — pick by lockfile so the project's own package manager is honored
    { marker: 'pnpm-lock.yaml', command: 'pnpm install' },
    { marker: 'yarn.lock', command: 'yarn install' },
    { marker: 'bun.lockb', command: 'bun install' },
    { marker: 'package.json', command: 'npm install' },
  ],
  [ // Python
    { marker: 'uv.lock', command: 'uv sync' },
    { marker: 'poetry.lock', command: 'poetry install' },
    { marker: 'Pipfile.lock', command: 'pipenv install' },
    { marker: 'requirements.txt', command: 'pip install -r requirements.txt' },
    { marker: 'pyproject.toml', command: 'pip install -e .' },
  ],
  [{ marker: 'Cargo.toml', command: 'cargo fetch' }], // Rust
  [{ marker: 'go.mod', command: 'go mod download' }], // Go
  [{ marker: 'pubspec.yaml', command: 'dart pub get' }], // Dart/Flutter
];

export function detectDepInstallCommands(cwd = process.cwd()) {
  return DEP_INSTALL_RULES
    .map(candidates => candidates.find(c => existsSync(resolve(cwd, c.marker))))
    .filter(Boolean)
    .map(c => c.command);
}

// Patch the generated main.ts for the mise design. Pure: takes the file content and the
// project's copyToWorktree dirs, returns patched content. Mounts ~/.pi/agent (agent auth) and a
// single bounded pkg-cache dir — deliberately NOT the mise toolchain dir, which the old design
// mounted at runtime and which grew without bound (toolchains now live in image layers instead).
export function patchMainForMise(content, copyDirs, installCommands = []) {
  // Sandcastle requires every mount hostPath to exist; create the host-side pkg cache dir.
  if (!content.includes('mkdirSync')) {
    content = content.replace(
      'import { z } from "zod";',
      [
        'import { z } from "zod";',
        'import { mkdirSync } from "node:fs";',
        'import { homedir } from "node:os";',
        'import { join } from "node:path";',
        '',
        '// Sandcastle requires every mount hostPath to exist; create the host pkg cache dir.',
        'mkdirSync(join(homedir(), ".cache", "sandcastle-pkgs"), { recursive: true });',
      ].join('\n'),
    );
  }

  // Mounts: ~/.pi/agent for agent auth/config, plus one host pkg-cache dir so project deps
  // download once across worktrees. No mise toolchain mount — that's baked into the image.
  content = content.replaceAll(
    'podman()',
    'podman({ mounts: [{ hostPath: "~/.pi/agent", sandboxPath: "~/.pi/agent" }, { hostPath: "~/.cache/sandcastle-pkgs", sandboxPath: "/home/agent/.cache" }] })',
  );

  // Replace sandcastle's npm-biased copyToWorktree (always ["node_modules"]) with this project's
  // own dependency dirs plus .beads.
  const copyLiteral = `[${copyDirs.map(d => JSON.stringify(d)).join(', ')}]`;
  content = content.replace('const copyToWorktree = ["node_modules"];', `const copyToWorktree = ${copyLiteral};`);

  // onSandboxReady: `mise install` reconciles any pin the baked image missed; the prune step
  // bounds the pkg-cache mount (age-based eviction across the shared dir, so it works for every
  // package manager — npm/cargo/maven/gradle all write under ~/.cache — plus mise's own cache);
  // then each detected language's own install runs (uv sync / cargo fetch / …) so the project's
  // deps and test runners are present, not just npm's.
  content = content.replace(
    '{ command: "npm install" }',
    [
      '{ command: "mise install" }',
      '{ command: "find /home/agent/.cache -type f -atime +30 -delete 2>/dev/null; mise cache prune -y 2>/dev/null; true" }',
      ...installCommands.map(c => `{ command: ${JSON.stringify(c)} }`),
    ].join(', '),
  );

  return content;
}

function rewriteSandcastlePlanPrompt() {
  const promptPath = resolve('.sandcastle', 'plan-prompt.md');
  if (!existsSync(promptPath)) return;

  let content = readFileSync(promptPath, 'utf-8');
  const original = content;

  content = content.replace(/bd ready(?! --exclude-type=epic)/g, 'bd ready --exclude-type=epic -l=ready-for-agent');

  if (content === original) return;

  writeFileSync(promptPath, content);
  console.log('  sandcastle: plan-prompt.md → bd ready --exclude-type=epic');
}

// Project-agnostic test guidance for the generated agent prompts: tests run with the project's
// own commands, not the template's hardcoded npm scripts. No assumption about how the toolchain
// is provided.
const AGNOSTIC_TEST_INSTRUCTION =
  "run this project's own typecheck and tests.";

// The generated implement prompt hardcodes `npm run typecheck`/`npm run test`. Make the feedback
// loop run the project's own commands instead.
function rewriteSandcastleImplementPrompt() {
  const promptPath = resolve('.sandcastle', 'implement-prompt.md');
  if (!existsSync(promptPath)) return;

  let content = readFileSync(promptPath, 'utf-8');
  if (content.includes(AGNOSTIC_TEST_INSTRUCTION)) return; // idempotent: already rewritten
  const original = content;

  content = content.replace(
    'Before committing, run `npm run typecheck` and `npm run test` to ensure the tests pass.',
    `Before committing, ${AGNOSTIC_TEST_INSTRUCTION}`,
  );

  if (content === original) return;

  writeFileSync(promptPath, content);
  console.log('  sandcastle: implement-prompt.md → agnostic test feedback');
}

// The merger runs the post-merge tests in its own fresh container, so it only needs the
// project-agnostic test step.
function rewriteSandcastleMergePrompt() {
  const promptPath = resolve('.sandcastle', 'merge-prompt.md');
  if (!existsSync(promptPath)) return;

  let content = readFileSync(promptPath, 'utf-8');
  if (content.includes(AGNOSTIC_TEST_INSTRUCTION)) return; // idempotent: already rewritten
  const original = content;

  content = content.replace(
    'After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works',
    `After resolving conflicts, ${AGNOSTIC_TEST_INSTRUCTION}`,
  );

  if (content === original) return;

  writeFileSync(promptPath, content);
  console.log('  sandcastle: merge-prompt.md → agnostic test step');
}
