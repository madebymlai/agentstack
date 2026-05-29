import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { getInstalledVersion, getNpmLatestVersion } from './versions.mjs';
import { getGithubLatestTag } from './net.mjs';
import { singleSelect } from './tui.mjs';

export async function installBeads() {
  const installed = getInstalledVersion('bd');
  const latest = await getGithubLatestTag('gastownhall/beads');
  if (installed && (!latest || installed === latest)) {
    console.log(`\n  bd ${installed} is up to date`);
    return;
  }
  if (installed) {
    console.log(`\nbd ${installed} found; installing ${latest}...`);
  } else {
    console.log(`\nbd not found; installing ${latest || 'latest'}...`);
  }
  if (process.platform === 'win32') {
    execSync('powershell -NoProfile -Command "irm https://raw.githubusercontent.com/gastownhall/beads/main/install.ps1 | iex"', { stdio: 'inherit' });
  } else {
    execSync('curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash', { stdio: 'inherit', shell: '/bin/bash' });
  }
}

export function setupBeadsForProject() {
  if (!getInstalledVersion('bd')) {
    console.log('  bd: not installed, skipping `bd init`');
    return;
  }
  if (existsSync('.beads')) {
    console.log('  bd: .beads/ already exists, skipping `bd init`');
    return;
  }
  console.log('  bd init --non-interactive --quiet --stealth');
  execSync('bd init --non-interactive --quiet --stealth', { stdio: 'inherit' });
}

export function installPi() {
  const installed = getInstalledVersion('pi');
  const latest = getNpmLatestVersion('@earendil-works/pi-coding-agent');
  if (installed && (!latest || installed === latest)) {
    console.log(`\n  pi ${installed} is up to date`);
    return;
  }
  if (installed) {
    console.log(`\npi ${installed} found; installing ${latest}...`);
  } else {
    console.log(`\npi not found; installing ${latest || 'latest'}...`);
  }
  execSync('npm install -g --loglevel=error @earendil-works/pi-coding-agent', { stdio: 'inherit' });
}

