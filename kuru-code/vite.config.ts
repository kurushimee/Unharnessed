import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

// The true-cased path: a drive letter spelled two ways would load a module twice.
const root = realpathSync.native(fileURLToPath(new URL(".", import.meta.url)));
const webview = resolve(root, "../vscode/webview");

/**
 * The chat, the composer, the settings tabs and the providers are the VS Code
 * extension's panel (vscode/webview), unchanged: its `./vscode` (the webview
 * API) becomes the app's bridge, and its SVG logos come in as markup, as the
 * extension's esbuild `text` loader gives them.
 */
function extensionPanel(): Plugin {
  return {
    name: "kuru:extension-panel",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./vscode" && importer && resolve(dirname(importer)) === webview) {
        return resolve(root, "src/renderer/panelHost.ts");
      }
      return null;
    },
    load(id) {
      const path = id.split("?")[0];
      if (path.endsWith(".svg") && !id.includes("?") && /[\\/]vscode[\\/](node_modules|media)[\\/]/.test(path)) {
        return `export default ${JSON.stringify(readFileSync(path, "utf8"))};`;
      }
      return null;
    },
  };
}

/** The modules the window's bundle holds, for the license manifest (scripts/licenses.mjs). */
function bundledModules(): Plugin {
  return {
    name: "kuru:bundled-modules",
    apply: "build",
    generateBundle(_options, bundle) {
      const modules = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") for (const id of output.moduleIds) modules.add(id.split("?")[0]!);
      }
      this.emitFile({ type: "asset", fileName: "bundled-modules.json", source: JSON.stringify([...modules]) });
    },
  };
}

export default defineConfig({
  root,
  base: "./",
  plugins: [
    extensionPanel(),
    // T3 Code's file routes (src/renderer/routes), and its React Compiler.
    tanstackRouter({
      routesDirectory: resolve(root, "src/renderer/routes"),
      generatedRouteTree: resolve(root, "src/renderer/routeTree.gen.ts"),
      autoCodeSplitting: true,
    }),
    react({ compiler: true }),
    tailwindcss(),
    bundledModules(),
  ],
  resolve: {
    alias: {
      "~": resolve(root, "src/renderer"),
      "@shared": resolve(root, "src/shared"),
      "@panel": webview,
    },
    dedupe: ["react", "react-dom"],
  },
  server: { port: 5791, strictPort: true, fs: { allow: [resolve(root, "..")] } },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
  },
});
