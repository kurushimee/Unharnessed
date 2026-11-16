import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { LogOutputChannel } from "vscode";
import type { Link } from "../../../vscode/src/files";
import { mentions } from "../../../vscode/src/mentions";

/** The files the `@` menu gets at most. */
const LIMIT = 20_000;
/** Folders a walk outside git never enters. */
const SKIPPED = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "target", "dist", "build", ".next"]);

/**
 * A project folder as the `@` menu lists it, and the mentions of a message
 * linked to its prompt: the extension's Files (vscode/src/files.ts) without
 * VS Code. In a git repository, its files less the ignored ones; elsewhere,
 * a walk that skips the usual build and dependency folders.
 */
export class Files {
  constructor(
    readonly cwd: string,
    private readonly log: LogOutputChannel,
    /** No project: the home folder, never listed. */
    private readonly listed = true,
  ) {}

  async list(): Promise<{ files: string[]; open: string[] }> {
    if (!this.listed) return { files: [], open: [] };
    const git = await this.gitFiles();
    const files = git ?? (await this.walk());
    this.log.info(`files: ${files.length} listed by ${git ? "git" : "walk"} in ${this.cwd}`);
    return { files, open: [] };
  }

  /** The mentions of `text` that name something, as links: each path once. */
  links(text: string): Link[] {
    const exists = (path: string) => resolve(this.cwd, path) !== this.cwd && existsSync(resolve(this.cwd, path));
    const uris = new Map<string, Link>();
    for (const { path } of mentions(text, exists)) {
      const uri = pathToFileURL(resolve(this.cwd, path)).href;
      if (!uris.has(uri)) uris.set(uri, { type: "resource_link", uri, name: path });
    }
    return [...uris.values()];
  }

  private gitFiles(): Promise<string[] | undefined> {
    const args = ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
    return new Promise((done) => {
      execFile("git", args, { cwd: this.cwd, maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        done(error ? undefined : [...new Set(stdout.split("\0").filter(Boolean))].slice(0, LIMIT));
      });
    });
  }

  private async walk(): Promise<string[]> {
    const found: string[] = [];
    const queue = [this.cwd];
    while (queue.length > 0 && found.length < LIMIT) {
      const dir = queue.shift()!;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED.has(entry.name)) queue.push(path);
        } else if (entry.isFile()) {
          found.push(relative(this.cwd, path).split(sep).join("/"));
          if (found.length >= LIMIT) break;
        }
      }
    }
    return found.sort();
  }
}
