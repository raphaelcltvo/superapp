# Algoritmo do Superapp (camada 0 + agentes A–G + ciclo vivo)

Módulo **separado** do cardápio/CRM: banco, rotas e agendador próprios. A única ligação com o resto da API é a linha `mountAlgo(app)` em `app.ts`.

| Peça | Onde | Separação |
|---|---|---|
| Banco | esquema Postgres `algo` (mesmo banco por padrão; outro com `ALGO_DATABASE_URL`) | conexão própria; nenhuma tabela em `public` é criada ou alterada; migrações em `algo.schema_migrations` |
| Leitura do cardápio/CRM | `deps.db` (itens, sabores, pedidos, clientes, eventos) | só leitura — exceto cadastrar clientes de **canais próprios** importados no SETUP |
| Custo (CMV) | `algo.item_costs` | o cadastro do item não muda |
| Rotas | `/admin/algo/*`, `/public/:slug/experiments/:id/assign` | autenticação própria (mesmo login do painel) |
| Agendador | `POST /cron/algo` (header `x-cron-secret`) | independente do `/cron/tick`; roda 1x por dia por marca |

## Pôr no ar

1. `npx tsx apps/api/src/algo/migrate.ts` (ou deixe criar sozinho no primeiro uso).
2. Agende `POST /cron/algo` a cada hora (só processa uma vez por dia).
3. Para isolar ainda mais, aponte `ALGO_DATABASE_URL` para outro banco: o algoritmo continua lendo o cardápio/CRM pelo banco principal.

## Arquivos

- `packages/core/src/algo.ts` — regras puras: agentes, alavancas, mapa de evasão, escada de dados, casamento de itens, Thompson sampling. Não é exportado pelo `@cw/core` (importe pelo caminho) para não colidir com nomes do núcleo.
- `schema.ts` · `db.ts` (contrato + memória) · `db-postgres.ts` (só servidor) · `service.ts` · `routes.ts` · `migrate.ts`
- Testes: `apps/api/test/algo.test.ts` (memória e Postgres com `TEST_DATABASE_URL`).
