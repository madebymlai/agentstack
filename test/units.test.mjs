import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
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
import { copyDirMerge } from '../bin/fs-util.mjs';
import { resolveSandcastleMain, buildAfkCommand } from '../bin/afk.mjs';
import { renderLauncher, installCliCommands } from '../bin/cli.mjs';
import {
  detectWorktreeCopyDirs,
  detectMiseVersionFiles,
  detectDepInstallCommands,
  patchContainerfileForMise,
  patchMainForMise,
} from '../bin/sandcastle-setup.mjs';

// A vanilla sandcastle-generated main.ts, trimmed to the anchors the mise patch rewrites.
const VANILLA_MAIN = [
  'import { z } from "zod";',
  '',
  'const copyToWorktree = ["node_modules"];',
  '',
  'const hooks = {',
  '  sandbox: {',
  '    onSandboxReady: [{ command: "npm install" }],',
  '  },',
  '};',
  '',
  'const plan = await sandcastle.run({ hooks, sandbox: podman(), name: "planner" });',
  '',
].join('\n');

// A vanilla sandcastle-generated Containerfile, trimmed to the system-deps block the
// mise patch anchors on.
const VANILLA_CONTAINERFILE = [
  'FROM node:22-bookworm',
  '',
  '# Install system dependencies',
  'RUN apt-get update && apt-get install -y \\',
  '  git \\',
  '  curl \\',
  '  jq \\',
  '  && rm -rf /var/lib/apt/lists/*',
  '',
  'RUN corepack enable',
  '',
].join('\n');

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

// ---- fs-util.mjs ----

