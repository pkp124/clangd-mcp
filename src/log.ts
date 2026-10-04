/** MCP stdio uses stdout. All human/diagnostic logs go to stderr. */
export function log(...args: unknown[]): void {
  console.error(...args);
}
