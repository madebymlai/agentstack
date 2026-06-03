import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const CODE_DISCOVERY_START = '<code-discovery>';
const CODE_DISCOVERY_END = '</code-discovery>';

// Append (or refresh) the codebase-memory code-discovery guidance as a
// <code-discovery> ... </code-discovery> block in the project's CLAUDE.md. The
// tags bound an agentstack-managed region, so re-running setup replaces the
// block in place instead of duplicating it.
export function ensureCodeDiscovery(claudeMdPath = 'CLAUDE.md') {
  const text = readFileSync(resolve(__dir, 'code-discovery.txt'), 'utf8').trim();
  const block = `${CODE_DISCOVERY_START}\n${text}\n${CODE_DISCOVERY_END}\n`;
  const existing = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : '';

  const start = existing.indexOf(CODE_DISCOVERY_START);
  const end = existing.indexOf(CODE_DISCOVERY_END, start + 1);
  if (start !== -1 && end !== -1) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + CODE_DISCOVERY_END.length).replace(/^\n/, '');
    writeFileSync(claudeMdPath, before + block + after);
    console.log(`  ${claudeMdPath}: refreshed <code-discovery> block`);
    return;
  }

  const gap = existing === '' || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(claudeMdPath, existing + gap + block);
  console.log(`  ${claudeMdPath}: added <code-discovery> block`);
}

export function setupProject() {
  ensureGitExclude(['.claude/', '.codex/', '.opencode/', '.sandcastle/', 'node_modules/', 'package.json', 'package-lock.json', 'CLAUDE.md', 'AGENTS.md', 'CONTEXT.md', 'CODING_STANDARDS.md', '.mcp.json', '.beads/', '.beads-credential-key']);
  ensureEsmPackageJson();

  if (!existsSync('AGENTS.md')) {
    const template = readFileSync(resolve(__dir, 'agents-template.txt'), 'utf8');
    writeFileSync('AGENTS.md', template);
    console.log('  Created AGENTS.md');
  }

  if (!existsSync('CLAUDE.md')) {
    writeFileSync('CLAUDE.md', '@AGENTS.md\n');
    console.log('  Created CLAUDE.md (references @AGENTS.md)');
  }

  ensureCodeDiscovery();
}
