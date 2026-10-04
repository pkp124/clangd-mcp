import { resolve } from "node:path";
import { writeFixtureCompileCommands } from "../test/helpers/compile-commands.js";

const fixture = resolve(process.argv[2] ?? "test/fixture");
const path = writeFixtureCompileCommands(fixture, process.env.CXX ?? "clang++");
process.stdout.write(`${path}\n`);
