import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { HttpError, isTransientError, withRetry } from '../bin/net.mjs';
import {
  envWithInstallerBinOnPath,
  getOpencodeConfigDir,
  detectPlatform,
  detectTarget,
  getShellProfile,
} from '../bin/platform.mjs';
import { postInstallCommands, verifySha256Checksum } from '../bin/binary-install.mjs';
import { resolveSandcastleMain, buildAfkCommand } from '../bin/afk.mjs';
import { renderLauncher, installCliCommands } from '../bin/cli.mjs';
import { ensureCodeDiscovery } from '../bin/project-setup.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(resolve(tmpdir(), 'agentstack-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function silenceConsole(fn) {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

// ---- net.mjs ----

test('HttpError captures status, url, and retry hint', () => {
  const err = new HttpError(429, 'https://x/y', 'too many', 12);
  assert.equal(err.name, 'HttpError');
  assert.equal(err.status, 429);
  assert.equal(err.url, 'https://x/y');
  assert.equal(err.retryAfterSeconds, 12);
  assert.match(err.message, /HTTP 429 from https:\/\/x\/y/);
});

test('isTransientError: transient HTTP statuses and net codes', () => {
  assert.equal(isTransientError(new HttpError(503, 'u', '')), true);
  assert.equal(isTransientError(new HttpError(429, 'u', '')), true);
  assert.equal(isTransientError(new HttpError(404, 'u', '')), false);
  assert.equal(isTransientError(Object.assign(new Error(), { code: 'ECONNRESET' })), true);
  assert.equal(isTransientError(Object.assign(new Error(), { code: 'ENOSUCH' })), false);
  assert.equal(isTransientError(new Error('plain')), false);
});

test('withRetry: returns immediately on success', async () => {
  let calls = 0;
  const result = await withRetry(async () => { calls++; return 'ok'; });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry: retries transient failures then succeeds', async () => {
  let calls = 0;
  const result = await silenceConsole(() => withRetry(async () => {
    calls++;
    if (calls < 3) throw new HttpError(500, 'u', '');
    return 'recovered';
  }, { baseDelayMs: 1, retries: 5 }));
  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
});

test('withRetry: gives up after exhausting retries', async () => {
  let calls = 0;
  await assert.rejects(
    silenceConsole(() => withRetry(async () => {
      calls++;
      throw new HttpError(503, 'u', '');
    }, { baseDelayMs: 1, retries: 2 })),
    /HTTP 503/,
  );
  assert.equal(calls, 3); // initial + 2 retries
});

test('withRetry: does not retry non-transient errors', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new HttpError(400, 'u', ''); }, { baseDelayMs: 1, retries: 3 }),
    /HTTP 400/,
  );
  assert.equal(calls, 1);
});

// ---- platform.mjs ----

test('envWithInstallerBinOnPath: prepends missing dirs without mutating input', { skip: process.platform === 'win32' }, () => {
  const env = { PATH: '/usr/bin' };
  const out = envWithInstallerBinOnPath(env);
  const dirs = out.PATH.split(delimiter);
  assert.ok(dirs.includes('/usr/bin'));
  assert.ok(dirs.some(d => d.endsWith('/.local/bin')));
  assert.ok(dirs.some(d => d.endsWith('/.bun/bin')));
  // missing dirs go in front of the existing PATH
  assert.equal(dirs[dirs.length - 1], '/usr/bin');
  // input not mutated
  assert.equal(env.PATH, '/usr/bin');
});

test('envWithInstallerBinOnPath: leaves PATH alone when dirs already present', { skip: process.platform === 'win32' }, () => {
  const seeded = envWithInstallerBinOnPath({ PATH: '/usr/bin' });
  const again = envWithInstallerBinOnPath(seeded);
  assert.equal(again.PATH, seeded.PATH);
});

test('getOpencodeConfigDir / detectPlatform on unix', { skip: process.platform === 'win32' }, () => {
  assert.equal(detectPlatform(), 'unix');
  assert.ok(getOpencodeConfigDir().endsWith('/.config/opencode'));
});

test('detectTarget reflects the running platform', () => {
  const target = detectTarget();
  if (process.platform === 'linux' && process.arch === 'x64') {
    assert.equal(target.key, 'linux-x86_64');
    assert.ok(typeof target.installDir === 'string' && target.installDir.length > 0);
  } else if (target) {
    assert.ok(typeof target.key === 'string');
    assert.ok(typeof target.installDir === 'string');
  } else {
    assert.equal(target, null);
  }
});

test('getShellProfile picks profile from $SHELL', () => {
  const original = process.env.SHELL;
  try {
    process.env.SHELL = '/usr/bin/zsh';
    assert.ok(getShellProfile().endsWith('/.zshrc'));
    process.env.SHELL = '/usr/local/bin/fish';
    assert.ok(getShellProfile().endsWith('/fish/config.fish'));
    process.env.SHELL = '/bin/bash';
    assert.ok(getShellProfile().endsWith('/.bashrc'));
    delete process.env.SHELL;
    assert.ok(getShellProfile().endsWith('/.bashrc'));
  } finally {
    if (original === undefined) delete process.env.SHELL;
    else process.env.SHELL = original;
  }
});

// ---- binary-install.mjs ----

test('postInstallCommands: array form passes through', () => {
  assert.deepEqual(postInstallCommands(['a', 'b'], ['claude']), ['a', 'b']);
});

test('postInstallCommands: per-tool map flatMaps selected tools in order', () => {
  const map = { claude: ['c1'], codex: ['x1', 'x2'], opencode: ['o1'] };
  assert.deepEqual(postInstallCommands(map, ['codex', 'claude']), ['x1', 'x2', 'c1']);
  assert.deepEqual(postInstallCommands(map, ['nope']), []);
  assert.deepEqual(postInstallCommands(map, []), []);
});

