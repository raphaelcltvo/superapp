# Superapp · cardápio próprio whitelabel

Cardápio digital de uma marca (não marketplace) com backoffice completo, CRM e integração com o PDV SAIPOS.
Mantra: **1 visita = 1 venda**. Pilares: experimental, analítico, convertivo e preditivo.

## O que tem

| Parte | Pasta | O que faz |
|---|---|---|
| Núcleo de regras | `packages/core` | Preço meio a meio (base = combinação mais barata, cada metade cobra a diferença proporcional), combos e ofertas com preço fechado, cupons e ponto de equilíbrio, cashback com níveis e vencimento FIFO, **estratégias** (frete por área/valor/item/dia/horário/cliente novo/recorrente 7–10 dias, taxa de serviço no lugar do pedido mínimo, pop-up de cupom por tempo sem adicionar), zonas em polígono, funil, RFM, segmentos, personalização por perfil e escolha de banner com teste A/B. Testado. |
| API | `apps/api` | Hono + Postgres (ou memória). Cadastro de tudo, rascunho → auditoria → publicação por versão (com volta), cardápio público personalizado, cotação autoritativa, checkout, OTP por WhatsApp, páginas/LP com NPS, CRM (visão geral comparando novos com novos e recorrentes com recorrentes, funil por origem/dispositivo/hora, atritos, cliente 360, automações com grupo de controle e incremento), importação CSV/XLSX com de-para de colunas, API pública com chave e webhooks de saída assinados. |
| Conector SAIPOS | `apps/api/src/integrations/saipos` | API de Pedidos v2.5: `/auth` (token de 2 dias, renovação automática e nova tentativa no erro 901), `POST /order` com complementos (o total que a SAIPOS recalcula bate com o nosso), `/update-order-status`, `/cancel-order`, webhook de eventos (CONFIRMED → READY_TO_DELIVER → DISPATCHED → CONCLUDED/CANCELLED), `GET /v2/catalog` para puxar os códigos PDV e sugerir o de-para, checklist dos critérios de homologação e uma SAIPOS de teste para desenvolver sem credencial. Documentação oficial copiada em `docs/saipos-api-referencia`. |
| Painel | `apps/admin` | Início (o que falta para ir ao ar), itens e categorias, complementos, vitrine (banners imagem/GIF/vídeo em cima e abaixo do card sugerido, card por perfil, ordem por perfil, mais pedidos, sugestões na sacola, busca na lupa), páginas e pesquisas, estratégias com simulador, cupons, cashback, pedidos, CRM, lojas com **áreas desenhadas no mapa**, integrações (SAIPOS, importação, API, equipe), publicar e marca. |
| Cardápio do cliente | `apps/storefront` | Lê a versão publicada; lupa no topo; banners em movimento; card sugerido por perfil; meio a meio com foto montada; barra de frete grátis; taxa de serviço só no resumo antes de pagar; pop-up de cupom no canto superior; checkout com OTP, área de entrega e cashback; acompanhamento ao vivo. |
| Demonstração | `apps/demo` | Tudo isso rodando no navegador (API + banco em memória + SAIPOS de teste), num único HTML. |

## Rodar localmente

```bash
npm install
cp .env.example .env            # ajuste DATABASE_URL
npm run db:migrate              # cria as tabelas
npm run db:seed                 # marca de exemplo Forneria Original com 90 dias de histórico
npm run dev:api                 # http://localhost:8787
npm run dev:admin               # painel
npm run dev:store               # cardápio (?marca=forneria-original&utm_source=instagram)
npm test                        # núcleo + API (memória); com TEST_DATABASE_URL roda também em Postgres
```

Sem `DATABASE_URL` a API sobe com banco em memória (bom para testar).

## Colocar no ar

1. **Banco**: Supabase (Postgres 15+). Rode `npm run db:migrate` apontando para ele.
2. **API**: qualquer host Node 20+ (Render, Railway, Fly, VPS) com `npm start -w @cw/api`. A mesma app Hono roda em Cloudflare Workers/Deno trocando só o adaptador de servidor.
3. **Painel e cardápio**: `npm run build -w @cw/admin` e `-w @cw/storefront`, publique os `dist` (Vercel/Netlify/Cloudflare Pages) com `VITE_API_URL`.
4. **Domínio**: cada marca usa `cardapio.marca.com.br` apontando para o storefront com `?marca=slug` (ou um rewrite).

### Antes de abrir ao público (trocar as peças de teste)

- **Pagamento Pix**: hoje o Pix é marcado como pago na entrega para a SAIPOS (`PARTNER_PAYMENT/pix`). Ligar um PSP (Pagar.me, Mercado Pago, Asaas…) para gerar o QR real e confirmar por webhook antes de enviar ao PDV.
- **WhatsApp**: `Messenger` e `sendOtp` em `apps/api/src/deps.ts` só registram. Plugar WhatsApp Cloud API (ou Z-API/Twilio) para OTP e automações.
- **Geocodificação**: `deps.geocode` (Google/Mapbox/Nominatim). Sem ele, o bairro é casado com o nome da área desenhada.
- **Arquivos**: `Storage` grava em disco; trocar por Supabase Storage/S3.
- **OTP**: códigos ficam em memória do processo; com mais de uma instância, mover para Redis ou para o banco.
- **Rate limit** nas rotas públicas (`/auth/otp`, `/orders`).

## SAIPOS: do zero à produção

1. Credenciamento no Saipos Developer → secret e loja de teste.
2. No painel: Integrações › SAIPOS → ambiente Homologação, ID Partner, secret, código da loja; **Testar conexão**.
3. **Importar códigos PDV** e aplicar o de-para (itens e complementos precisam de código; a publicação bloqueia se faltar com a integração ligada).
4. Cole a URL do webhook (mostrada no painel) no Saipos Developer › Configuração.
5. Faça pedidos de teste até o checklist de homologação ficar completo e peça a homologação (até 5 dias úteis).
6. Na conta Saipos da loja: Canais de Venda › sua integração › Configurar → código da loja, formas de pagamento, salvar (gera o ID Partner de produção).

Pendente para 100% dos critérios: pedido com **mais de uma forma de pagamento** (o checkout aceita uma) e campo de bandeira do cartão no complemento.

## Decisões de produto já embutidas

- Pedido mínimo **nunca bloqueia**: abaixo dele entra a taxa (padrão R$ 15, enviada à SAIPOS como `MIN_ORDER_FEE`); acima, a taxa não existe e nada aparece na tela. A taxa aparece só no resumo antes de pagar (exigência do CDC).
- Meio a meio só em itens montáveis; combos, ofertas e Imbatíveis mantêm preço fechado.
- Cashback credita na entrega (evita fraude) e é estornado no cancelamento.
- Automações sempre deixam um grupo de controle para medir incremento real.
- Indicadores comparam o mesmo perfil entre períodos (novos com novos, recorrentes com recorrentes).
