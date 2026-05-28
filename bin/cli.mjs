import { mkdirSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformPaths } from './platform.mjs';

// The CLI commands this module serves onto the user's PATH. Each entry maps a
// command name to its node implementation under bin/. The implementation is
// copied to a stable data dir and wrapped in a per-OS launcher so the user can
// invoke the bare command (e.g. `afk`) from any project directory.
const COMMANDS = [
  { name: 'afk', entry: 'afk.mjs' },
];

// Render the launcher script for a command on a given platform.
//   POSIX (linux/macOS): a /bin/sh shim, marked executable.
//   Windows:             a .cmd shim.
// Pure function — returns { filename, content, executable } so it is unit-testable.
export function renderLauncher(name, nodeTarget, platform = process.platform) {
  if (platform === 'win32') {
    return {
      filename: `${name}.cmd`,
      content: `@echo off\r\nnode "${nodeTarget}" %*\r\n`,
      executable: false,
    };
  }
  return {
    filename: name,
    content: `#!/bin/sh\nexec node "${nodeTarget}" "$@"\n`,
    executable: true,
  };
}

// Copy each command's node entry to a stable data dir — surviving npx-cache
// eviction — and write a per-OS launcher into binDir, which the installer keeps
// on PATH. Returns the absolute launcher paths written.
export function installCliCommands({
  binDir = getPlatformPaths().binDir,
  dataDir = getPlatformPaths().dataDir,
  sourceDir = dirname(fileURLToPath(import.meta.url)),
  platform = process.platform,
} = {}) {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const written = [];
  for (const { name, entry } of COMMANDS) {
    const stableTarget = resolve(dataDir, entry);
    copyFileSync(resolve(sourceDir, entry), stableTarget);

    const { filename, content, executable } = renderLauncher(name, stableTarget, platform);
    const launcherPath = resolve(binDir, filename);
    writeFileSync(launcherPath, content);
    if (executable) chmodSync(launcherPath, 0o755);
    written.push(launcherPath);
    console.log(`  ${name}: launcher installed → ${launcherPath}`);
  }

  const pathDirs = (process.env.PATH || '').split(delimiter);
  if (!pathDirs.includes(binDir)) {
    console.log(`  Warning: ${binDir} is not on your PATH. Add it to your shell profile.`);
  }
  return written;
}
