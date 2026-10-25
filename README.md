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
| Pagamento online | `apps/api/src/integrations/payments` | Mercado Pago (Pix e cartão), Pagar.me v5 (Pix e cartão), Asaas (Pix) e gateway de teste, um por marca. Pedido online espera o pagamento e só então vai à SAIPOS (`PARTNER_PAYMENT`); Pix vencido gera outro; 60 min sem pagar cancela e devolve o cupom; cancelar pedido pago estorna. Cartão vira token no navegador do cliente: o número nunca passa pela nossa API. Webhooks conferidos (assinatura do MP, token na URL + nova consulta no Pagar.me e Asaas). Painel › Vendas › Pagamentos. |
| WhatsApp e e-mail | `apps/api/src/integrations/messaging` | WhatsApp Cloud API (v26.0, modelos aprovados, OTP com botão de copiar código, caixa de entrada, descadastro) e e-mail por Resend ou Brevo com editor de blocos. Campanhas por segmento com agendamento, horário de silêncio, limite por semana e grupo de controle; relatório enviado → entregue → lido/aberto → clicado → pedido. Automações escolhem canal (ou WhatsApp e, sem opt-in, e-mail). `POST /cron/tick` dispara o que está agendado. Painel › CRM › WhatsApp e e-mail. |
| Pesquisa e engajamento | `packages/core/src/engagement.ts`, `apps/api/src/services/engagement.ts`, `apps/storefront/src/engage.tsx` | **Triagem de 1 toque** para quem já comprou (pra quantas pessoas, salgada ou doce, o de sempre ou novidade, o que não come): a resposta muda o card do topo, a ordem das categorias e manda para o fim o que a pessoa evita. **Pós-pedido** na tela do pedido: NPS, motivo e “quero provar”; detrator recebe crédito automático e a loja é avisada no WhatsApp; promotor é convidado a avaliar no Google; o “quero provar” vira o card do topo na próxima visita. **Efeitos com dose** (1 a cada 8 s, 1 cupom por visita, respeita “reduzir movimento”): brilho no botão quando a montagem fica pronta, brilho na sugestão de 1 toque se a pessoa travar, empurrão do frete grátis, “antes de ir” (mouse saindo, botão voltar, volta ao app) com cupom, vibração por status. Painel › CRM › Pesquisa e engajamento, com NPS, motivos, detratores recuperados e conversão das sessões por efeito. |
| Cardápio da Forneria Barra | `apps/api/src/seed/ifood-barra` | Cópia do cardápio público do iFood da Forneria Original Pizza - Barra (24/10/2026): 11 categorias, 75 itens, 45 grupos de complementos. `node apps/api/src/seed/ifood-barra/gerar.mjs` refaz o `cardapio.json`. Meio a meio vira regra de média (inteira = 2 × metade do iFood); combos, ofertas e hits mantêm preço fechado. |
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

- **Pagamento**: cadastre as chaves do gateway em Painel › Pagamentos (comece em sandbox) e cadastre a URL do webhook mostrada lá. Conferir no sandbox: e-mail do pagador quando o cliente não informa (MP), `issuer_id` (MP), CPF no Pix (Pagar.me), domínio liberado para `/tokens` (Pagar.me). Próximo passo no cartão do MP: trocar `createCardToken` por Secure Fields.
- **WhatsApp e e-mail**: em Painel › WhatsApp e e-mail, ligue o número da Meta (token, App Secret, verify token) e o Resend/Brevo; aprove os modelos na Meta. Conferir: formato do webhook de e-mail do Resend/Brevo e o envio de teste (`hello_world` pode não existir no número de produção). Agende `POST /cron/tick` (a cada 5 min) com o header `x-cron-secret`.
- **Vibração**: só funciona no Android; no iPhone o navegador não deixa e o brilho faz o papel.
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

## Primeira visita, topo por jornada e senha do pagamento online

