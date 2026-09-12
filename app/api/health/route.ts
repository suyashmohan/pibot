import { $ } from "bun";
import { defaultCwd, piBinary } from "@/lib/pi/env";
import { ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function piVersion(): Promise<string | null> {
  try {
    const out = await $`${piBinary()} --version`.text();
    return out.trim().slice(0, 100) || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const version = await piVersion();
  return ok({
    app: "PiBot",
    piBinary: piBinary(),
    piVersion: version,
    piAvailable: version != null,
    defaultCwd: defaultCwd(),
    runtime: `bun ${Bun.version}`,
  });
}
