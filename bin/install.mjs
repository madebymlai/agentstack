#!/usr/bin/env node

import https from 'node:https';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, dirname, win32, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));

export function copyDirMerge(src, dest, { overwrite = false } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirMerge(srcPath, destPath, { overwrite });
    } else if (overwrite || !existsSync(destPath)) {
      copyFileSync(srcPath, destPath);
    }
  }
}

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

export class HttpError extends Error {
  constructor(status, url, body, retryAfterSeconds) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NET_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED']);

export function isTransientError(err) {
  if (err instanceof HttpError) return TRANSIENT_HTTP_STATUSES.has(err.status);
  return TRANSIENT_NET_CODES.has(err.code);
}

export async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    label,
    shouldRetry = isTransientError,
  } = opts;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      if (attempt > retries || !shouldRetry(err)) throw err;
      const hintMs = err.retryAfterSeconds != null ? err.retryAfterSeconds * 1000 : null;
      const backoffMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayMs = hintMs ?? backoffMs;
      const reason = err.status ? `HTTP ${err.status}` : (err.code || err.message.split('\n')[0].slice(0, 80));
      const prefix = label ? `${label}: ` : '';
      console.log(`  ${prefix}${reason} — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${retries + 1})`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

function getGithubToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execSync('gh auth token', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function httpsGetJsonOnce(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error(`Too many redirects fetching ${url}`));
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'agentstack-installer' };
    const token = url.includes('api.github.com') ? getGithubToken() : null;
    if (token) headers['Authorization'] = `token ${token}`;
    https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetJsonOnce(res.headers.location, redirects + 1).then(resolve, reject);
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const retryAfter = parseInt(res.headers['retry-after'], 10);
          reject(new HttpError(res.statusCode, url, data, Number.isFinite(retryAfter) ? retryAfter : undefined));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

export function httpsGetJson(url, retryOpts = {}) {
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  return withRetry(() => httpsGetJsonOnce(url), { label: `GET ${host}`, ...retryOpts });
}

export async function getGithubLatestTag(repo) {
  try {
    const release = await httpsGetJson(`https://api.github.com/repos/${repo}/releases/latest`);
    return release.tag_name?.replace(/^v/, '') || null;
  } catch {
    return null;
  }
}

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

function getNpmLatestVersion(pkg) {
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

    const initCmd = `npx @ai-hero/sandcastle init --agent pi --model ${JSON.stringify(selectedModel)} --template parallel-planner-with-review --sandbox podman`;
    console.log(`  ${initCmd}`);
    execSync(initCmd, { stdio: 'inherit' });

    rewriteSandcastleMain();
  }
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

export function verifySha256Checksum(filePath, checksumPath, assetName) {
  const shaRaw = readFileSync(checksumPath, 'utf8').trim();
  const expected = shaRaw.match(/[a-fA-F0-9]{64}/)?.[0]?.toLowerCase();
  if (!expected) {
    throw new Error(`Invalid SHA256 checksum file for ${assetName}`);
  }

  const actual = createHash('sha256')
    .update(readFileSync(filePath))
    .digest('hex');

  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${assetName}: expected ${expected}, got ${actual}`);
  }
}

export const REGISTRY = {
  'tokf': {
    platforms: ['linux-x86_64', 'darwin-arm64', 'darwin-x86_64'],
    githubRelease: {
      repo: 'mpecan/tokf',
      tagPrefix: 'tokf-v',
      targets: {
        'linux-x86_64': 'x86_64-unknown-linux-gnu',
        'darwin-arm64': 'aarch64-apple-darwin',
        'darwin-x86_64': 'x86_64-apple-darwin',
      },
      binName: 'tokf',
    },
    postInstall: {
      claude: ['tokf hook install --global'],
      opencode: ['tokf hook install --tool opencode --global'],
      codex: ['tokf hook install --tool codex --global'],
    },
  },
  'codebase-memory': {
    binName: 'codebase-memory-mcp',
    latestVersionRepo: 'DeusData/codebase-memory-mcp',
    install: {
      unix: 'curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash',
      win32: [
        'Invoke-WebRequest -Uri https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1 -OutFile $env:TEMP\\install-codebase-memory.ps1',
        '& $env:TEMP\\install-codebase-memory.ps1',
      ],
    },
    postInstall: [
      'codebase-memory-mcp config set auto_index true',
      'codebase-memory-mcp config set auto_index_limit 50000',
    ],
  },
};

export function detectPlatform() {
  return process.platform === 'win32' ? 'win32' : 'unix';
}

export async function installFromGithubRelease(name, ghConfig) {
  const target = detectTarget();
  if (!target) {
    console.log(`  Skipping ${name}: unsupported platform ${process.platform}/${process.arch}`);
    return false;
  }

  const ghTarget = ghConfig.targets[target.key];
  if (!ghTarget) {
    console.log(`  Skipping ${name}: no build for ${target.key}`);
    return false;
  }
  // 1. Resolve latest release
  const releases = await httpsGetJson(
    `https://api.github.com/repos/${ghConfig.repo}/releases`
  );
  const release = releases.find(r => r.tag_name.startsWith(ghConfig.tagPrefix));
  if (!release) throw new Error(`No release found matching prefix "${ghConfig.tagPrefix}"`);

  const tag = release.tag_name;

  // Version check — skip if already up to date
  const latestVersion = tag.replace(ghConfig.tagPrefix, '');
  const bin = typeof ghConfig.binName === 'string'
    ? ghConfig.binName
    : (process.platform === 'win32' ? ghConfig.binName.win32 : ghConfig.binName.unix);
  const installed = getInstalledVersion(bin);
  if (installed && installed === latestVersion) {
    console.log(`\n  ${name} ${installed} is up to date`);
    return true;
  }
  if (installed) {
    console.log(`\n${name} ${installed} found; installing ${latestVersion}...`);
  } else {
    console.log(`\n${name} not found; installing ${latestVersion}...`);
  }

  const ext = process.platform === 'win32' ? '.zip' : '.tar.gz';
  const assetName = ghConfig.assetNameFn
    ? ghConfig.assetNameFn(tag, ghTarget, ext)
    : `${tag}-${ghTarget}${ext}`;
  const asset = release.assets.find(a => a.name === assetName);
  if (!asset) throw new Error(`Asset "${assetName}" not found in release ${tag}`);

  // 2. Download to temp dir
  const installDir = target.installDir;
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'installer-install-'));
  const tarball = resolve(tmpDir, assetName);

  execSync(`curl -fsSL -o "${tarball}" "${asset.browser_download_url}"`, {
    stdio: 'inherit', shell: '/bin/bash',
  });

  // 3. Verify SHA256 checksum
  const shaAsset = release.assets.find(a => a.name === `${assetName}.sha256`);
  if (shaAsset) {
    execSync(`curl -fsSL -o "${tarball}.sha256" "${shaAsset.browser_download_url}"`, {
      stdio: 'inherit', shell: '/bin/bash',
    });
    verifySha256Checksum(tarball, `${tarball}.sha256`, assetName);
    console.log(`  Checksum verified.`);
  } else {
    console.log(`  Warning: no .sha256 asset found, skipping verification.`);
  }

  // 4. Extract and install
  mkdirSync(installDir, { recursive: true });
  if (assetName.endsWith('.zip')) {
    execSync(
      `powershell -Command "Expand-Archive -Path '${tarball}' -DestinationPath '${tmpDir}' -Force"`,
      { stdio: 'inherit', shell: 'powershell.exe' },
    );
    const binSrc = resolve(tmpDir, ghConfig.binName);
    execSync(`copy "${binSrc}" "${resolve(installDir, ghConfig.binName)}"`, {
      stdio: 'inherit', shell: 'cmd.exe',
    });
  } else {
    execSync(`tar xzf "${tarball}" -C "${installDir}" "./${ghConfig.binName}" 2>/dev/null || tar xzf "${tarball}" -C "${installDir}" ${ghConfig.binName}`, {
      stdio: 'inherit', shell: '/bin/bash',
    });
    execSync(`chmod +x "${installDir}/${ghConfig.binName}"`);
  }
  rmSync(tmpDir, { recursive: true });

  // 5. Warn if install dir not on PATH
  const pathDirs = (process.env.PATH || '').split(delimiter);
  if (!pathDirs.includes(installDir)) {
    console.log(`  Warning: ${installDir} is not on your PATH. Add it to your shell profile.`);
  }

  console.log(`  ${name} ${tag} installed to ${installDir}`);
  return true;
}

