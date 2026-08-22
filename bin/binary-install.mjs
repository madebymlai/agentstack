import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { httpsGetJson, getGithubLatestTag } from './net.mjs';
import { getInstalledVersion } from './versions.mjs';
import { detectTarget, detectPlatform, envWithInstallerBinOnPath } from './platform.mjs';

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

export function postInstallCommands(postInstall, tools) {
  if (Array.isArray(postInstall)) return postInstall;
  return tools.flatMap(tool => postInstall[tool] || []);
}

export function runPostInstall(name, server, tools = []) {
  const postInstall = server.postInstall;
  if (!postInstall) return;
  const cmds = postInstallCommands(postInstall, tools);
  if (!cmds?.length) return;

  console.log(`Configuring ${name}...`);
  for (const cmd of cmds) {
    execSync(cmd, { stdio: 'inherit', env: envWithInstallerBinOnPath() });
  }

  console.log(`  Configuration applied.`);
}
