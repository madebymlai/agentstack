import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { resolve, win32 } from 'node:path';
import { tmpdir } from 'node:os';

import { hasConcreteEnvValue, concreteEnvEntries, resolveEnvPlaceholders } from '../bin/mcp-env.mjs';
import { upsertMcpServer, readMcpEnv } from '../bin/codex-config.mjs';
import {
  TOOLS,
  TOOL_OPTIONS,
  toolsFromFlags,
  mergeClaudeMcp,
  mergeOpencodeMcp,
  mergeCodexMcp,
  bundledSkillsForPlatform,
  MATTPOCOCK_SKILLS,
} from '../bin/tools.mjs';
import { getBeadsConfigDir, installBeadsPrime } from '../bin/tool-installers.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(resolve(tmpdir(), 'agentstack-tools-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function quiet(fn) {
  const original = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = original;
  }
}

// ---- mcp-env.mjs ----

test('hasConcreteEnvValue: concrete vs placeholder vs empty', () => {
  assert.equal(hasConcreteEnvValue('xyz', 'V'), true);
  assert.equal(hasConcreteEnvValue('${V}', 'V'), false);
  assert.equal(hasConcreteEnvValue('', 'V'), false);
  assert.equal(hasConcreteEnvValue(undefined, 'V'), false);
  assert.equal(hasConcreteEnvValue(null, 'V'), false);
  // a placeholder for a *different* var is still concrete for this one
  assert.equal(hasConcreteEnvValue('${OTHER}', 'V'), true);
});

test('concreteEnvEntries: drops placeholders and empties', () => {
  assert.deepEqual(
    concreteEnvEntries({ A: 'x', B: '${B}', C: '', D: 'y' }),
    [['A', 'x'], ['D', 'y']],
  );
  assert.deepEqual(concreteEnvEntries(), []);
});

test('resolveEnvPlaceholders: overrides first, then process.env, leaving the rest', () => {
  const prev = process.env.AGENTSTACK_TEST_VAR;
  try {
    process.env.AGENTSTACK_TEST_VAR = 'from-env';
    const out = resolveEnvPlaceholders(
      { FROM_OVERRIDE: '${FOO}', FROM_ENV: '${AGENTSTACK_TEST_VAR}', LITERAL: 'plain', MISSING: '${NOPE_NOT_SET}' },
      { FOO: 'from-override' },
    );
    assert.equal(out.FROM_OVERRIDE, 'from-override');
    assert.equal(out.FROM_ENV, 'from-env');
    assert.equal(out.LITERAL, 'plain');
    assert.equal(out.MISSING, '${NOPE_NOT_SET}'); // unresolved placeholder left as-is
  } finally {
    if (prev === undefined) delete process.env.AGENTSTACK_TEST_VAR;
    else process.env.AGENTSTACK_TEST_VAR = prev;
  }
});

// ---- codex-config.mjs ----

test('upsertMcpServer: adds a new server block', () => {
  const entry = { command: 'node', args: ['x.mjs', '--flag'], env: { KEY: 'val' } };
  const { content, status } = upsertMcpServer('', 'srv', entry);
  assert.equal(status, 'added');
  assert.match(content, /\[mcp_servers\.srv\]/);
  assert.match(content, /command = "node"/);
  assert.match(content, /args = \["x\.mjs", "--flag"\]/);
  assert.match(content, /\[mcp_servers\.srv\.env\]/);
  assert.equal(readMcpEnv(content, 'srv', 'KEY'), 'val');
});

test('upsertMcpServer: re-adding the same server is a no-op (unchanged)', () => {
  const entry = { command: 'node', args: ['x.mjs'], env: { KEY: 'val' } };
  const first = upsertMcpServer('', 'srv', entry);
  const second = upsertMcpServer(first.content, 'srv', entry);
  assert.equal(second.status, 'unchanged');
  assert.equal(second.content, first.content);
});

test('upsertMcpServer: fills a missing env key on an existing server (updated)', () => {
  const base = upsertMcpServer('', 'srv', { command: 'node', args: ['x'], env: {} }).content;
  const { content, status } = upsertMcpServer(base, 'srv', { command: 'node', args: ['x'], env: { TOKEN: 'abc' } });
  assert.equal(status, 'updated');
  assert.equal(readMcpEnv(content, 'srv', 'TOKEN'), 'abc');
});

