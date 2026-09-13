/**
 * Syntax highlighting for file previews and markdown code blocks.
 *
 * Only a curated set of languages is registered: this keeps the client
 * bundle small and makes `languageForFile()` in `lib/file-browser.ts` the
 * single source of truth for extension → language mapping. A unit test
 * asserts every mapped id actually exists in the registry.
 */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import clojure from "highlight.js/lib/languages/clojure";
import cmake from "highlight.js/lib/languages/cmake";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import erb from "highlight.js/lib/languages/erb";
import erlang from "highlight.js/lib/languages/erlang";
import go from "highlight.js/lib/languages/go";
import gradle from "highlight.js/lib/languages/gradle";
import graphql from "highlight.js/lib/languages/graphql";
import groovy from "highlight.js/lib/languages/groovy";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import latex from "highlight.js/lib/languages/latex";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import nix from "highlight.js/lib/languages/nix";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import pgsql from "highlight.js/lib/languages/pgsql";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import vhdl from "highlight.js/lib/languages/vhdl";
import vim from "highlight.js/lib/languages/vim";
import verilog from "highlight.js/lib/languages/verilog";
import wasm from "highlight.js/lib/languages/wasm";
import x86asm from "highlight.js/lib/languages/x86asm";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

type LanguageFn = Parameters<typeof hljs.registerLanguage>[1];

const LANGUAGES: Record<string, LanguageFn> = {
  bash,
  c,
  clojure,
  cmake,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  elixir,
  erb,
  erlang,
  go,
  gradle,
  graphql,
  groovy,
  haskell,
  ini,
  java,
  javascript,
  json,
  kotlin,
  latex,
  less,
  lua,
  makefile,
  markdown,
  nginx,
  nix,
  objectivec,
  perl,
  pgsql,
  php,
  plaintext,
  powershell,
  properties,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  sql,
  swift,
  typescript,
  vhdl,
  vim,
  verilog,
  wasm,
  x86asm,
  xml,
  yaml,
};

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  for (const [id, fn] of Object.entries(LANGUAGES)) hljs.registerLanguage(id, fn);
  registered = true;
}

/** True when `id` is one of the languages this module registered. */
export function highlightLanguageIsRegistered(id: string): boolean {
  ensureRegistered();
  return Boolean(hljs.getLanguage(id));
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Highlight `code` into HTML (`hljs-*` class spans). Unknown languages and
 * parser failures fall back to escaped plain text — never raw HTML.
 */
export function highlightToHtml(code: string, language?: string | null): string {
  ensureRegistered();
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      /* fall through to plain text */
    }
  }
  return escapeHtml(code);
}
