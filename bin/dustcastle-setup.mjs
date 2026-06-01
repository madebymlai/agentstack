// dustcastle setup (Linux). dustcastle is a global, Nix-store-based agent-sandbox runner — there
// is no per-project install or scaffold: no `.sandcastle/` directory, no per-project image build,
// and no prompt templates to patch (`dustcastle run` is zero-argument and provisions everything
// from the shared store). So setup is purely global: install dustcastle, and pick the global pi
// model (`dustcastle model`). This runs from the global `npx agentstack` flow, not `--project`.
//
// macOS/Windows keep the per-project sandcastle path (see sandcastle-setup.mjs).

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { getInstalledVersion } from './versions.mjs';
import { installDustcastle } from './tool-installers.mjs';

// dustcastle persists the chosen pi model to its global config; one choice, shared by every project.
const DUSTCASTLE_CONFIG = resolve(homedir(), '.dustcastle', 'config.json');

function hasModelConfigured() {
  if (!existsSync(DUSTCASTLE_CONFIG)) return false;
  try {
    const raw = JSON.parse(readFileSync(DUSTCASTLE_CONFIG, 'utf-8'));
    return typeof raw.model === 'string' && raw.model.trim() !== '';
  } catch {
    return false;
  }
}

export async function setupDustcastle() {
  installDustcastle();

  if (!getInstalledVersion('pi')) {
    console.log('  dustcastle: pi not installed yet — run `dustcastle model` once pi is set up to pick the agent model');
    return;
  }

  // The pi model is a single global choice every project shares (~/.dustcastle/config.json), so
  // pick it once and skip if already set. `dustcastle model` mirrors the sandcastle path's picker
  // and needs an interactive terminal — its failure is non-fatal (dustcastle is already installed,
  // and it re-prompts on the first `dustcastle run` anyway).
  if (hasModelConfigured()) {
    console.log('  dustcastle: model already configured (~/.dustcastle/config.json), skipping `dustcastle model`');
    return;
  }

  const cmd = 'npx dustcastle model';
  console.log(`  ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    console.log(`  dustcastle: model selection didn't complete — run \`dustcastle model\` once pi is authenticated (${err.message})`);
  }
}
