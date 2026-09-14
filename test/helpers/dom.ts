/**
 * Single entry point for loading `react-dom/client` in tests.
 *
 * React DOM feature-detects input-event support **at import time**. If the
 * module is first imported while no DOM exists — which is what a static
 * top-level `import { createRoot } from "react-dom/client"` in a test file
 * does — it takes the legacy path and `input`/`change` events never reach
 * `onChange`. Every happy-dom typing test (composer `@` picker, `/` menu,
 * folder picker) then fails with an empty menu.
 *
 * Bun runs test files **concurrently in one process**, so whichever file
 * imports React DOM first wins that race. The suite passed on macOS and 15
 * tests failed on CI purely because a different file won it there
 * (bun test v1.4.2, run 34841998953).
 *
 * Always load React DOM through this helper, after installing a window.
 */
export async function loadReactDom(): Promise<typeof import("react-dom/client")> {
  if (typeof document === "undefined") {
    throw new Error(
      "loadReactDom() must be called after installing a happy-dom window: " +
        "react-dom/client picks its event polyfills at import time, and " +
        "importing it without a DOM breaks input events for the whole process.",
    );
  }
  return import("react-dom/client");
}
