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