export async function installBinary(name, server) {
  if (server.githubRelease) {
    return installFromGithubRelease(name, server.githubRelease);
  }
  // Version check for script-installed binaries
  if (server.binName && server.latestVersionRepo) {
    const installed = getInstalledVersion(server.binName);
    if (installed) {
      const latest = await getGithubLatestTag(server.latestVersionRepo);
      if (latest && installed === latest) {
        console.log(`\n  ${name} ${installed} is up to date`);
        return true;
      }
    }
  }
  const platform = detectPlatform();
  const cmds = server.install?.[platform];
  if (!cmds) {
    console.log(`  Skipping ${name}: no install commands for ${platform}`);
    return false;
  }
  console.log(`\nInstalling ${name}...`);
  if (Array.isArray(cmds)) {
    for (const cmd of cmds) {
      execSync(cmd, { stdio: 'inherit', shell: 'powershell.exe' });
    }
  } else {
    execSync(cmds, { stdio: 'inherit', shell: '/bin/bash' });
  }
  console.log(`  Binary installed.`);
  return true;
}

function postInstallCommands(postInstall, tools) {
  if (Array.isArray(postInstall)) return postInstall;
  return tools.flatMap(tool => postInstall[tool] || []);
}

export function runPostInstall(name, server, tools = []) {
  const pi = server.postInstall;
  if (!pi) return;
  const cmds = postInstallCommands(pi, tools);
  if (!cmds?.length) return;

  // Back up settings.json before postInstall (tokf hook installs may overwrite PreToolUse)
  const settingsPath = resolve(homedir(), '.claude', 'settings.json');
  let settingsBefore = null;
  if (existsSync(settingsPath)) {
    settingsBefore = JSON.parse(readFileSync(settingsPath, 'utf8'));
  }

  console.log(`Configuring ${name}...`);
  for (const cmd of cmds) {
    execSync(cmd, { stdio: 'inherit', env: envWithInstallerBinOnPath() });
  }

  // Restore any PreToolUse hooks that tokf may have overwritten
  if (settingsBefore?.hooks?.PreToolUse && existsSync(settingsPath)) {
    const settingsAfter = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const beforeEntries = settingsBefore.hooks.PreToolUse;
    const afterEntries = settingsAfter.hooks?.PreToolUse || [];
    const afterMatchers = new Set(afterEntries.map(e => e.matcher));
    const merged = [
      ...afterEntries,
      ...beforeEntries.filter(e => !afterMatchers.has(e.matcher)),
    ];
    settingsAfter.hooks ??= {};
    settingsAfter.hooks.PreToolUse = merged;
    writeFileSync(settingsPath, JSON.stringify(settingsAfter, null, 2) + '\n');
    if (merged.length > afterEntries.length) {
      console.log(`  Restored ${merged.length - afterEntries.length} existing PreToolUse hook(s).`);
    }
  }

  console.log(`  Configuration applied.`);
}

