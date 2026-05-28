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
    execSync(initCmd, { stdio: 'inherit' });

    rewriteSandcastleMain();

    if (standardsBackup) restoreCodingStandards(standardsBackup);
  }

  rewriteSandcastlePlanPrompt();
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

  content = content.replaceAll(
    'podman()',
    'podman({ mounts: [{ hostPath: "~/.pi/agent", sandboxPath: "~/.pi/agent" }] })',
  );

  if (content === original) {
    console.log('  sandcastle: main.ts did not match expected podman() pattern, skipping rewrite');
    return;
  }

  writeFileSync(mainPath, content);
  console.log('  sandcastle: rewrote main.ts → podman with ~/.pi/agent mount');
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
