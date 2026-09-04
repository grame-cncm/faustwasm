import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ignores: ["**/dist", "**/test", "**/libfaust-wasm.js"],
  },
  {
    languageOptions: {
      // The CLI helpers in src/*.js are Node scripts and log their progress.
      // Only `console` is reached for; declaring it here rather than pulling
      // in the whole `globals` package keeps the dependency list as it is.
      globals: { console: "readonly" },
    },
    rules: {
      // Most flagged parameters are fixed by a signature this code does not
      // own -- interface implementations, Emscripten callbacks, Web Audio
      // handlers -- where dropping or renaming the argument would be worse
      // than leaving it unread. Unused *variables* are still reported, which
      // is the half that finds dead code.
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
    },
  },
);
