import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, win32, delimiter } from 'node:path';
import { homedir } from 'node:os';

export function getPlatformPaths() {
  const isWin = process.platform === 'win32';
  if (isWin) {
    return {
      dataDir: win32.join(process.env.LOCALAPPDATA, 'installer'),
      configDir: win32.join(process.env.APPDATA, 'installer'),
      binDir: win32.join(process.env.LOCALAPPDATA, 'installer', 'bin'),
    };
  }
  return {
    dataDir: resolve(homedir(), '.local', 'share', 'installer'),
    configDir: resolve(homedir(), '.config', 'installer'),
    binDir: resolve(homedir(), '.local', 'bin'),
  };
}

export function getOpencodeConfigDir() {
  return process.platform === 'win32'
    ? win32.join(process.env.APPDATA, 'opencode')
    : resolve(homedir(), '.config', 'opencode');
}

export function envWithInstallerBinOnPath(env = process.env) {
  const { binDir } = getPlatformPaths();
  const pathKey = process.platform === 'win32'
    ? Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path'
    : 'PATH';
  const current = env[pathKey] || '';
  const extra = [binDir];
  if (process.platform !== 'win32') extra.push(resolve(homedir(), '.bun', 'bin'));
  const pathDirs = current ? current.split(delimiter) : [];
  const missing = extra.filter(d => !pathDirs.includes(d));
  if (!missing.length) return { ...env };
  return {
    ...env,
    [pathKey]: [...missing, current].filter(Boolean).join(delimiter),
  };
}

const TARGET_MAP = {
  linux:  { x64: { key: 'linux-x86_64' } },
  darwin: {
    arm64: { key: 'darwin-arm64' },
    x64:   { key: 'darwin-x86_64' },
  },
  win32: {
    x64: { key: 'win32-x64' },
  },
};

export function detectTarget() {
  const entry = TARGET_MAP[process.platform]?.[process.arch];
  if (!entry) return null;
  const { binDir } = getPlatformPaths();
  return { ...entry, installDir: binDir };
}

export function detectPlatform() {
  return process.platform === 'win32' ? 'win32' : 'unix';
}

export function getShellProfile() {
  const shell = process.env.SHELL || '';
  if (shell.endsWith('/zsh')) return resolve(homedir(), '.zshrc');
  if (shell.endsWith('/fish')) return resolve(homedir(), '.config', 'fish', 'config.fish');
  return resolve(homedir(), '.bashrc');
}

// Persists environment variables (e.g. CLAUDE_CODE_MAX_CONTEXT_TOKENS) to the
// user's shell profile, or via `setx` on Windows.
export function writeEnvVars(keys) {
  if (!keys.length) return;

  if (process.platform === 'win32') {
    for (const { key, value } of keys) {
      execSync(`setx ${key} "${value}"`, { stdio: 'inherit' });
    }
    console.log('  Environment variables set via setx (restart shell to take effect).');
    return;
  }

  const profile = getShellProfile();
  let content = existsSync(profile) ? readFileSync(profile, 'utf8') : '';

  const added = [];
  for (const { key, value } of keys) {
    if (content.includes(`export ${key}=`)) continue;
    const line = `export ${key}="${value}"`;
    const prefix = content === '' || content.endsWith('\n') ? '' : '\n';
    content += prefix + line + '\n';
    process.env[key] = value;
    added.push(key);
  }

  if (added.length) {
    writeFileSync(profile, content);
    console.log(`  Added ${added.join(', ')} to ${profile}`);
  }
}
