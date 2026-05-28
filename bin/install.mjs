#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { copyDirMerge } from './fs-util.mjs';
import { getOpencodeConfigDir, detectTarget, writeEnvVars } from './platform.mjs';
import { REGISTRY } from './registry.mjs';
import { installBinary, runPostInstall } from './binary-install.mjs';
import { multiSelect } from './tui.mjs';
import {
  installBeads,
  setupBeadsForProject,
  installPi,
  disablePiSkills,
  setupSandcastleForProject,
} from './tool-installers.mjs';
import { setupProject } from './project-setup.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

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
        if (!settings.length) {
          console.log(`  codex: already set`);
          break;
        }
        const nextContent = settings.join('\n') + '\n' + content;
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

async function main() {
  const args = process.argv.slice(2);
  const projectOnly = args.includes('--project') || args.includes('-p');
  const rebuild = ['--rebuild', '-r', '-rc'].some(f => args.includes(f));
  const clean = args.includes('--clean') || args.includes('-rc');
  const selectedByFlags = toolsFromFlags(args);

  if (projectOnly) {
    console.log('agentstack project setup\n');
    if (!existsSync('.git')) {
      console.log('Not a git repository. Run from a git repo root.');
      process.exit(1);
    }
    if (clean && !rebuild) {
      console.log('  Note: --clean has no effect without --rebuild');
    }
    setupProject();
    setupBeadsForProject();
    await setupSandcastleForProject({ rebuild, clean });
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
