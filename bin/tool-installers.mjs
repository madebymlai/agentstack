import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, win32 } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getInstalledVersion, getNpmLatestVersion } from './versions.mjs';
import { getGithubLatestTag } from './net.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

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

export function getBeadsConfigDir({
  env = process.env,
  home = homedir(),
  platform = process.platform,
} = {}) {
  if (platform === 'win32') {
    const appData = env.APPDATA || win32.join(home, 'AppData', 'Roaming');
    return win32.join(appData, 'beads');
  }
  if (platform === 'darwin') {
    return resolve(home, 'Library', 'Application Support', 'beads');
  }
  return resolve(env.XDG_CONFIG_HOME || resolve(home, '.config'), 'beads');
}

export function installBeadsPrime({
  configDir = getBeadsConfigDir(),
  sourcePath = resolve(__dir, 'prime.txt'),
} = {}) {
  const targetPath = resolve(configDir, 'PRIME.md');
  mkdirSync(configDir, { recursive: true });
  copyFileSync(sourcePath, targetPath);
  console.log(`  beads: installed PRIME.md to ${targetPath}`);
  return targetPath;
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
