// Gera raw.json no formato que a página pública do iFood devolve (catálogo + detalhes de cada item): é o mesmo
// pacote que o "Copiar do iFood" (bookmarklet) envia ao SuperApp. Uso: node apps/api/src/seed/ifood-barra/gerar-raw.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { buildRaw } from "./barra-raw.mjs";
const dir = new URL(".", import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), "utf8");
const raw = buildRaw({ itens: read("itens.txt"), grupos: read("grupos.txt"), opcoes: read("opcoes.txt") });
writeFileSync(new URL("raw.json", dir), JSON.stringify(raw));
const menu = raw.catalog.data.menu;
console.log(`categorias ${menu.length} · itens ${menu.reduce((a, c) => a + c.itens.length, 0)} · itens com complementos ${Object.keys(raw.details).length}`);