function resolveEnvPlaceholders(env, envOverrides) {
  const resolved = { ...env };
  for (const k of Object.keys(resolved)) {
    const v = resolved[k];
    const m = typeof v === 'string' && v.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
    if (m) {
      const val = envOverrides[m[1]] ?? process.env[m[1]];
      if (val) resolved[k] = val;
    }
  }
  return resolved;
}

function concreteEnvEntries(env = {}) {
  return Object.entries(env).filter(([k, v]) => hasConcreteEnvValue(v, k));
}

function mergeClaudeMcp(name, entry, configPath) {
  let config = {};
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  }
  config.mcpServers ??= {};
  if (config.mcpServers[name]) {
    let changed = false;
    for (const [k, v] of concreteEnvEntries(entry.env)) {
      config.mcpServers[name].env ??= {};
      if (!hasConcreteEnvValue(config.mcpServers[name].env[k], k)) {
        config.mcpServers[name].env[k] = v;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log(`  ${configPath}: updated "${name}" environment`);
      return;
    }
    console.log(`  ${configPath}: "${name}" already configured`);
    return;
  }
  config.mcpServers[name] = entry;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  ${configPath}: added "${name}"`);
}

function mergeOpencodeMcp(name, entry, configPath) {
  let config = {};
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  }
  config.mcp ??= {};
  if (config.mcp[name]) {
    let changed = false;
    for (const [k, v] of concreteEnvEntries(entry.env)) {
      config.mcp[name].environment ??= {};
      if (!hasConcreteEnvValue(config.mcp[name].environment[k], k)) {
        config.mcp[name].environment[k] = v;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log(`  ${configPath}: updated "${name}" environment`);
      return;
    }
    console.log(`  ${configPath}: "${name}" already configured`);
    return;
  }
  config.mcp[name] = {
    type: 'local',
    command: [entry.command, ...entry.args],
    ...(entry.env && { environment: entry.env }),
    enabled: true,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  ${configPath}: added "${name}"`);
}

function mergeCodexMcp(name, entry, configPath) {
  let content = '';
  if (existsSync(configPath)) {
    content = readFileSync(configPath, 'utf8');
  }
  const header = `[mcp_servers.${name}]`;
  if (content.includes(header)) {
    let nextContent = content;
    for (const [k, v] of concreteEnvEntries(entry.env)) {
      const current = codexMcpEnvValue(nextContent, name, k);
      if (hasConcreteEnvValue(current, k)) continue;
      nextContent = setCodexMcpEnvValue(nextContent, name, k, v);
    }
    if (nextContent !== content) {
      writeFileSync(configPath, nextContent);
      console.log(`  ${configPath}: updated "${name}" environment`);
      return;
    }
    console.log(`  ${configPath}: "${name}" already configured`);
    return;
  }
  let block = `\n${header}\ncommand = "${entry.command}"\nargs = [${entry.args.map(a => `"${a}"`).join(', ')}]\n`;
  if (entry.env) {
    for (const [k, v] of Object.entries(entry.env)) {
      block += `\n[mcp_servers.${name}.env]\n${k} = "${v}"\n`;
    }
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, content + block);
  console.log(`  ${configPath}: added "${name}"`);
}

