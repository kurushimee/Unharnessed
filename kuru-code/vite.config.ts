import tailwindcss from "@tailwindcss/vite";
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

export default defineConfig({
  root,
  base: "./",
  plugins: [extensionPanel(), react(), tailwindcss()],
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
