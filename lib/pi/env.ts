export function piBinary(): string {
  return process.env.PI_BINARY?.trim() || "pi";
}

export function defaultCwd(): string {
  return (
    process.env.PI_DEFAULT_CWD?.trim() ||
    process.env.PIBOT_DEFAULT_CWD?.trim() ||
    process.cwd()
  );
}

export function extraArgs(): string[] {
  const raw = process.env.PI_EXTRA_ARGS?.trim();
  if (!raw) return [];
  // Minimal shell-like split supporting double quotes.
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function rpcTimeoutMs(): number {
  const n = Number(process.env.PI_RPC_TIMEOUT_MS ?? "120000");
  return Number.isFinite(n) && n > 0 ? n : 120000;
}