function codexMcpEnvValue(content, name, envVar) {
  const section = `[mcp_servers.${name}.env]`;
  const start = content.indexOf(section);
  if (start === -1) return null;
  const rest = content.slice(start + section.length);
  const nextSection = rest.search(/\n\[/);
  const body = nextSection === -1 ? rest : rest.slice(0, nextSection);
  const match = body.match(new RegExp(`^\\s*${envVar}\\s*=\\s*["']([^"']+)["']`, 'm'));
  return match?.[1] || null;
}

function setCodexMcpEnvValue(content, name, envVar, value) {
  const section = `[mcp_servers.${name}.env]`;
  const start = content.indexOf(section);
  if (start === -1) {
    const prefix = content.endsWith('\n') ? '' : '\n';
    return content + `${prefix}\n${section}\n${envVar} = "${value}"\n`;
  }

  const bodyStart = start + section.length;
  const rest = content.slice(bodyStart);
  const nextSectionOffset = rest.search(/\n\[/);
  const bodyEnd = nextSectionOffset === -1 ? content.length : bodyStart + nextSectionOffset;
  const body = content.slice(bodyStart, bodyEnd);
  const linePattern = new RegExp(`(^\\s*${envVar}\\s*=\\s*)["'][^"']*["']`, 'm');
  if (linePattern.test(body)) {
    const updatedBody = body.replace(linePattern, (_, prefix) => `${prefix}"${value}"`);
    return content.slice(0, bodyStart) + updatedBody + content.slice(bodyEnd);
  }

  const insert = `${body.endsWith('\n') ? '' : '\n'}${envVar} = "${value}"\n`;
  return content.slice(0, bodyEnd) + insert + content.slice(bodyEnd);
}

function hasConcreteEnvValue(value, envVar) {
  return Boolean(value && value !== `\${${envVar}}`);
}

function concreteMcpEnvValue(name, tool, envVar) {
  switch (tool) {
    case 'claude': {
      const configPath = resolve(homedir(), '.claude.json');
      if (!existsSync(configPath)) return null;
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const value = config.mcpServers?.[name]?.env?.[envVar];
      return hasConcreteEnvValue(value, envVar) ? value : null;
    }
      case 'opencode': {
        const configDir = getOpencodeConfigDir();
        const configPath = resolve(configDir, 'opencode.json');
        if (!existsSync(configPath)) return null;
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const value = config.mcp?.[name]?.environment?.[envVar];
      return hasConcreteEnvValue(value, envVar) ? value : null;
    }
    case 'codex': {
      const isWin = process.platform === 'win32';
      const configPath = isWin
        ? win32.join(process.env.APPDATA, 'codex', 'config.toml')
        : resolve(homedir(), '.codex', 'config.toml');
      if (!existsSync(configPath)) return null;
      const value = codexMcpEnvValue(readFileSync(configPath, 'utf8'), name, envVar);
      return hasConcreteEnvValue(value, envVar) ? value : null;
    }
    default:
      return null;
  }
}

function concreteMcpEnvValues(name, envVar) {
  return [
    ...new Set(
      TOOL_OPTIONS
        .map(tool => concreteMcpEnvValue(name, tool.value, envVar))
        .filter(Boolean),
    ),
  ];
}

export function mergeMcpConfig(name, server, tools, envOverrides = {}) {
  if (!server.mcpEntry) return;
  const entry = JSON.parse(JSON.stringify(server.mcpEntry));
  if (entry.env) {
    entry.env = resolveEnvPlaceholders(entry.env, envOverrides);
  }

  for (const tool of tools) {
    switch (tool) {
      case 'claude':
        mergeClaudeMcp(name, entry, resolve(homedir(), '.claude.json'));
        break;
      case 'opencode': {
        const configDir = getOpencodeConfigDir();
        mergeOpencodeMcp(name, entry, resolve(configDir, 'opencode.json'));
        break;
      }
      case 'codex': {
        const isWin = process.platform === 'win32';
        const codexDir = isWin
          ? win32.join(process.env.APPDATA, 'codex')
          : resolve(homedir(), '.codex');
        mergeCodexMcp(name, entry, resolve(codexDir, 'config.toml'));
        break;
      }
    }
  }
}

/**
 * @unused Reserved API-key prompt pattern for future installer steps.
 */
export function promptApiKey(name, envVar) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${name} API key (or press Enter to skip): `, (answer) => {
      rl.close();
      const val = answer.trim();
      if (!val) {
        console.log(`  Skipped. Set ${envVar} in your shell profile later.`);
        done(null);
      } else {
        done({ key: envVar, value: val });
      }
    });
  });
}

/**
 * @unused Reserved API-key discovery pattern for future installer steps.
 */
export async function resolveApiKey({ label, serverName, envVar }, { keys, envOverrides }) {
  if (process.env[envVar]) {
    console.log(`  ${label}: found in environment`);
    return;
  }

  const configuredValues = concreteMcpEnvValues(serverName, envVar);
  if (configuredValues.length === 1) {
    const configuredValue = configuredValues[0];
    envOverrides[envVar] = configuredValue;
    process.env[envVar] = configuredValue;
    keys.push({ key: envVar, value: configuredValue });
    console.log(`  ${label}: found in existing tool config`);
    return;
  }
  if (configuredValues.length > 1) {
    const configuredValue = await singleSelect(
      `${label}: multiple existing values found. Select one to use:`,
      configuredValues.map(value => ({
        label: maskSecret(value),
        value,
      })),
    );
    envOverrides[envVar] = configuredValue;
    process.env[envVar] = configuredValue;
    keys.push({ key: envVar, value: configuredValue });
    console.log(`  ${label}: selected existing tool config value`);
    return;
  }

  const k = await promptApiKey(label, envVar);
  if (k) {
    keys.push(k);
    process.env[envVar] = k.value;
  }
}

function getShellProfile() {
  const shell = process.env.SHELL || '';
  if (shell.endsWith('/zsh')) return resolve(homedir(), '.zshrc');
  if (shell.endsWith('/fish')) return resolve(homedir(), '.config', 'fish', 'config.fish');
  return resolve(homedir(), '.bashrc');
}

/**
 * @unused Reserved API-key persistence pattern for future installer steps.
 */
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

// BEGIN agentstack codex multi-agent usage hint
const CODEX_MULTI_AGENT_USAGE_HINT_BEGIN = '# >>> agentstack codex multi-agent usage hint';
const CODEX_MULTI_AGENT_USAGE_HINT_END = '# <<< agentstack codex multi-agent usage hint';
const CODEX_MULTI_AGENT_USAGE_HINT_SECTION = '[features.multi_agent_v2]';
const CODEX_MULTI_AGENT_USAGE_HINT_KEYS = ['usage_hint_enabled', 'usage_hint_text'];
const CODEX_MULTI_AGENT_USAGE_HINT_SETTINGS = `usage_hint_enabled = true
usage_hint_text = '''
Use \`spawn_agent\` autonomously when delegation materially improves the task.

For non-implementation coding tasks, call \`spawn_agent\` with the mini model.

Repository or workspace instructions such as AGENTS.md or skills may define when and how delegation is appropriate. Treat those instructions as the user's standing delegation policy for the workspace. Do not require a separate live user request before spawning subagents.
'''`;

function codexMultiAgentUsageHintBlock({ includeSection = true } = {}) {
  return [
    CODEX_MULTI_AGENT_USAGE_HINT_BEGIN,
    ...(includeSection ? [CODEX_MULTI_AGENT_USAGE_HINT_SECTION] : []),
    CODEX_MULTI_AGENT_USAGE_HINT_SETTINGS,
    CODEX_MULTI_AGENT_USAGE_HINT_END,
  ].join('\n') + '\n';
}

function removeBoundedTomlBlock(content, begin, end) {
  let nextContent = content;
  while (true) {
    const beginIndex = nextContent.indexOf(begin);
    if (beginIndex === -1) return nextContent;

    const endIndex = nextContent.indexOf(end, beginIndex);
    if (endIndex === -1) return nextContent;

    const afterEndLine = nextContent.indexOf('\n', endIndex);
    const removeEnd = afterEndLine === -1 ? nextContent.length : afterEndLine + 1;
    nextContent = nextContent.slice(0, beginIndex) + nextContent.slice(removeEnd);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tomlSectionLinePattern(section) {
  return new RegExp(`^\\s*${escapeRegExp(section)}\\s*(?:#.*)?$`);
}

function isTomlSectionLine(line) {
  return /^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(line);
}

function hasTomlSection(content, section) {
  const sectionPattern = tomlSectionLinePattern(section);
  return content.split('\n').some(line => sectionPattern.test(line));
}

function startsUnclosedMultilineTomlString(value, delimiter) {
  return value.startsWith(delimiter) && !value.slice(delimiter.length).includes(delimiter);
}

function removeTomlKeysFromSection(content, section, keys) {
  const sectionPattern = tomlSectionLinePattern(section);
  const keyPattern = new RegExp(`^\\s*(${keys.map(escapeRegExp).join('|')})\\s*=`);
  const lines = content.split('\n');
  const nextLines = [];
  let inTargetSection = false;
  let skipUntilDelimiter = null;

  for (const line of lines) {
    if (skipUntilDelimiter) {
      if (line.includes(skipUntilDelimiter)) {
        skipUntilDelimiter = null;
      }
      continue;
    }

    if (isTomlSectionLine(line)) {
      inTargetSection = sectionPattern.test(line);
    }

    if (inTargetSection && keyPattern.test(line)) {
      const value = line.slice(line.indexOf('=') + 1).trim();
      if (startsUnclosedMultilineTomlString(value, "'''")) {
        skipUntilDelimiter = "'''";
      } else if (startsUnclosedMultilineTomlString(value, '"""')) {
        skipUntilDelimiter = '"""';
      }
      continue;
    }

    nextLines.push(line);
  }

  return nextLines.join('\n');
}

function insertTomlBlockIntoSection(content, section, block) {
  const sectionPattern = tomlSectionLinePattern(section);
  const lines = content.split('\n');
  const sectionIndex = lines.findIndex(line => sectionPattern.test(line));
  if (sectionIndex === -1) return content;

  lines.splice(sectionIndex + 1, 0, ...block.trimEnd().split('\n'));
  return lines.join('\n');
}

function appendTomlBlock(content, block) {
  if (content === '') return block;
  const separator = content.endsWith('\n\n')
    ? ''
    : content.endsWith('\n') ? '\n' : '\n\n';
  return content + separator + block;
}

export function ensureCodexMultiAgentUsageHint(content) {
  const withoutManagedBlock = removeBoundedTomlBlock(
    content,
    CODEX_MULTI_AGENT_USAGE_HINT_BEGIN,
    CODEX_MULTI_AGENT_USAGE_HINT_END,
  );
  const withoutExistingHintKeys = removeTomlKeysFromSection(
    withoutManagedBlock,
    CODEX_MULTI_AGENT_USAGE_HINT_SECTION,
    CODEX_MULTI_AGENT_USAGE_HINT_KEYS,
  );

  if (hasTomlSection(withoutExistingHintKeys, CODEX_MULTI_AGENT_USAGE_HINT_SECTION)) {
    return insertTomlBlockIntoSection(
      withoutExistingHintKeys,
      CODEX_MULTI_AGENT_USAGE_HINT_SECTION,
      codexMultiAgentUsageHintBlock({ includeSection: false }),
    );
  }

  return appendTomlBlock(
    withoutExistingHintKeys,
    codexMultiAgentUsageHintBlock({ includeSection: true }),
  );
}
// END agentstack codex multi-agent usage hint

/**
 * @unused Reserved API-key collection + MCP config pattern for future installer steps.
 */
export async function mergeMcpConfigWithApiKeys(name, server, tools, keySpecs) {
  console.log('\nAPI Keys\n');
  const keys = [];
  const envOverrides = {};

  for (const spec of keySpecs) {
    await resolveApiKey(spec, { keys, envOverrides });
  }

  if (keys.length) writeEnvVars(keys);

  Object.assign(envOverrides, Object.fromEntries(keys.map(({ key, value }) => [key, value])));
  mergeMcpConfig(name, server, tools, envOverrides);
}


export function ensureBypassPermissions(tools) {
  console.log('\nConfiguring permissions...');
  for (const tool of tools) {
    switch (tool) {
      case 'claude': {
        const settingsPath = resolve(homedir(), '.claude', 'settings.json');
        let settings = {};
        if (existsSync(settingsPath)) {
          settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        }
        if (settings.permissions?.defaultMode === 'bypassPermissions') {
          console.log(`  claude: already set`);
          break;
        }
        settings.permissions ??= {};
        settings.permissions.defaultMode = 'bypassPermissions';
        settings.attribution ??= {};
        settings.attribution.commit ??= '';
        settings.attribution.pr ??= '';
        mkdirSync(dirname(settingsPath), { recursive: true });
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log(`  claude: bypassPermissions + no co-authored-by in ${settingsPath}`);
        break;
      }
      case 'codex': {
        const isWin = process.platform === 'win32';
        const configPath = isWin
          ? win32.join(process.env.APPDATA, 'codex', 'config.toml')
          : resolve(homedir(), '.codex', 'config.toml');
        let content = '';
        if (existsSync(configPath)) {
          content = readFileSync(configPath, 'utf8');
        }
        const settings = [];
        if (!content.includes('approval_policy')) {
          settings.push('approval_policy = "never"');
        }
        if (!content.includes('sandbox_mode')) {
          settings.push('sandbox_mode = "danger-full-access"');
        }
        let nextContent = settings.length
          ? settings.join('\n') + '\n' + content
          : content;
        // BEGIN agentstack codex multi-agent usage hint
        const withUsageHint = ensureCodexMultiAgentUsageHint(nextContent);
        if (withUsageHint !== nextContent) {
          settings.push('features.multi_agent_v2 usage hint');
          nextContent = withUsageHint;
        }
        // END agentstack codex multi-agent usage hint
        if (!settings.length) {
          console.log(`  codex: already set`);
          break;
        }
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, nextContent);
        console.log(`  codex: ${settings.join(', ')} in ${configPath}`);
        break;
      }
      case 'opencode': {
        const isWin = process.platform === 'win32';
        const configDir = isWin
          ? win32.join(process.env.APPDATA, 'opencode')
          : resolve(homedir(), '.config', 'opencode');
        const configPath = resolve(configDir, 'opencode.json');
        let config = {};
        if (existsSync(configPath)) {
          config = JSON.parse(readFileSync(configPath, 'utf8'));
        }
        if (config.permission === 'allow') {
          console.log(`  opencode: already set`);
          break;
        }
        config.permission = 'allow';
        mkdirSync(configDir, { recursive: true });
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        console.log(`  opencode: permission = "allow" in ${configPath}`);
        break;
      }
    }
  }
}

export function multiSelect(options) {
  return new Promise((done) => {
    const selected = options.map(() => false);
    let cursor = 0;

    const render = () => {
      process.stdout.write(`\x1b[${options.length}A`);
      options.forEach((opt, i) => {
        const check = selected[i] ? 'x' : ' ';
        const arrow = i === cursor ? '>' : ' ';
        process.stdout.write(`\x1b[2K${arrow} [${check}] ${opt.label}\n`);
      });
    };

    console.log('\nSelect tools (arrows to move, space to toggle, enter to confirm):\n');
    options.forEach((opt, i) => {
      const arrow = i === cursor ? '>' : ' ';
      console.log(`${arrow} [ ] ${opt.label}`);
    });

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onKey = (key) => {
      if (key === '\x1b[A') { cursor = (cursor - 1 + options.length) % options.length; render(); }
      else if (key === '\x1b[B') { cursor = (cursor + 1) % options.length; render(); }
      else if (key === ' ') { selected[cursor] = !selected[cursor]; render(); }
      else if (key === 'a') { const allOn = selected.every(Boolean); selected.fill(!allOn); render(); }
      else if (key === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onKey);
        console.log('');
        done(options.filter((_, i) => selected[i]).map(o => o.value));
      }
      else if (key === '\x03') { process.exit(0); }
    };

    process.stdin.on('data', onKey);
  });
}

