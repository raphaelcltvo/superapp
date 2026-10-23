// Converte o index.html do Vite no formato de página do Artifact (sem doctype/html/head/body) e copia as mídias.
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from "node:fs";
const html = readFileSync("dist/index.html", "utf8");
// o JS embutido pode conter "<head>"/"<body>" (modelos de e-mail): usa a primeira abertura e o ÚLTIMO fechamento
const hs = html.indexOf("<head>") + 6, he = html.lastIndexOf("</head>");
const bt = html.lastIndexOf("<body"), bs = html.indexOf(">", bt) + 1, be = html.lastIndexOf("</body>");
const head = html.slice(hs, he).replace(/<meta charset[^>]*>/, "").replace(/<meta name="viewport"[^>]*>/, "");
const body = html.slice(bs, be);
const titleIdx = head.indexOf("<title>");
const out = head.slice(titleIdx).trim() + "\n" + body.trim() + "\n";
writeFileSync("dist/superapp.html", out);
mkdirSync("dist/media", { recursive: true });
cpSync("../api/src/seed/photos", "dist/media", { recursive: true });
console.log("ok", (out.length / 1024).toFixed(0) + " KB", readdirSync("dist/media").length + " mídias");
