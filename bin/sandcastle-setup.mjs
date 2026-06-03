// Sandcastle project setup: scaffold .sandcastle/ via `sandcastle init`, then patch the
// generated template to this project's conventions — the ~/.pi/agent mount, .beads in the
// worktree, and project-agnostic test prompts.
//
// Toolchain provisioning is intentionally NOT handled here: the sandbox image is left as
// sandcastle generates it, and how each project's runtime/test deps get into the container
// is left to the project (e.g. its own Containerfile, a base image, or a future mechanism).

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

export async function setupSandcastleForProject() {
  if (!getInstalledVersion('pi')) {
    console.log('  pi: not installed, skipping sandcastle init (run `npx agentstack` first to install globally)');
    return;
  }

  console.log('  Installing @ai-hero/sandcastle...');
  execSync('npm install --save-dev --loglevel=error @ai-hero/sandcastle@latest', { stdio: 'pipe' });
  const scVer = getNpmLatestVersion('@ai-hero/sandcastle');
  console.log(`  sandcastle ${scVer || 'latest'} installed`);

  if (existsSync('.sandcastle')) {
    console.log('  sandcastle: .sandcastle/ already exists, skipping init (delete it to re-scaffold)');
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

    // sandcastle 0.7.0+ exposes a flag for every init prompt, so the whole scaffold runs
    // non-interactively. --build-image false because we build explicitly below
    // (buildSandcastleImage) to keep the overall flow deterministic.
    const initCmd = `npx @ai-hero/sandcastle init --agent pi --model ${JSON.stringify(selectedModel)} --template parallel-planner-with-review --sandbox docker --issue-tracker beads --install-template-deps true --build-image false`;
    console.log(`  ${initCmd}`);
    execSync(initCmd, { stdio: 'inherit' });

    rewriteSandcastleMain();
    buildSandcastleImage();
  }

  rewriteSandcastlePlanPrompt();
  rewriteSandcastleImplementPrompt();
  rewriteSandcastleMergePrompt();
}

// Build the docker image after init. init's own build is suppressed (--build-image false keeps
// the flow non-interactive), so build it explicitly here — the docker build-image command applies
// the UID/GID build-args automatically. Failure is non-fatal: .sandcastle/ is already set up, so
// we warn and let the user build manually.
function buildSandcastleImage() {
  const cmd = 'npx @ai-hero/sandcastle docker build-image';
  console.log(`  ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log('  sandcastle: docker image built');
  } catch (err) {
    console.log(`  sandcastle: image build failed — run \`${cmd}\` manually once docker is ready (${err.message})`);
  }
}

// Patch the generated main.ts: mount ~/.pi/agent (agent auth/config) into every sandbox, and
// copy .beads/ into each worktree alongside node_modules. No toolchain mounts or provisioning
// hooks — the onSandboxReady hooks are left as sandcastle's template generates them.
function rewriteSandcastleMain() {
  const candidates = ['main.ts', 'main.mts'];
  const mainFile = candidates.find(f => existsSync(resolve('.sandcastle', f)));
  if (!mainFile) return;

  const mainPath = resolve('.sandcastle', mainFile);
  let content = readFileSync(mainPath, 'utf-8');
  const original = content;

  // Mount ~/.pi/agent for agent auth/config in every sandbox.
  content = content.replaceAll(
    'docker()',
    'docker({ mounts: [{ hostPath: "~/.pi/agent", sandboxPath: "~/.pi/agent" }] })',
  );

  // Copy .beads/ into each worktree alongside node_modules. Stealth mode git-excludes .beads,
  // so the worktree checkout omits it; copying the whole directory brings the Dolt DB along.
  content = content.replace(
    'const copyToWorktree = ["node_modules"];',
    'const copyToWorktree = ["node_modules", ".beads"];',
  );

  if (content === original) {
    console.log('  sandcastle: main.ts did not match expected patterns, skipping rewrite');
    return;
  }

  writeFileSync(mainPath, content);
  console.log('  sandcastle: rewrote main.ts → ~/.pi/agent mount, .beads in copyToWorktree');
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