test('upsertMcpServer: never clobbers a user-set concrete env value', () => {
  const base = upsertMcpServer('', 'srv', { command: 'node', args: ['x'], env: { TOKEN: 'user-value' } }).content;
  const { content, status } = upsertMcpServer(base, 'srv', { command: 'node', args: ['x'], env: { TOKEN: 'installer-value' } });
  assert.equal(status, 'unchanged');
  assert.equal(readMcpEnv(content, 'srv', 'TOKEN'), 'user-value');
});

test('readMcpEnv: null when server or key absent', () => {
  assert.equal(readMcpEnv('', 'srv', 'KEY'), null);
  const content = upsertMcpServer('', 'srv', { command: 'n', args: [], env: { A: '1' } }).content;
  assert.equal(readMcpEnv(content, 'srv', 'MISSING'), null);
});

// ---- tools.mjs: options & flags ----

test('TOOL_OPTIONS: claude, codex, opencode in order with label/value/flag', () => {
  assert.deepEqual(TOOL_OPTIONS, [
    { label: 'Claude Code', value: 'claude', flag: '--claude' },
    { label: 'Codex', value: 'codex', flag: '--codex' },
    { label: 'OpenCode', value: 'opencode', flag: '--opencode' },
  ]);
});

test('toolsFromFlags: returns selected tools in TOOL_OPTIONS order', () => {
  assert.deepEqual(toolsFromFlags(['--codex', '--claude']), ['claude', 'codex']);
  assert.deepEqual(toolsFromFlags(['--opencode']), ['opencode']);
  assert.deepEqual(toolsFromFlags(['--claude', '--codex', '--opencode']), ['claude', 'codex', 'opencode']);
  assert.deepEqual(toolsFromFlags([]), []);
  assert.deepEqual(toolsFromFlags(['--unknown']), []);
});

test('bundledSkillsForPlatform: includes coding standards from agentstack', () => {
  assert.deepEqual(bundledSkillsForPlatform('linux'), [
    'beads',
    'design-principles',
    'coding-standards',
  ]);
  assert.deepEqual(bundledSkillsForPlatform('darwin'), [
    'beads',
    'design-principles',
    'coding-standards',
    'maintain',
  ]);
});

