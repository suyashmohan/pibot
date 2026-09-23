"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { shouldHighlight } from "@/lib/file-browser";
import { escapeHtml, highlightToHtml } from "@/lib/highlight";

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(
    () => (shouldHighlight(code.length) ? highlightToHtml(code, language || null) : escapeHtml(code)),
    [code, language],
  );
  return (
    <div className="group/code relative">
      {language && (
        <span className="absolute right-2 top-2 rounded-md bg-raised/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-fg-muted">
          {language}
        </span>
      )}
      <button
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute bottom-2 right-2 rounded-md bg-raised/80 p-1.5 text-fg-muted opacity-0 transition group-hover/code:opacity-100 hover:bg-active hover:text-fg"
        title="Copy code"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre>
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

/**
 * GFM markdown with syntax-highlighted code blocks. `resolveImageUrl`
 * (optional) rewrites relative image sources — the file browser uses it to
 * load screenshots next to the markdown being previewed.
 */
export function Markdown({
  text,
  resolveImageUrl,
}: {
  text: string;
  resolveImageUrl?: (src: string) => string;
}) {
  if (!text) return null;
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre(props) {
            const child = props.children as React.ReactElement<{ children?: React.ReactNode; className?: string }> | undefined;
            // Extract raw code text for the copy button.
            let code = "";
            let language = "";
            try {
              const codeEl = Array.isArray(props.children)
                ? (props.children as React.ReactNode[]).find(
                    (c): c is React.ReactElement<{ children?: React.ReactNode; className?: string }> =>
                      typeof c === "object" && c !== null && "props" in c,
                  )
                : (props.children as React.ReactElement<{ children?: React.ReactNode; className?: string }>);
              const raw = String(codeEl?.props?.children ?? "");
              code = raw.replace(/\n$/, "");
              const cls = String(codeEl?.props?.className ?? "");
              const m = /language-([\w+-]+)/.exec(cls);
              language = m?.[1] ?? "";
            } catch {
              /* ignore */
            }
            void child;
            return <CodeBlock code={code} language={language} />;
          },
          code(props) {
            return <code {...props} />;
          },
          a(props) {
            return <a {...props} target="_blank" rel="noreferrer" />;
          },
          img(props) {
            const src = props.src;
            return (
              <img
                {...props}
                src={typeof src === "string" && resolveImageUrl ? resolveImageUrl(src) : src}
                alt={props.alt ?? ""}
                loading="lazy"
                decoding="async"
              />
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