export function singleSelect(prompt, options) {
  return new Promise((done) => {
    let cursor = 0;
    let scrollOffset = 0;
    const maxVisible = Math.min(options.length, (process.stdout.rows || 24) - 4);
    const needsScroll = options.length > maxVisible;
    const renderedLines = maxVisible + (needsScroll ? 2 : 0);

    const clampScroll = () => {
      if (cursor < scrollOffset) scrollOffset = cursor;
      if (cursor >= scrollOffset + maxVisible) scrollOffset = cursor - maxVisible + 1;
    };

    const render = () => {
      process.stdout.write(`\x1b[${renderedLines}A`);
      if (needsScroll) {
        const upHint = scrollOffset > 0 ? `  ↑ ${scrollOffset} more` : '';
        process.stdout.write(`\x1b[2K${upHint}\n`);
      }
      for (let i = scrollOffset; i < scrollOffset + maxVisible; i++) {
        const arrow = i === cursor ? '>' : ' ';
        process.stdout.write(`\x1b[2K${arrow} ${options[i].label}\n`);
      }
      if (needsScroll) {
        const below = options.length - scrollOffset - maxVisible;
        const downHint = below > 0 ? `  ↓ ${below} more` : '';
        process.stdout.write(`\x1b[2K${downHint}\n`);
      }
    };

    console.log(`\n${prompt}\n`);
    clampScroll();
    if (needsScroll) console.log('');
    for (let i = scrollOffset; i < scrollOffset + maxVisible; i++) {
      const arrow = i === cursor ? '>' : ' ';
      console.log(`${arrow} ${options[i].label}`);
    }
    if (needsScroll) {
      const below = options.length - scrollOffset - maxVisible;
      console.log(below > 0 ? `  ↓ ${below} more` : '');
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onKey = (key) => {
      if (key === '\x1b[A') { cursor = (cursor - 1 + options.length) % options.length; clampScroll(); render(); }
      else if (key === '\x1b[B') { cursor = (cursor + 1) % options.length; clampScroll(); render(); }
      else if (key === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onKey);
        console.log('');
        done(options[cursor].value);
      }
      else if (key === '\x03') { process.exit(0); }
    };

    process.stdin.on('data', onKey);
  });
}