- **Topo do cardápio por jornada**: quem chega por anúncio (utm_source/utm_campaign/utm_content) vê o produto ou a categoria do criativo (Painel › Pesquisa e engajamento › Primeira visita › Topo por campanha); o recorrente vê o que ele **mais** pede, com a combinação de sabores, em 1 toque; o visitante novo vê a triagem.
- **Triagem de primeira visita**: com base enviada (30+ clientes), o núcleo agrupa os clientes em personas (tamanho do pedido, oferta x montar, doce, ticket) e escolhe as 2–3 perguntas que mais separam esses grupos; a resposta leva ao grupo mais parecido e o topo mostra o que ele pede, já montado. Sem base, vale o roteiro do segmento (editável no painel).
- **Cupom em troca da pesquisa**: modo recompensa (responde e ganha) ou portão (o cupom aparece primeiro e só libera com respostas + celular + e-mail). O contato vira lead no CRM; o WhatsApp de marketing só liga depois que o telefone é confirmado por código no pedido (o lead é unido ao cliente nessa hora). Sem senha.
- **Senha só no pagamento online**: na primeira compra online o cliente informa CPF e data de nascimento e cria uma senha; depois, só a senha (5 erros bloqueiam 15 min; "esqueci" usa o código do WhatsApp). Pagamento na entrega continua sem senha. Desligável em Pagamentos. Conferir se o CPF pertence àquela data de nascimento exige um serviço pago (Serpro ou bureau de crédito): plugue em `deps.verifyIdentity(cpf, nascimento)`; sem ele, só o formato do CPF é validado.

## Setup e culinárias (de bolo a costela)

- **Criar marca → Setup em 9 passos** (Painel › Setup da marca): marca (nome, endereço do cardápio, logo, cor principal com tons derivados, WhatsApp de atendimento), culinária, loja e entrega (endereço, dias e horário, raio com taxa e tempo), cardápio (copiar do iFood, começar pelo modelo da culinária ou do zero), pagamento (maquininha na entrega por padrão; online é opcional), pedidos (gestor do SuperApp ou PDV), WhatsApp, base de clientes (opcional) e publicar. Cada passo fica pronto pelos dados, não por clique: dá para voltar e o Início mostra o que falta.
- **Uma estrutura para todas as culinárias** (`packages/core/src/cuisines.ts`): categoria → item → grupos de complemento → opções. As particularidades são campos genéricos, não código por segmento: meio a meio (`rule: "fraction"`), cota grátis (`freeQuota`: as N escolhas mais caras saem de graça, as demais cobram; a comanda e o PDV recebem a linha "grátis" separada), medida (`measure`: 500 g, 350 ml, 12 un, com preço por kg/L/un no cardápio), encomenda (`leadTimeHours`: a sacola pede data e horário e o checkout recusa antes da antecedência), janela de venda (`availability` no item ou na categoria: prato do dia, café da manhã até 11h; fora dela o item aparece como "volta sábado"), papel do grupo (`role`: tamanho, base, sabor, proteína, adicional, acompanhamento, molho, instrução) e selos (vegano, sem glúten, sem lactose, zero açúcar, low carb, fit, picante) que viram filtro no cardápio.
- **16 modelos prontos**: pizzaria, hamburgueria, japonesa, açaí, confeitaria, churrasco e costela, marmitas, árabe, salgados, poke, padaria, saudável, italiana, mexicana, bar e genérico. Cada modelo traz categorias, grupos, itens de exemplo com preço, cuidados do segmento e o roteiro da triagem. `detectCuisine()` reconhece a culinária pelos nomes do cardápio (usado na importação).

## Decisões de produto já embutidas

- Pedido mínimo **nunca bloqueia**: abaixo dele entra a taxa (padrão R$ 15, enviada à SAIPOS como `MIN_ORDER_FEE`); acima, a taxa não existe e nada aparece na tela. A taxa aparece só no resumo antes de pagar (exigência do CDC).
- Meio a meio só em itens montáveis; combos, ofertas e Imbatíveis mantêm preço fechado.
- Cashback credita na entrega (evita fraude) e é estornado no cancelamento.
- Automações sempre deixam um grupo de controle para medir incremento real.
- Indicadores comparam o mesmo perfil entre períodos (novos com novos, recorrentes com recorrentes).
