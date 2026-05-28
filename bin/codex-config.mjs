// Pure string transforms for codex's `config.toml`. codex stores MCP servers
// as TOML, which we edit textually (parse→mutate→serialize would reorder/strip
// the user's comments and formatting). These functions take the file text and
// return new text — all file IO lives in the codex Tool adapter.
import { concreteEnvEntries, hasConcreteEnvValue } from './mcp-env.mjs';

// Reads `envVar` from the `[mcp_servers.<name>.env]` table, or null if absent.
export function readMcpEnv(content, name, envVar) {
  const section = `[mcp_servers.${name}.env]`;
  const start = content.indexOf(section);
  if (start === -1) return null;
  const rest = content.slice(start + section.length);
  const nextSection = rest.search(/\n\[/);
  const body = nextSection === -1 ? rest : rest.slice(0, nextSection);
  const match = body.match(new RegExp(`^\\s*${envVar}\\s*=\\s*["']([^"']+)["']`, 'm'));
  return match?.[1] || null;
}

function setMcpEnv(content, name, envVar, value) {
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

// Upserts an MCP server into config.toml text. When the server already exists,
// only fills in env keys that are missing a concrete value (never clobbers a
// user-set value). Returns the new text and which case applied.
//
// @returns {{ content: string, status: 'added' | 'updated' | 'unchanged' }}
export function upsertMcpServer(content, name, entry) {
  const header = `[mcp_servers.${name}]`;
  if (content.includes(header)) {
    let next = content;
    for (const [k, v] of concreteEnvEntries(entry.env)) {
      if (hasConcreteEnvValue(readMcpEnv(next, name, k), k)) continue;
      next = setMcpEnv(next, name, k, v);
    }
    return { content: next, status: next === content ? 'unchanged' : 'updated' };
  }

  let block = `\n${header}\ncommand = "${entry.command}"\nargs = [${entry.args.map(a => `"${a}"`).join(', ')}]\n`;
  if (entry.env) {
    for (const [k, v] of Object.entries(entry.env)) {
      block += `\n[mcp_servers.${name}.env]\n${k} = "${v}"\n`;
    }
  }
  return { content: content + block, status: 'added' };
}
