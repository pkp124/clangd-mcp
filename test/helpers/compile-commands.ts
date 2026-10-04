import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILES = ["src/widget.cpp", "src/main.cpp"] as const;

export function writeFixtureCompileCommands(fixture: string, cxx = "clang++"): string {
  const entries = SOURCE_FILES.map((relative) => {
    const file = join(fixture, relative);
    const output = file.replace(/\.cpp$/, ".o");
    return {
      directory: fixture,
      command: `${cxx} -std=c++17 -I${join(fixture, "include")} -c ${file} -o ${output}`,
      file,
    };
  });
  const path = join(fixture, "compile_commands.json");
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
  return path;
}
