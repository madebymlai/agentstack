import { execSync } from 'node:child_process';
import { envWithInstallerBinOnPath } from './platform.mjs';

export function getInstalledVersion(binName) {
  const opts = {
    env: envWithInstallerBinOnPath(),
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  for (const cmd of [`${binName} --version 2>&1`, `${binName} version 2>&1`]) {
    try {
      const output = execSync(cmd, opts).trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      if (match) return match[1];
    } catch {}
  }
  return null;
}

// Globally-installed npm package version, or null. Used for tools whose CLI has no
// `--version` (so getInstalledVersion can't detect them) — we ask npm directly.
export function getGlobalPackageVersion(pkg) {
  try {
    const output = execSync(`npm ls -g ${pkg} --depth=0`, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = output.match(/@(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function getNpmLatestVersion(pkg) {
  try {
    return execSync(`npm view ${pkg} version`, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