function maskSecret(value) {
  if (value.length <= 10) return '*'.repeat(value.length);
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

const TOOL_OPTIONS = [
  { label: 'Claude Code', value: 'claude', flag: '--claude' },
  { label: 'Codex', value: 'codex', flag: '--codex' },
  { label: 'OpenCode', value: 'opencode', flag: '--opencode' },
];

export function toolsFromFlags(args = process.argv.slice(2)) {
  return TOOL_OPTIONS
    .filter(tool => args.includes(tool.flag))
    .map(tool => tool.value);
}

// Writes ignore entries to `.git/info/exclude` instead of the tracked `.gitignore`,
// using the same mechanism `bd init --stealth` uses (resolves the git common dir
// via `git rev-parse --git-common-dir` so it works inside worktrees). Entries are
// local-only and never committed.
export function ensureGitExclude(entries) {
  let gitDirPath;
  try {
    gitDirPath = execSync('git rev-parse --git-common-dir', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    console.log('  Not a git repository, skipping git exclude setup');
    return;
  }
  const infoDir = resolve(gitDirPath, 'info');
  const excludePath = resolve(infoDir, 'exclude');
  mkdirSync(infoDir, { recursive: true });
  const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
  const missing = entries.filter(e => !existing.includes(e));
  if (!missing.length) return;
  const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
  const block = missing.join('\n') + '\n';
  writeFileSync(excludePath, existing + prefix + block);
  console.log(`  Added ${missing.join(', ')} to ${excludePath}`);
}

export function installBundledSkills(tools) {
  console.log('\nInstalling agentstack skills...');
  const srcDir = resolve(__dir, '..', 'skills');
  if (!existsSync(srcDir)) return;

  for (const tool of tools) {
    let destDir;
    switch (tool) {
      case 'claude':
        destDir = resolve(homedir(), '.claude', 'skills');
        break;
      case 'codex':
        destDir = resolve(homedir(), '.codex', 'skills');
        break;
      case 'opencode': {
        const isWin = process.platform === 'win32';
        destDir = isWin
          ? win32.join(getOpencodeConfigDir(), 'skills')
          : resolve(getOpencodeConfigDir(), 'skills');
        break;
      }
    }
    copyDirMerge(srcDir, destDir, { overwrite: true });
    console.log(`  ${tool}: ${destDir}`);
  }
}

const MATTPOCOCK_AGENT_NAMES = {
  claude: 'claude-code',
  codex: 'codex',
  opencode: 'opencode',
};

export function installMattpocockSkills(tools) {
  const agents = tools.map(t => MATTPOCOCK_AGENT_NAMES[t]).filter(Boolean);
  if (!agents.length) return;

  console.log('\nInstalling mattpocock/skills...');
  const agentArgs = agents.flatMap(a => ['-a', a]);
  const args = ['skills@latest', 'add', 'mattpocock/skills', '-g', '--skill', '*', '-y', ...agentArgs];
  try {
    execSync(`npx ${args.map(a => JSON.stringify(a)).join(' ')}`, { stdio: 'pipe' });
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    throw err;
  }
}

export function ensureEsmPackageJson() {
  const pkgPath = resolve('.', 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (!pkg.type) {
      pkg.type = 'module';
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      console.log('  package.json: added "type": "module"');
    }
  } else {
    writeFileSync(pkgPath, JSON.stringify({ type: 'module' }, null, 2) + '\n');
    console.log('  package.json: created with "type": "module"');
  }
}

export function setupProject() {
  ensureGitExclude(['.claude/', '.codex/', '.opencode/', '.sandcastle/', 'node_modules/', 'package.json', 'package-lock.json', 'CLAUDE.md', 'AGENTS.md', 'CONTEXT.md', '.mcp.json', '.beads-credential-key']);
  ensureEsmPackageJson();

  if (!existsSync('AGENTS.md')) {
    let template = readFileSync(resolve(__dir, 'agents-template.txt'), 'utf8');
    if (getInstalledVersion('tokf')) {
      template = `# tokf\n\n🗜️ means this output was compressed by tokf.\nRun \`tokf raw last\` to see the full uncompressed output of the last command.\n\n${template}`;
    }
    writeFileSync('AGENTS.md', template);
    console.log('  Created AGENTS.md');
  }

  if (!existsSync('CLAUDE.md')) {
    writeFileSync('CLAUDE.md', '@AGENTS.md\n');
    console.log('  Created CLAUDE.md (references @AGENTS.md)');
  }
}

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
    await setupSandcastleForProject();
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

  // Bundled agentstack skills
  installBundledSkills(tools);

  // External skills (mattpocock/skills)
  installMattpocockSkills(tools);

  // beads (bd) issue tracker — binary only; project init lives behind -p
  await installBeads();



  // pi (pi-coding-agent) — cheap executor for sandcastle tasks
  installPi();
  disablePiSkills();

  ensureBypassPermissions(tools);

  if (tools.includes('claude')) {
    writeEnvVars([{ key: 'CLAUDE_CODE_MAX_CONTEXT_TOKENS', value: '240000' }]);
  }

  console.log('\nDone.');
}

// Run main when executed directly. Skip when imported by another module (e.g. tests).
// In ESM, compare realpath of argv[1] with realpath of this file to handle
// symlinks and npx cache paths.
import { realpathSync } from 'node:fs';

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
