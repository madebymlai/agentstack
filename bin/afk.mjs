#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sandcastle's init template emits main.ts; .mts is the alternate TypeScript
// module extension the rest of the installer already accounts for.
const MAIN_CANDIDATES = ['main.ts', 'main.mts'];

// Locate the sandcastle entry file under <cwd>/.sandcastle and return its
// project-relative path (e.g. ".sandcastle/main.ts"). Throws with guidance
// when sandcastle has not been set up yet — fail fast at the interface.
export function resolveSandcastleMain(cwd = process.cwd()) {
  const dir = resolve(cwd, '.sandcastle');
  const found = MAIN_CANDIDATES.find(f => existsSync(resolve(dir, f)));
  if (!found) {
    throw new Error(
      'No .sandcastle/main.ts found. Run `npx agentstack --project` to set up sandcastle first.',
    );
  }
  return join('.sandcastle', found);
}

// Build the argv for the wrapped run: `npx tsx <mainPath> [...passthrough]`.
export function buildAfkCommand(mainPath, passthrough = []) {
  return { command: 'npx', args: ['tsx', mainPath, ...passthrough] };
}

// Resolve and run the sandcastle loop, inheriting stdio so agent output
// streams straight to the terminal. Returns the child's exit code.
export function runAfk(passthrough = [], cwd = process.cwd()) {
  const mainPath = resolveSandcastleMain(cwd);
  const { command, args } = buildAfkCommand(mainPath, passthrough);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// Run when executed directly; skip when imported by tests. Compare realpaths
// to handle symlinks and npx cache paths, mirroring install.mjs.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    process.exit(runAfk(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
