"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code relative">
      {language && (
        <span className="absolute right-2 top-2 rounded-md bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
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
        className="absolute bottom-2 right-2 rounded-md bg-zinc-800/80 p-1.5 text-zinc-400 opacity-0 transition group-hover/code:opacity-100 hover:bg-zinc-700 hover:text-zinc-200"
        title="Copy code"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
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
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