test('copyDirMerge: copies recursively and respects overwrite', () => {
  withTempDir((root) => {
    const src = resolve(root, 'src');
    const dest = resolve(root, 'dest');
    mkdirSync(resolve(src, 'nested'), { recursive: true });
    writeFileSync(resolve(src, 'top.txt'), 'SRC-top');
    writeFileSync(resolve(src, 'nested', 'deep.txt'), 'SRC-deep');

    // pre-existing dest file that should survive overwrite:false
    mkdirSync(dest, { recursive: true });
    writeFileSync(resolve(dest, 'top.txt'), 'DEST-top');

    copyDirMerge(src, dest, { overwrite: false });
    assert.equal(readFileSync(resolve(dest, 'top.txt'), 'utf8'), 'DEST-top'); // not overwritten
    assert.equal(readFileSync(resolve(dest, 'nested', 'deep.txt'), 'utf8'), 'SRC-deep'); // new file copied

    copyDirMerge(src, dest, { overwrite: true });
    assert.equal(readFileSync(resolve(dest, 'top.txt'), 'utf8'), 'SRC-top'); // now overwritten
    assert.ok(existsSync(resolve(dest, 'nested', 'deep.txt')));
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
    assert.throws(() => resolveSandcastleMain(dir), /agentstack --project/);
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

// ---- sandcastle-setup.mjs ----

test('detectWorktreeCopyDirs: Node project copies node_modules + .beads', () => {
  withTempDir((dir) => {
    writeFileSync(resolve(dir, 'package.json'), '{}');
    assert.deepEqual(detectWorktreeCopyDirs(dir), ['node_modules', '.beads']);
  });
});

test('detectWorktreeCopyDirs: Python project copies .venv, not node_modules', () => {
  withTempDir((dir) => {
    writeFileSync(resolve(dir, 'pyproject.toml'), '');
    assert.deepEqual(detectWorktreeCopyDirs(dir), ['.venv', '.beads']);
  });
});

test('detectWorktreeCopyDirs: polyglot project copies every detected language dir', () => {
  withTempDir((dir) => {
    writeFileSync(resolve(dir, 'package.json'), '{}');
    writeFileSync(resolve(dir, 'requirements.txt'), '');
    writeFileSync(resolve(dir, 'Cargo.toml'), '');
    assert.deepEqual(detectWorktreeCopyDirs(dir), ['node_modules', '.venv', 'target', '.beads']);
  });
});

test('patchContainerfileForMise: installs mise after the system-deps block', () => {
  const out = patchContainerfileForMise(VANILLA_CONTAINERFILE, []);
  assert.match(out, /curl https:\/\/mise\.run \| MISE_INSTALL_PATH=\/usr\/local\/bin\/mise sh/);
  assert.match(out, /ENV MISE_DATA_DIR="\/usr\/local\/share\/mise"/);
  assert.match(out, /ENV PATH="\/usr\/local\/share\/mise\/shims:\$PATH"/);
});

test('patchContainerfileForMise: bakes detected version files into image layers at build time', () => {
  const out = patchContainerfileForMise(VANILLA_CONTAINERFILE, ['mise.toml', '.tool-versions']);
  assert.match(out, /COPY mise\.toml \.tool-versions \/opt\/mise-bake\//);
  assert.match(out, /mise install -C \/opt\/mise-bake/);
});

test('detectDepInstallCommands: picks the right install per language', () => {
  withTempDir((dir) => {
    writeFileSync(resolve(dir, 'package.json'), '{}');
    writeFileSync(resolve(dir, 'Cargo.toml'), '');
    assert.deepEqual(detectDepInstallCommands(dir), ['npm install', 'cargo fetch']);
  });
});

test('detectDepInstallCommands: prefers a lockfile over a looser manifest within a language', () => {
  withTempDir((dir) => {
    writeFileSync(resolve(dir, 'uv.lock'), '');
    writeFileSync(resolve(dir, 'requirements.txt'), '');
    writeFileSync(resolve(dir, 'pyproject.toml'), '');
    // One Python command, and it's uv sync (the lockfile), not pip.
    assert.deepEqual(detectDepInstallCommands(dir), ['uv sync']);
  });
});

test('detectDepInstallCommands: empty when no recognized manifest', () => {
  withTempDir((dir) => {
    assert.deepEqual(detectDepInstallCommands(dir), []);
  });
});

test('patchMainForMise: mounts ~/.pi/agent and a pkg cache, but NOT an unbounded toolchain dir', () => {
  const out = patchMainForMise(VANILLA_MAIN, ['node_modules', '.beads']);
  assert.match(out, /hostPath: "~\/\.pi\/agent"/);
  assert.match(out, /hostPath: "~\/\.cache\/sandcastle-pkgs", sandboxPath: "\/home\/agent\/\.cache"/);
  // The old design mounted the mise toolchain dir at runtime — the source of unbounded growth.
  assert.doesNotMatch(out, /\/home\/agent\/\.local\/share\/mise/);
});

test('patchMainForMise: onSandboxReady reconciles toolchain, prunes, then runs each language install', () => {
  const out = patchMainForMise(VANILLA_MAIN, ['.venv', 'target', '.beads'], ['uv sync', 'cargo fetch']);
  // mise install reconciles any pin the baked image missed; prune bounds the runtime cache;
  // then the project's own language installs run (not a hardcoded npm install).
  const ready = out.match(/onSandboxReady: \[(.*?)\]/s)[1];
  assert.match(ready, /command: "mise install"/);
  assert.match(ready, /prune/);
  assert.match(ready, /command: "uv sync"/);
  assert.match(ready, /command: "cargo fetch"/);
  assert.ok(ready.indexOf('mise install') < ready.indexOf('uv sync'), 'mise install runs before deps');
});

test('patchMainForMise: sets copyToWorktree to the given dirs', () => {
  const out = patchMainForMise(VANILLA_MAIN, ['target', '.beads']);
  assert.match(out, /const copyToWorktree = \["target", "\.beads"\];/);
});

test('detectMiseVersionFiles: returns only the version manifests that exist', () => {
  withTempDir((dir) => {
    writeFileSync(resolve(dir, '.tool-versions'), '');
    writeFileSync(resolve(dir, '.nvmrc'), '20');
    assert.deepEqual(detectMiseVersionFiles(dir), ['.tool-versions', '.nvmrc']);
  });
});

test('detectMiseVersionFiles: empty when the project pins nothing', () => {
  withTempDir((dir) => {
    assert.deepEqual(detectMiseVersionFiles(dir), []);
  });
});

test('patchContainerfileForMise: redirects every package manager cache into one dir', () => {
  const out = patchContainerfileForMise(VANILLA_CONTAINERFILE, []);
  assert.match(out, /ENV CARGO_HOME="\/home\/agent\/\.cache\/cargo"/);
  assert.match(out, /ENV NPM_CONFIG_CACHE="\/home\/agent\/\.cache\/npm"/);
  assert.match(out, /ENV GRADLE_USER_HOME="\/home\/agent\/\.cache\/gradle"/);
  assert.match(out, /ENV GOMODCACHE="\/home\/agent\/\.cache\/go\/mod"/);
});

test('patchContainerfileForMise: is idempotent', () => {
  const once = patchContainerfileForMise(VANILLA_CONTAINERFILE, ['mise.toml']);
  const twice = patchContainerfileForMise(once, ['mise.toml']);
  assert.equal(twice, once);
});

test('patchContainerfileForMise: no version files means no build-time bake step', () => {
  const out = patchContainerfileForMise(VANILLA_CONTAINERFILE, []);
  assert.doesNotMatch(out, /mise install/);
  assert.doesNotMatch(out, /^COPY /m);
});

test('detectWorktreeCopyDirs: Flutter/Dart project copies .dart_tool', () => {
  withTempDir((dir) => {
    writeFileSync(resolve(dir, 'pubspec.yaml'), '');
    assert.deepEqual(detectWorktreeCopyDirs(dir), ['.dart_tool', '.beads']);
  });
});

test('detectWorktreeCopyDirs: no markers still copies .beads', () => {
  withTempDir((dir) => {
    assert.deepEqual(detectWorktreeCopyDirs(dir), ['.beads']);
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
