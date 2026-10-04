import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function toFileUri(filePath: string): string {
  return pathToFileURL(resolve(filePath)).href;
}

export function fromFileUri(uri: string): string {
  if (!uri.startsWith("file:")) {
    return uri;
  }
  return fileURLToPath(uri);
}

export function resolveExisting(path: string): string {
  return realpathSync(resolve(path));
}

export function isPathInside(workspaceRoot: string, candidate: string): boolean {
  const root = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;
  return candidate === workspaceRoot || candidate.startsWith(root);
}

export function requireWorkspaceFile(workspaceRoot: string, filePath: string): string {
  const resolved = resolveExisting(filePath);
  if (!isPathInside(workspaceRoot, resolved)) {
    throw new Error(`path ${filePath} is outside the workspace ${workspaceRoot}`);
  }
  return resolved;
}