test('MATTPOCOCK_SKILLS: installs from the live skills CLI', { timeout: 120_000 }, () => {
  withTempDir((dir) => {
    const args = [
      '-y',
      'skills@latest',
      'add',
      'mattpocock/skills',
      ...MATTPOCOCK_SKILLS.flatMap(s => ['--skill', s]),
      '-y',
      '-a',
      'codex',
    ];
    const result = spawnSync('npx', args, {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', NO_COLOR: '1' },
      timeout: 120_000,
    });

    assert.equal(
      result.status,
      0,
      `skills CLI failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const installedSkills = readdirSync(resolve(dir, '.agents', 'skills')).sort();
    const expectedSkills = [...MATTPOCOCK_SKILLS].sort();
    const missingSkills = expectedSkills.filter(skill => !installedSkills.includes(skill));
    const unexpectedSkills = installedSkills.filter(skill => !expectedSkills.includes(skill));

    assert.deepEqual(
      missingSkills,
      [],
      `skills CLI did not install these curated skills: ${missingSkills.join(', ')}`,
    );
    assert.deepEqual(
      unexpectedSkills,
      [],
      `skills CLI installed unexpected skills: ${unexpectedSkills.join(', ')}`,
    );
  });
});

test('getBeadsConfigDir: follows OS user config locations', () => {
  withTempDir((dir) => {
    const home = resolve(dir, 'home');

    assert.equal(
      getBeadsConfigDir({ platform: 'linux', home, env: {} }),
      resolve(home, '.config', 'beads'),
    );
    assert.equal(
      getBeadsConfigDir({ platform: 'linux', home, env: { XDG_CONFIG_HOME: resolve(dir, 'xdg') } }),
      resolve(dir, 'xdg', 'beads'),
    );
    assert.equal(
      getBeadsConfigDir({ platform: 'darwin', home, env: {} }),
      resolve(home, 'Library', 'Application Support', 'beads'),
    );
    assert.equal(
      getBeadsConfigDir({
        platform: 'win32',
        home: 'C:\\Users\\agent',
        env: { APPDATA: 'C:\\Users\\agent\\AppData\\Roaming' },
      }),
      win32.join('C:\\Users\\agent\\AppData\\Roaming', 'beads'),
    );
  });
});

test('installBeadsPrime: copies PRIME.md into the beads config dir', () => {
  withTempDir((dir) => {
    const sourcePath = resolve(dir, 'prime.txt');
    const configDir = resolve(dir, 'config', 'beads');
    writeFileSync(sourcePath, '# Beads\n\nTest prime.\n');

    const targetPath = quiet(() => installBeadsPrime({ configDir, sourcePath }));

    assert.equal(targetPath, resolve(configDir, 'PRIME.md'));
    assert.equal(readFileSync(targetPath, 'utf8'), '# Beads\n\nTest prime.\n');
  });
});

// ---- tools.mjs: adapter paths ----

test('adapter config paths and metadata', { skip: process.platform === 'win32' }, () => {
  assert.ok(TOOLS.claude.mcpConfigPath().endsWith('/.claude.json'));
  assert.equal(TOOLS.claude.agentName, 'claude-code');

  assert.ok(TOOLS.codex.mcpConfigPath().endsWith('/.codex/config.toml'));
  assert.equal(TOOLS.codex.agentName, 'codex');

  assert.ok(TOOLS.opencode.mcpConfigPath().endsWith('/.config/opencode/opencode.json'));
  assert.equal(TOOLS.opencode.agentName, 'opencode');
});

// ---- tools.mjs: per-tool MCP merge (JSON tools) ----

test('mergeClaudeMcp: adds, fills placeholder env, and is idempotent', () => {
  withTempDir((dir) => {
    const cfg = resolve(dir, 'claude.json');

    quiet(() => mergeClaudeMcp('srv', { command: 'node', args: ['a'], env: { KEY: 'v' } }, cfg));
    let parsed = JSON.parse(readFileSync(cfg, 'utf8'));
    assert.deepEqual(parsed.mcpServers.srv, { command: 'node', args: ['a'], env: { KEY: 'v' } });

    // a config where the env value is still a placeholder gets filled in
    writeFileSync(cfg, JSON.stringify({ mcpServers: { srv: { command: 'node', args: ['a'], env: { KEY: '${KEY}' } } } }, null, 2) + '\n');
    quiet(() => mergeClaudeMcp('srv', { command: 'node', args: ['a'], env: { KEY: 'concrete' } }, cfg));
    parsed = JSON.parse(readFileSync(cfg, 'utf8'));
    assert.equal(parsed.mcpServers.srv.env.KEY, 'concrete');

    // re-running with the same concrete value leaves the file byte-for-byte unchanged
    const before = readFileSync(cfg, 'utf8');
    quiet(() => mergeClaudeMcp('srv', { command: 'node', args: ['a'], env: { KEY: 'concrete' } }, cfg));
    assert.equal(readFileSync(cfg, 'utf8'), before);
  });
});

test('mergeOpencodeMcp: writes the opencode local-server shape', () => {
  withTempDir((dir) => {
    const cfg = resolve(dir, 'opencode.json');
    quiet(() => mergeOpencodeMcp('srv', { command: 'node', args: ['a', 'b'], env: { KEY: 'v' } }, cfg));
    const parsed = JSON.parse(readFileSync(cfg, 'utf8'));
    assert.deepEqual(parsed.mcp.srv, {
      type: 'local',
      command: ['node', 'a', 'b'],
      environment: { KEY: 'v' },
      enabled: true,
    });
  });
});

test('mergeCodexMcp: writes TOML and is idempotent on disk', () => {
  withTempDir((dir) => {
    const cfg = resolve(dir, 'config.toml');
    quiet(() => mergeCodexMcp('srv', { command: 'node', args: ['a'], env: { KEY: 'v' } }, cfg));
    assert.ok(existsSync(cfg));
    const first = readFileSync(cfg, 'utf8');
    assert.match(first, /\[mcp_servers\.srv\]/);

    quiet(() => mergeCodexMcp('srv', { command: 'node', args: ['a'], env: { KEY: 'v' } }, cfg));
    assert.equal(readFileSync(cfg, 'utf8'), first); // unchanged on re-run
  });
});
