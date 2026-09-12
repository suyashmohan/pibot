"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Send, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OutgoingImage {
  data: string;
  mimeType: string;
}

interface Props {
  streaming: boolean;
  compacting: boolean;
  queueCounts: { steering: number; followUp: number };
  onSend: (text: string, images: OutgoingImage[], queueMode: "direct" | "steer" | "follow_up") => void;
  onAbort: () => void;
  disabled?: boolean;
}

export function Composer({ streaming, compacting, queueCounts, onSend, onAbort, disabled }: Props) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<OutgoingImage[]>([]);
  const [queueMode, setQueueMode] = useState<"direct" | "steer" | "follow_up">("direct");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [text]);

  const canSend = (text.trim().length > 0 || images.length > 0) && !disabled && !compacting;

  const submit = () => {
    if (!canSend) return;
    const mode = streaming ? (queueMode === "direct" ? "steer" : queueMode) : "direct";
    onSend(text.trim(), images, mode);
    setText("");
    setImages([]);
    setQueueMode("direct");
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const pickImages = async (files: FileList | null) => {
    if (!files) return;
    const next: OutgoingImage[] = [...images];
    for (const f of Array.from(files).slice(0, 4 - images.length)) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 6 * 1024 * 1024) continue;
      const buf = await f.arrayBuffer();
      const b64 = btoa(
        new Uint8Array(buf).reduce((acc, b) => acc + String.fromCharCode(b), ""),
      );
      next.push({ data: b64, mimeType: f.type });
    }
    setImages(next);
  };

  return (
    <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/80 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)] backdrop-blur transition focus-within:border-zinc-500">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {images.map((img, i) => (
            <div key={i} className="relative overflow-hidden rounded-lg border border-zinc-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={`attachment ${i + 1}`}
                className="h-14 w-14 object-cover"
              />
              <button
                onClick={() => setImages((arr) => arr.filter((_, j) => j !== i))}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-zinc-300 hover:text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={
          streaming
            ? "Agent is working… type to steer or queue a follow-up (Enter)"
            : "Ask anything…  (Shift+Enter for newline, / for commands)"
        }
        className="max-h-[200px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
      <div className="flex items-center gap-2 px-3 pb-3 pt-1">
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
          title="Attach images"
        >
          <ImagePlus size={17} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void pickImages(e.target.files);
            e.target.value = "";
          }}
        />
        {streaming && (
          <div className="flex items-center gap-1 rounded-lg bg-zinc-800/80 p-0.5 text-[11.5px]">
            {(
              [
                ["direct", "Steer"],
                ["follow_up", "Follow-up"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setQueueMode(v)}
                className={cn(
                  "rounded-md px-2 py-1 font-medium transition",
                  queueMode === v
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {(queueCounts.steering > 0 || queueCounts.followUp > 0) && (
          <span className="text-[11px] text-zinc-500">
            {queueCounts.steering > 0 && `${queueCounts.steering} steering`}
            {queueCounts.steering > 0 && queueCounts.followUp > 0 && " · "}
            {queueCounts.followUp > 0 && `${queueCounts.followUp} queued`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {streaming && (
            <button
              onClick={onAbort}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-[13px] font-medium text-red-300 transition hover:bg-red-500/20"
            >
              <Square size={13} className="fill-current" />
              Stop
            </button>
          )}
          <button
            onClick={submit}
            disabled={!canSend}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium transition",
              canSend
                ? "bg-zinc-100 text-zinc-950 hover:bg-white"
                : "cursor-not-allowed bg-zinc-800 text-zinc-600",
            )}
          >
            {compacting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
