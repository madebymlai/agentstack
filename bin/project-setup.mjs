import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getInstalledVersion } from './versions.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

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
  ensureGitExclude(['.claude/', '.codex/', '.opencode/', '.sandcastle/', 'node_modules/', 'package.json', 'package-lock.json', 'CLAUDE.md', 'AGENTS.md', 'CONTEXT.md', '.mcp.json', '.beads/', '.beads-credential-key']);
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
