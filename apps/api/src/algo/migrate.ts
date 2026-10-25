/** Cria/atualiza só o esquema `algo` (não toca nas migrações do cardápio/CRM). Uso: npx tsx apps/api/src/algo/migrate.ts */
import { migrateAlgo } from "./db-postgres";
const url = process.env.ALGO_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error("Defina ALGO_DATABASE_URL ou DATABASE_URL"); process.exit(1); }
await migrateAlgo(url);
console.log("esquema algo ok");
