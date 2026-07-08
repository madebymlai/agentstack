#!/usr/bin/env node

import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { REGISTRY } from './registry.mjs';
import { detectTarget, writeEnvVars } from './platform.mjs';
import { installBinary, runPostInstall } from './binary-install.mjs';
import { multiSelect } from './tui.mjs';
import {
  installBeads,
  installBeadsPrime,
  setupBeadsForProject,
  installPi,
  disablePiSkills,
} from './tool-installers.mjs';
import { setupProject } from './project-setup.mjs';
import { installCliCommands } from './cli.mjs';
import {
  TOOL_OPTIONS,
  toolsFromFlags,
  mergeMcpConfig,
  ensureBypassPermissions,
  installBundledSkills,
  installMattpocockSkills,
} from './tools.mjs';

async function main() {
  const args = process.argv.slice(2);
  const projectOnly = args.includes('--project') || args.includes('-p');
  const selectedByFlags = toolsFromFlags(args);

  if (projectOnly) {
    console.log('agentstack project setup\n');
    if (!existsSync('.git')) {
      console.log('Not a git repository. Run from a git repo root.');
      process.exit(1);
    }
    setupProject();
    setupBeadsForProject();

    // Skills install for every tool — project setup is where skills land now.
    // -p ignores tool flags, so target all adapters. The installers run without
    // -g, so the skills CLI installs them project-local (.claude/skills, ...).
    const allTools = TOOL_OPTIONS.map(t => t.value);
    installBundledSkills(allTools);
    installMattpocockSkills(allTools);
    console.log('\nDone.');
    return;
  }

  console.log('agentstack\n');

  const tools = selectedByFlags.length
    ? selectedByFlags
    : await multiSelect(TOOL_OPTIONS);

  if (!tools.length) {
    console.log('Nothing selected.');
    return;
  }

  // Binaries (version-checked)
  for (const [name, server] of Object.entries(REGISTRY)) {
    if (server.platforms) {
      const target = detectTarget();
      if (!target || !server.platforms.includes(target.key)) {
        console.log(`Skipping ${name}: not supported on ${process.platform}/${process.arch}`);
        continue;
      }
    }
    const installed = await installBinary(name, server);
    if (!installed) continue;
    runPostInstall(name, server, tools);
    mergeMcpConfig(name, server, tools);
    console.log(`\n${name}: done`);
  }

  // beads (bd) issue tracker — binary only; project init lives behind -p
  await installBeads();
  installBeadsPrime();

  // pi (pi-coding-agent) — cheap executor for agent tasks
  installPi();
  disablePiSkills();

  // afk and friends — bare shell commands served onto PATH
  installCliCommands();

  ensureBypassPermissions(tools);

  if (tools.includes('claude')) {
    writeEnvVars([{ key: 'CLAUDE_CODE_MAX_CONTEXT_TOKENS', value: '240000' }]);
  }

  console.log('\nDone.');
}

// Run main when executed directly. Skip when imported by another module (e.g. tests).
// In ESM, compare realpath of argv[1] with realpath of this file to handle
// symlinks and npx cache paths.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}
