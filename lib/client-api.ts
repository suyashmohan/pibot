export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Request failed (${res.status})` };
  }
  const obj = body as { ok?: boolean; data?: T; error?: string };
  if (!res.ok || obj.ok === false) {
    return { ok: false, error: obj.error ?? `Request failed (${res.status})` };
  }
  return { ok: true, data: obj.data as T };
}

export interface SessionListItem {
  id: string;
  name: string;
  cwd: string;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  piSessionId: string | null;
  piSessionFile: string | null;
  createdAt: number;
  updatedAt: number;
  preview: string | null;
  messageCount: number;
}

export interface ProjectListItem {
  path: string;
  name: string;
  pinned: boolean;
  missing: boolean;
  sessionCount: number;
  updatedAt: number;
}
