import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./postgres";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const url = process.env.DATABASE_URL;
if (!url) { console.error("Defina DATABASE_URL"); process.exit(1); }
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
await migrate(url, files);
console.log("ok");
