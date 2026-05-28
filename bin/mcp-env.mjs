// Shared semantics for MCP-server environment values across tool configs.
// A value is "concrete" when it is set and is not an unresolved `${VAR}`
// placeholder — only concrete values get written into a tool's config.

export function hasConcreteEnvValue(value, envVar) {
  return Boolean(value && value !== `\${${envVar}}`);
}

export function concreteEnvEntries(env = {}) {
  return Object.entries(env).filter(([k, v]) => hasConcreteEnvValue(v, k));
}

// Replaces `${VAR}` placeholders with a concrete value taken from
// envOverrides first, then process.env. Unmatched placeholders are left as-is.
export function resolveEnvPlaceholders(env, envOverrides) {
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