export function disablePiSkills() {
  const piDir = resolve(homedir(), '.pi', 'agent');
  const settingsPath = resolve(piDir, 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  }
  const current = settings.skills;
  if (Array.isArray(current) && current.length === 1 && current[0] === '!*') {
    return;
  }
  settings.skills = ['!*'];
  mkdirSync(piDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('  pi: disabled skill auto-discovery in ~/.pi/agent/settings.json');
}

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
    // init offers to build the image from the unpatched Containerfile; decline it, since
    // we rebuild from the patched one below.
    console.log("  Decline init's build prompt — the image is rebuilt after patching.");
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

// Build the podman image AFTER the Containerfile is patched (mise + caches). sandcastle
// only builds during `init` (from the unpatched template) and never rebuilds when the
// Containerfile changes, so without this the sandbox runs against a stale image and the
// `mise install` hook dies at runtime with "mise: not found". Failure here is non-fatal:
// .sandcastle/ is already set up, so we warn and let the user build manually.
function buildSandcastleImage() {
  const cmd = 'npx @ai-hero/sandcastle podman build-image';
  console.log(`  ${cmd}  (rebuilding image from patched Containerfile)`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log('  sandcastle: podman image rebuilt to match the patched Containerfile');
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

function rewriteSandcastleMain() {
  const candidates = ['main.ts', 'main.mts'];
  const mainFile = candidates.find(f => existsSync(resolve('.sandcastle', f)));
  if (!mainFile) return;

  const mainPath = resolve('.sandcastle', mainFile);
  let content = readFileSync(mainPath, 'utf-8');

  const original = content;

  // Sandcastle requires every mount hostPath to already exist, so have main.ts create the
  // host-side cache dirs the mounts reference. Covers every entry point (afk, npx tsx, npm
  // script), not just one launcher. Anchored on the zod import (last in the template).
  if (!content.includes('mkdirSync')) {
    content = content.replace(
      'import { z } from "zod";',
      [
        'import { z } from "zod";',
        'import { mkdirSync } from "node:fs";',
        'import { homedir } from "node:os";',
        'import { join } from "node:path";',
        '',
        '// Sandcastle requires every mount hostPath to already exist, so create the',
        '// host-side cache dirs the podman mounts below reference (no-op if present).',
        'for (const dir of ["sandcastle-mise", "sandcastle-pkgs"]) {',
        '  mkdirSync(join(homedir(), ".cache", dir), { recursive: true });',
        '}',
      ].join('\n'),
    );
  }

  // Mounts: ~/.pi/agent for agent auth/config; a mise cache so toolchains aren't
  // re-downloaded each run; and a package-manager cache (~/.cache) so project deps
  // (torch, cargo registry, etc.) download once instead of on every fresh worktree.
  content = content.replaceAll(
    'podman()',
    'podman({ mounts: [{ hostPath: "~/.pi/agent", sandboxPath: "~/.pi/agent" }, { hostPath: "~/.cache/sandcastle-mise", sandboxPath: "/home/agent/.local/share/mise" }, { hostPath: "~/.cache/sandcastle-pkgs", sandboxPath: "/home/agent/.cache" }] })',
  );

  // Copy .beads/ into each worktree alongside node_modules. Stealth mode
  // git-excludes .beads, so the worktree checkout omits it; copying the whole
  // directory (cp -R won't create parent dirs) brings the Dolt DB along, so the
  // sandbox needs no separate import or cleanup step.
  content = content.replace(
    'const copyToWorktree = ["node_modules"];',
    'const copyToWorktree = ["node_modules", ".beads"];',
  );

  // Provision each project's toolchain before installing npm deps: mise reads the
  // worktree's mise.toml / .tool-versions and installs whatever languages it
  // declares, keeping the sandbox agnostic to the project's stack.
  content = content.replace(
    'onSandboxReady: [{ command: "npm install" }]',
    'onSandboxReady: [{ command: "mise install" }, { command: "npm install" }]',
  );

  if (content === original) {
    console.log('  sandcastle: main.ts did not match expected patterns, skipping rewrite');
    return;
  }

  writeFileSync(mainPath, content);
  console.log('  sandcastle: rewrote main.ts → ~/.pi/agent + mise-cache mounts, .beads in copyToWorktree, mise install hook');
}

// Add mise (jdx) to the generated Containerfile so the sandbox is agnostic to the
// project's languages. mise is a single polyglot toolchain manager: each project
// declares its versions in mise.toml / .tool-versions and `mise install` (run in
// the worktree) provisions Python, Node, Rust, Java, Go, etc. on demand — so the
// image ships no per-language installers.
function rewriteSandcastleContainerfile() {
  const containerPath = resolve('.sandcastle', 'Containerfile');
  if (!existsSync(containerPath)) return;

  let content = readFileSync(containerPath, 'utf-8');

  // Idempotent: a rebuild over an already-patched Containerfile is a no-op.
  if (content.includes('mise.run')) return;

  const sysDeps = [
    '# Install system dependencies',
    'RUN apt-get update && apt-get install -y \\',
    '  git \\',
    '  curl \\',
    '  jq \\',
    '  && rm -rf /var/lib/apt/lists/*',
  ].join('\n');

  const miseBlock = [
    '',
    '# Install mise (jdx): a project-agnostic, polyglot toolchain manager. One binary',
    '# provisions Python, Node, Rust, Java, Go, etc. — each project declares its versions',
    '# in mise.toml / .tool-versions and `mise install` materializes them on demand, so',
    '# the image needs no per-language installers. Installed to /usr/local/bin (shared)',
    '# with shims on PATH so plain `python`/`cargo`/`java` resolve in the non-interactive',
    '# shells the agent uses.',
    'RUN curl https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh',
    'ENV PATH="/home/agent/.local/share/mise/shims:$PATH"',
    '# Auto-trust the bind-mounted worktree so mise loads its mise.toml without prompting.',
    'ENV MISE_TRUSTED_CONFIG_PATHS="/home/agent/workspace"',
    "# Honor projects' native version files (.nvmrc/.python-version/.java-version/",
    '# rust-toolchain.toml/...) so old repos get their pinned runtime with no mise.toml.',
    '# (.tool-versions/mise.toml are always read regardless of this setting.)',
    'ENV MISE_IDIOMATIC_VERSION_FILE_ENABLE_TOOLS="node,python,java,go,ruby,rust"',
    '# Keep state inside the agent-owned mise dir: the cache mount\'s parent dirs are',
    "# created as root, so the default ~/.local/state isn't writable by the agent user.",
    'ENV MISE_STATE_DIR="/home/agent/.local/share/mise/state"',
    '',
    "# Redirect every package manager's cache into one dir so a host-mounted volume (see",
    '# main.ts) persists downloads/builds across ephemeral worktrees — heavy deps (torch,',
    "# etc.) download once, not every run. Agnostic to the project's package manager.",
    'ENV XDG_CACHE_HOME="/home/agent/.cache"',
    'ENV CARGO_HOME="/home/agent/.cache/cargo"',
    'ENV GRADLE_USER_HOME="/home/agent/.cache/gradle"',
    'ENV NPM_CONFIG_CACHE="/home/agent/.cache/npm"',
    'ENV GOMODCACHE="/home/agent/.cache/go/mod"',
    'ENV MAVEN_ARGS="-Dmaven.repo.local=/home/agent/.cache/maven"',
  ].join('\n');

  const patched = content.replace(sysDeps, `${sysDeps}\n${miseBlock}`);

  if (patched === content) {
    console.log('  sandcastle: Containerfile did not match expected system-deps block, skipping mise install');
    return;
  }

  writeFileSync(containerPath, patched);
  console.log('  sandcastle: added mise (jdx) + package-manager cache env to Containerfile');
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

// Shared, project-agnostic guidance injected into the generated agent prompts: runtimes and
// standalone tools come from `mise`, deps from each project's native manager, and tests run
// with the project's own commands. Defined once so the implement/merge prompts don't
// duplicate the text (both the implementer and the merger run in their own containers and
// must set up the toolchain before running tests).
const MISE_SETUP_SECTION = [
  '# SETUP',
  '',
  'Runtimes/tools are not pre-installed — provision what this project needs with mise (see `mise use --help`).',
].join('\n');

const AGNOSTIC_TEST_INSTRUCTION = "run this project's own typecheck and tests.";

// The generated implement prompt assumes Node: no environment setup, and it hardcodes
// `npm run typecheck`/`npm run test`. Insert the shared SETUP before EXECUTION (so the
// runtime/deps are provisioned before the test-running RGR loop) and make the feedback loop
// run the project's own test commands.
function rewriteSandcastleImplementPrompt() {
  const promptPath = resolve('.sandcastle', 'implement-prompt.md');
  if (!existsSync(promptPath)) return;

  let content = readFileSync(promptPath, 'utf-8');
  if (content.includes('mise use')) return; // idempotent: already rewritten
  const original = content;

  content = content.replace('# EXECUTION', `${MISE_SETUP_SECTION}\n\n# EXECUTION`);
  content = content.replace(
    'Before committing, run `npm run typecheck` and `npm run test` to ensure the tests pass.',
    `Before committing, ${AGNOSTIC_TEST_INSTRUCTION}`,
  );

  if (content === original) return;

  writeFileSync(promptPath, content);
  console.log('  sandcastle: implement-prompt.md → SETUP section + project-agnostic test feedback');
}

// The merger runs in its own fresh container (the implementer's setup doesn't carry over) and
// runs the post-merge tests, so it needs the same SETUP + agnostic test step as the implementer.
function rewriteSandcastleMergePrompt() {
  const promptPath = resolve('.sandcastle', 'merge-prompt.md');
  if (!existsSync(promptPath)) return;

  let content = readFileSync(promptPath, 'utf-8');
  if (content.includes('mise use')) return; // idempotent: already rewritten
  const original = content;

  content = content.replace('For each branch:', `${MISE_SETUP_SECTION}\n\n# MERGE\n\nFor each branch:`);
  content = content.replace(
    'After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works',
    `After resolving conflicts, ${AGNOSTIC_TEST_INSTRUCTION}`,
  );

  if (content === original) return;

  writeFileSync(promptPath, content);
  console.log('  sandcastle: merge-prompt.md → SETUP section + project-agnostic test step');
}
