/**
 * Session file service — mentions, browse, text preview, raw bytes.
 *
 * Thin domain wrapper over `lib/files.ts` + `lib/file-browser.ts`. The path
 * jail (`resolveWithinRoot`) stays there; this module only adds the session
 * row lookup and control-plane errors.
 */

import { eq } from "drizzle-orm";
import { sessions as sessionsTable } from "@/lib/db/schema";
import {
  fileKind,
  imageMimeFor,
  isTextKind,
  languageForFile,
  rawContentType,
  type BrowseEntry,
  type FilePreviewData,
} from "@/lib/file-browser";
import type { MentionEntry } from "@/lib/file-mentions";
import { readGitStatus } from "@/lib/git";
import type { GitStatusSnapshot } from "@/lib/git-status";
import {
  listBrowseEntries,
  listMentionEntries,
  readTextPreview,
  resolveWithinRoot,
} from "@/lib/files";
import { baseName } from "@/lib/utils";
import { exportFileName, exportTempPath } from "@/lib/export-html";
import { ControlError } from "./errors";
import type { ControlDeps } from "./plane";
import type { RawFile } from "./types";

export interface FileService {
  listMentions(
    sessionId: string,
    dir: string,
  ): Promise<{ cwd: string; dir: string; entries: MentionEntry[] }>;
  browse(
    sessionId: string,
    dir: string,
  ): Promise<{ cwd: string; dir: string; entries: BrowseEntry[]; truncated: boolean }>;
  preview(sessionId: string, relPath: string): Promise<FilePreviewData>;
  raw(
    sessionId: string,
    relPath: string,
    opts?: { download?: boolean },
  ): Promise<RawFile>;
  /**
   * Working-tree change summary for the session folder (staged + unstaged +
   * untracked vs HEAD). Pure read: spawns git, never pi.
   */
  gitStatus(sessionId: string): Promise<GitStatusSnapshot>;
  /**
   * Stream-ready descriptor for the session's staged HTML export (written by
   * `control("export_html")` into the OS temp dir). Never spawns.
   */
  exportFile(sessionId: string): Promise<RawFile>;
}

/** Header-safe file name for Content-Disposition. */
function dispositionName(name: string): string {
  return name.replace(/["\\\r\n]/g, "_") || "file";
}

export function createFileService(deps: ControlDeps): FileService {
  async function sessionCwd(sessionId: string): Promise<string> {
    const row = (await deps.db())
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .get();
    if (!row) {
      throw new ControlError("not_found", "Session not found", { status: 404 });
    }
    return row.cwd;
  }

  function jailed(cwd: string, dir: string): string {
    const abs = resolveWithinRoot(cwd, dir);
    if (!abs) {
      throw new ControlError(
        "bad_request",
        "Path is outside the session working directory",
        { status: 400 },
      );
    }
    return abs;
  }

  return {
    async listMentions(sessionId, dir) {
      const cwd = await sessionCwd(sessionId);
      jailed(cwd, dir);
      const entries = await listMentionEntries(cwd, dir);
      return { cwd, dir, entries };
    },

    async browse(sessionId, dir) {
      const cwd = await sessionCwd(sessionId);
      jailed(cwd, dir);
      const { entries, truncated } = await listBrowseEntries(cwd, dir);
      return { cwd, dir, entries, truncated };
    },

    async preview(sessionId, relPath) {
      const cwd = await sessionCwd(sessionId);
      if (!relPath.trim()) {
        throw new ControlError("bad_request", "Missing path", { status: 400 });
      }
      const abs = jailed(cwd, relPath);
      const name = baseName(relPath);
      try {
        const preview = await readTextPreview(abs);
        return {
          path: relPath,
          name,
          kind: fileKind(name, "file"),
          language: languageForFile(name),
          mime: imageMimeFor(name),
          status: preview.status,
          content: preview.content,
          size: preview.size,
          mtimeMs: preview.mtimeMs,
        };
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ENOENT") {
          throw new ControlError("not_found", "File not found", { status: 404 });
        }
        if (code === "EISDIR") {
          throw new ControlError("bad_request", "Path is a directory, not a file", {
            status: 400,
          });
        }
        throw err;
      }
    },

    async raw(sessionId, relPath, opts = {}) {
      const cwd = await sessionCwd(sessionId);
      if (!relPath.trim()) {
        throw new ControlError("bad_request", "Missing path", { status: 400 });
      }
      const abs = jailed(cwd, relPath);
      const file = Bun.file(abs);
      let stat: Awaited<ReturnType<typeof file.stat>>;
      try {
        stat = await file.stat();
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") {
          throw new ControlError("not_found", "File not found", { status: 404 });
        }
        throw err;
      }
      if (!stat.isFile()) {
        throw new ControlError("bad_request", "Path is a directory, not a file", {
          status: 400,
        });
      }
      const name = baseName(relPath);
      const kind = fileKind(name, "file");
      const download =
        opts.download === true || (!isTextKind(kind) && kind !== "image");
      return {
        absPath: abs,
        name: dispositionName(name),
        size: stat.size,
        contentType: rawContentType(name, kind),
        download,
      };
    },

    async gitStatus(sessionId) {
      const cwd = await sessionCwd(sessionId);
      return readGitStatus(cwd);
    },

    async exportFile(sessionId) {
      await sessionCwd(sessionId); // 404 when the session row is missing
      const abs = exportTempPath(sessionId);
      const file = Bun.file(abs);
      let stat: Awaited<ReturnType<typeof file.stat>>;
      try {
        stat = await file.stat();
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") {
          throw new ControlError(
            "not_found",
            "No export yet — export the session first",
            { status: 404 },
          );
        }
        throw err;
      }
      if (!stat.isFile()) {
        throw new ControlError("bad_request", "Export path is not a file", {
          status: 400,
        });
      }
      // The export is HTML the user opens from Downloads. Always attachment
      // (never inline) so it cannot run as same-origin code in a tab.
      return {
        absPath: abs,
        name: exportFileName(sessionId),
        size: stat.size,
        contentType: "text/html; charset=utf-8",
        download: true,
      };
    },
  };
}
