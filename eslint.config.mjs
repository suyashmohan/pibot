import next from "eslint-config-next";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...next,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "data/**",
      "drizzle/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
  {
    rules: {
      // Next 16's preset turns on React Compiler-oriented rules that flag
      // patterns this app relies on. They are downgraded to warnings (visible,
      // but not CI-failing) rather than disabled outright:
      //  - set-state-in-effect: client components fetch their data on mount
      //  - preserve-manual-memoization: compiler bail-out notices (Composer)
      //  - refs: false positive on `ref={scroll.ref}` — that passes a ref to
      //    the ref prop, it does not dereference it during render
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
    },
  },
];
