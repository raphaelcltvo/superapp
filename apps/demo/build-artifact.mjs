// Converte o index.html do Vite no formato de página do Artifact (sem doctype/html/head/body) e copia as mídias.
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from "node:fs";
const html = readFileSync("dist/index.html", "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>/, "").replace(/<meta name="viewport"[^>]*>/, "");
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const titleIdx = head.indexOf("<title>");
const out = head.slice(titleIdx).trim() + "\n" + body.trim() + "\n";
writeFileSync("dist/superapp.html", out);
mkdirSync("dist/media", { recursive: true });
cpSync("../api/src/seed/photos", "dist/media", { recursive: true });
console.log("ok", (out.length / 1024).toFixed(0) + " KB", readdirSync("dist/media").length + " mídias");