test('verifySha256Checksum: passes for a matching digest, throws otherwise', () => {
  withTempDir((dir) => {
    const file = resolve(dir, 'asset.bin');
    writeFileSync(file, 'hello world');
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex');

    const goodSum = resolve(dir, 'asset.bin.sha256');
    writeFileSync(goodSum, `${digest}  asset.bin\n`);
    assert.doesNotThrow(() => verifySha256Checksum(file, goodSum, 'asset.bin'));

    const badSum = resolve(dir, 'bad.sha256');
    writeFileSync(badSum, `${'0'.repeat(64)}  asset.bin\n`);
    assert.throws(() => verifySha256Checksum(file, badSum, 'asset.bin'), /Checksum mismatch/);

    const junkSum = resolve(dir, 'junk.sha256');
    writeFileSync(junkSum, 'not-a-checksum\n');
    assert.throws(() => verifySha256Checksum(file, junkSum, 'asset.bin'), /Invalid SHA256 checksum file/);
  });
});

// ---- afk.mjs ----

test('resolveSandcastleMain: finds main.ts and returns a project-relative path', () => {
  withTempDir((dir) => {
    mkdirSync(resolve(dir, '.sandcastle'), { recursive: true });
    writeFileSync(resolve(dir, '.sandcastle', 'main.ts'), '// noop');
    assert.equal(resolveSandcastleMain(dir), join('.sandcastle', 'main.ts'));
  });
});

test('resolveSandcastleMain: prefers main.ts over main.mts', () => {
  withTempDir((dir) => {
    mkdirSync(resolve(dir, '.sandcastle'), { recursive: true });
    writeFileSync(resolve(dir, '.sandcastle', 'main.ts'), '// noop');
    writeFileSync(resolve(dir, '.sandcastle', 'main.mts'), '// noop');
    assert.match(resolveSandcastleMain(dir), /main\.ts$/);
  });
});

test('resolveSandcastleMain: falls back to main.mts', () => {
  withTempDir((dir) => {
    mkdirSync(resolve(dir, '.sandcastle'), { recursive: true });
    writeFileSync(resolve(dir, '.sandcastle', 'main.mts'), '// noop');
    assert.match(resolveSandcastleMain(dir), /main\.mts$/);
  });
});

test('resolveSandcastleMain: throws with setup guidance when .sandcastle is missing', () => {
  withTempDir((dir) => {
    assert.throws(() => resolveSandcastleMain(dir), /Set up sandcastle/);
  });
});

test('buildAfkCommand: wraps npx tsx and forwards passthrough args', () => {
  assert.deepEqual(buildAfkCommand('.sandcastle/main.ts'), {
    command: 'npx',
    args: ['tsx', '.sandcastle/main.ts'],
  });
  assert.deepEqual(buildAfkCommand('.sandcastle/main.ts', ['--foo', 'bar']), {
    command: 'npx',
    args: ['tsx', '.sandcastle/main.ts', '--foo', 'bar'],
  });
});

// ---- cli.mjs ----

test('renderLauncher: POSIX shim execs node, marked executable', () => {
  const launcher = renderLauncher('afk', '/stable/afk.mjs', 'linux');
  assert.equal(launcher.filename, 'afk');
  assert.equal(launcher.executable, true);
  assert.match(launcher.content, /^#!\/bin\/sh\n/);
  assert.match(launcher.content, /exec node "\/stable\/afk\.mjs" "\$@"/);
});

test('renderLauncher: Windows shim is a .cmd forwarding %*', () => {
  const launcher = renderLauncher('afk', 'C:\\stable\\afk.mjs', 'win32');
  assert.equal(launcher.filename, 'afk.cmd');
  assert.equal(launcher.executable, false);
  assert.match(launcher.content, /node "C:\\stable\\afk\.mjs" %\*/);
});

test('installCliCommands: copies entry to dataDir and writes a launcher on PATH', () => {
  withTempDir((root) => {
    const sourceDir = resolve(root, 'src');
    const dataDir = resolve(root, 'data');
    const binDir = resolve(root, 'bin');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(resolve(sourceDir, 'afk.mjs'), '// afk entry');

    const origLog = console.log;
    console.log = () => {};
    let written;
    try {
      written = installCliCommands({ binDir, dataDir, sourceDir, platform: 'linux' });
    } finally {
      console.log = origLog;
    }

    // entry copied to the stable data dir
    assert.equal(readFileSync(resolve(dataDir, 'afk.mjs'), 'utf8'), '// afk entry');

    // launcher written to binDir and points at the stable copy
    const launcher = resolve(binDir, 'afk');
    assert.deepEqual(written, [launcher]);
    assert.match(readFileSync(launcher, 'utf8'), new RegExp(`node "${resolve(dataDir, 'afk.mjs')}"`));
  });
});

// ---- project-setup.mjs ----

test('ensureCodeDiscovery appends a <code-discovery> block and refreshes in place', () => {
  withTempDir((dir) => {
    const claudeMd = join(dir, 'CLAUDE.md');
    writeFileSync(claudeMd, '@AGENTS.md\n');

    const origLog = console.log;
    console.log = () => {};
    try {
      ensureCodeDiscovery(claudeMd);
      ensureCodeDiscovery(claudeMd); // re-run must replace, not duplicate
    } finally {
      console.log = origLog;
    }

    const content = readFileSync(claudeMd, 'utf8');
    assert.ok(content.startsWith('@AGENTS.md'));
    assert.match(content, /codebase-memory-mcp/);
    assert.equal(content.split('<code-discovery>').length - 1, 1);
    assert.equal(content.split('</code-discovery>').length - 1, 1);
  });
});
