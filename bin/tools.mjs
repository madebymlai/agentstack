// The Tool seam. Each supported coding agent (claude / codex / opencode) is a
// single adapter object that knows where its config lives and how to write MCP
// servers, permissions, and skills into it. Code that operates "per selected
// tool" loops over these adapters instead of branching on a tool string.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, win32 } from 'node:path';
import { homedir } from 'node:os';

import { getOpencodeConfigDir } from './platform.mjs';
import { hasConcreteEnvValue, concreteEnvEntries, resolveEnvPlaceholders } from './mcp-env.mjs';
import { upsertMcpServer } from './codex-config.mjs';

function codexConfigDir() {
  return process.platform === 'win32'
    ? win32.join(process.env.APPDATA, 'codex')
    : resolve(homedir(), '.codex');
}

function piSettingsPath() {
  return resolve(homedir(), '.pi', 'agent', 'settings.json');
}

// --- per-tool MCP merge (exported for tests; take an explicit config path) ---

export function mergeClaudeMcp(name, entry, configPath) {
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

export function mergeOpencodeMcp(name, entry, configPath) {
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

export function mergeCodexMcp(name, entry, configPath) {
  const content = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const { content: next, status } = upsertMcpServer(content, name, entry);
  if (status === 'unchanged') {
    console.log(`  ${configPath}: "${name}" already configured`);
    return;
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, next);
  console.log(`  ${configPath}: ${status === 'added' ? `added "${name}"` : `updated "${name}" environment`}`);
}

// pi has no permission prompts by design. Its one trust decision is whether a
// project's local settings, resources, and extensions load at all, and
// non-interactive runs fall back to defaultProjectTrust. "always" is the pi
// equivalent of the bypass posture the other adapters set.
export function ensurePiTrust(configPath) {
  let settings = {};
  if (existsSync(configPath)) {
    settings = JSON.parse(readFileSync(configPath, 'utf8'));
  }
  if (settings.defaultProjectTrust === 'always') {
    console.log(`  pi: already set`);
    return;
  }
  settings.defaultProjectTrust = 'always';
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`  pi: defaultProjectTrust = "always" in ${configPath}`);
}

// --- the adapters ---

export const TOOLS = {
  claude: {
    value: 'claude',
    label: 'Claude Code',
    flag: '--claude',
    agentName: 'claude-code',
    mcpConfigPath: () => resolve(homedir(), '.claude.json'),
    mergeMcp(name, entry) {
      mergeClaudeMcp(name, entry, this.mcpConfigPath());
    },
    ensurePermissions() {
      const settingsPath = resolve(homedir(), '.claude', 'settings.json');
      let settings = {};
      if (existsSync(settingsPath)) {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      }
      if (settings.permissions?.defaultMode === 'bypassPermissions') {
        console.log(`  claude: already set`);
        return;
      }
      settings.permissions ??= {};
      settings.permissions.defaultMode = 'bypassPermissions';
      settings.attribution ??= {};
      settings.attribution.commit ??= '';
      settings.attribution.pr ??= '';
      mkdirSync(dirname(settingsPath), { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      console.log(`  claude: bypassPermissions + no co-authored-by in ${settingsPath}`);
    },
  },

  codex: {
    value: 'codex',
    label: 'Codex',
    flag: '--codex',
    agentName: 'codex',
    mcpConfigPath: () => resolve(codexConfigDir(), 'config.toml'),
    mergeMcp(name, entry) {
      mergeCodexMcp(name, entry, this.mcpConfigPath());
    },
    ensurePermissions() {
      const configPath = this.mcpConfigPath();
      const content = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
      const settings = [];
      if (!content.includes('approval_policy')) {
        settings.push('approval_policy = "never"');
      }
      if (!content.includes('sandbox_mode')) {
        settings.push('sandbox_mode = "danger-full-access"');
      }
      if (!settings.length) {
        console.log(`  codex: already set`);
        return;
      }
      const nextContent = settings.join('\n') + '\n' + content;
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, nextContent);
      console.log(`  codex: ${settings.join(', ')} in ${configPath}`);
    },
  },

  opencode: {
    value: 'opencode',
    label: 'OpenCode',
    flag: '--opencode',
    agentName: 'opencode',
    mcpConfigPath: () => resolve(getOpencodeConfigDir(), 'opencode.json'),
    mergeMcp(name, entry) {
      mergeOpencodeMcp(name, entry, this.mcpConfigPath());
    },
    ensurePermissions() {
      const configDir = getOpencodeConfigDir();
      const configPath = resolve(configDir, 'opencode.json');
      let config = {};
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf8'));
      }
      if (config.permission === 'allow') {
        console.log(`  opencode: already set`);
        return;
      }
      config.permission = 'allow';
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log(`  opencode: permission = "allow" in ${configPath}`);
    },
  },

  pi: {
    value: 'pi',
    label: 'pi',
    flag: '--pi',
    agentName: 'pi',
    mcpConfigPath: piSettingsPath,
    // pi ships no built-in MCP client: the core stays small and integrations
    // arrive as extensions that register tools directly. A server that wants pi
    // support generates its own extension under ~/.pi/agent/extensions, so
    // there is no config for this installer to merge.
    mergeMcp(name) {
      console.log(`  pi: no MCP client; ${name} integrates as a pi extension`);
    },
    ensurePermissions() {
      ensurePiTrust(this.mcpConfigPath());
    },
  },
};

export const TOOL_OPTIONS = Object.values(TOOLS).map(({ label, value, flag }) => ({ label, value, flag }));

export function toolsFromFlags(args = process.argv.slice(2)) {
  return TOOL_OPTIONS
    .filter(tool => args.includes(tool.flag))
    .map(tool => tool.value);
}

// --- per-tool install steps (loop the selected tools over their adapters) ---

export function mergeMcpConfig(name, server, tools, envOverrides = {}) {
  if (!server.mcpEntry) return;
  const entry = JSON.parse(JSON.stringify(server.mcpEntry));
  if (entry.env) {
    entry.env = resolveEnvPlaceholders(entry.env, envOverrides);
  }
  for (const tool of tools) {
    TOOLS[tool].mergeMcp(name, entry);
  }
}

export function ensureBypassPermissions(tools) {
  console.log('\nConfiguring permissions...');
  for (const tool of tools) {
    TOOLS[tool].ensurePermissions();
  }
}

export function installBundledSkills(tools) {
  const agents = tools.map(t => TOOLS[t].agentName).filter(Boolean);
  if (!agents.length) return;

  const skills = bundledSkillsForPlatform();

  console.log('\nInstalling groundwork skills...');
  const agentArgs = agents.flatMap(a => ['-a', a]);
  const skillArgs = skills.flatMap(s => ['--skill', s]);
  // No -g: the skills CLI auto-detects project scope and installs into the
  // project's per-agent skill dirs (.claude/skills, .codex/skills, ...).
  const args = ['skills@latest', 'add', 'madebymlai/groundwork', ...skillArgs, '-y', ...agentArgs];
  try {
    execSync(`npx ${args.map(a => JSON.stringify(a)).join(' ')}`, { stdio: 'pipe' });
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    throw err;
  }
}

export function bundledSkillsForPlatform(platform = process.platform) {
  const skills = ['beads', 'design-principles', 'coding-standards'];
  if (platform !== 'linux') skills.push('maintain');
  return skills;
}

// Curated mattpocock/skills, installed by name (not by subfolder path) so the
// set survives the author moving skills between category folders. Stable
// engineering + productivity skills from v1.2.3; deprecated, personal, misc,
// and in-progress skills stay out of the default install.
export const MATTPOCOCK_SKILLS = [
  // engineering
  'code-review', 'codebase-design', 'diagnosing-bugs',
  'domain-modeling', 'grill-with-docs', 'implement',
  'improve-codebase-architecture', 'prototype', 'research',
  'resolving-merge-conflicts', 'tdd', 'to-spec',
  'to-tickets', 'triage',
  // productivity
  'grill-me', 'grilling', 'handoff', 'to-questionnaire',
  'wait-what', 'writing-for-agents',
];

export function installMattpocockSkills(tools) {
  const agents = tools.map(t => TOOLS[t].agentName).filter(Boolean);
  if (!agents.length) return;

  console.log('\nInstalling mattpocock/skills...');
  const agentArgs = agents.flatMap(a => ['-a', a]);
  const skillArgs = MATTPOCOCK_SKILLS.flatMap(s => ['--skill', s]);
  // No -g: install project-local (see installBundledSkills).
  const args = ['skills@latest', 'add', 'mattpocock/skills', ...skillArgs, '-y', ...agentArgs];
  try {
    execSync(`npx ${args.map(a => JSON.stringify(a)).join(' ')}`, { stdio: 'pipe' });
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    throw err;
  }
}
