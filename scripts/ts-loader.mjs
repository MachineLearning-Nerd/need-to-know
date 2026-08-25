// Node 24 loader hook: resolves .js imports to .ts files so TypeScript ESM
// sources can run without a build step. Used only by the verify-receipt CLI.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolve(specifier, context, nextResolve) {
  // Only remap relative .js imports.
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    const tsSpecifier = `${specifier.slice(0, -3)}.ts`;
    if (context.parentURL) {
      const resolved = new URL(tsSpecifier, context.parentURL);
      if (existsSync(fileURLToPath(resolved))) {
        return nextResolve(resolved.href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
