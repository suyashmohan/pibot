"use client";

import { useEffect, useState } from "react";
import { FolderGit2, Loader2 } from "lucide-react";
import { api } from "@/lib/client-api";

export function NewSessionModal({
  defaultCwd,
  initialCwd,
  suggestions = [],
  onClose,
  onCreated,
}: {
  defaultCwd: string;
  initialCwd?: string;
  suggestions?: string[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState(initialCwd || defaultCwd);
  const [touchedCwd, setTouchedCwd] = useState(false);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // defaultCwd loads async (health check); fill it in unless the user
  // already typed something or a project pre-selected the folder.
  useEffect(() => {
    if (!touchedCwd && !initialCwd && defaultCwd && !cwd) setCwd(defaultCwd);
  }, [defaultCwd, touchedCwd, initialCwd, cwd]);

  const create = async () => {
    if (!cwd.trim()) {
      setError("Working directory is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await api<{ session: { id: string } }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim() || undefined,
        cwd: cwd.trim(),
        provider: provider.trim() || undefined,
        model: model.trim() || undefined,
      }),
    });
    setSaving(false);
    if (!r.ok || !r.data) {
      setError(r.error ?? "Failed to create session");
      return;
    }
    onCreated(r.data.session.id);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="fade-up w-full max-w-md overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-800 px-5 py-4">
          <h3 className="text-[14px] font-semibold">New session</h3>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Spawns a dedicated <span className="font-mono">pi --mode rpc</span> process.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-zinc-400">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Refactor auth module"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-[13px] focus:border-zinc-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-zinc-400">
              <FolderGit2 size={11} /> Working directory (tool sandbox)
            </span>
            <input
              value={cwd}
              onChange={(e) => {
                setCwd(e.target.value);
                setTouchedCwd(true);
              }}
              list="pibot-project-folders"
              placeholder="/path/to/project"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[12px] focus:border-zinc-500 focus:outline-none"
            />
            {suggestions.length > 0 && (
              <datalist id="pibot-project-folders">
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-zinc-400">Provider (optional)</span>
              <input
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="google"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[12px] focus:border-zinc-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-zinc-400">Model (optional)</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gemini-2.5-pro"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[12px] focus:border-zinc-500 focus:outline-none"
              />
            </label>
          </div>
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => void create()}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-100 px-4 py-2.5 text-[13px] font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Start session
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-zinc-700 px-4 py-2.5 text-[13px] text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
