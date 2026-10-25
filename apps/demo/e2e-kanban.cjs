// Gestor de pedidos ao vivo: sem PDV, o pedido do cardápio cai em Novos, toca, é aceito e anda até Entregue.
const { chromium } = require("playwright");
const OUT = process.env.OUT || ".";
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,localhost,127.0.0.1" }, args: ["--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required"] });
  const pg = await b.newPage({ viewport: { width: 1500, height: 920 }, ignoreHTTPSErrors: true });
  const errs = []; pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  const ok = (c, m) => console.log((c ? "ok: " : "FALHOU: ") + m);
  await pg.goto("http://localhost:" + (process.env.PORT || 8811) + "/index.html");
  await pg.waitForSelector(".cw-sf .store-name", { timeout: 60000 });
  const fvSkip = async () => { try { await pg.locator(".demo-screen .fv-sheet").waitFor({ timeout: 4000 }); await pg.locator('.demo-screen .fv-sheet button:has-text("Pular"), .demo-screen .fv-sheet button:has-text("Agora não")').first().click(); await pg.waitForTimeout(600); } catch { /* sem triagem */ } };
  await fvSkip();
  const sf = pg.locator(".demo-screen"); const ad = pg.locator(".cw-ad .content");

  // 1. marca sem PDV: desliga a SAIPOS de teste
  await pg.click('.cw-ad .navbtn:has-text("Integrações e bases")'); await pg.waitForTimeout(800);
  const sw = ad.locator('button[role="switch"]:has-text("Ligar integração")');
  if ((await sw.getAttribute("aria-checked")) === "true") { await sw.click(); await ad.locator('button:has-text("Salvar")').first().click(); await pg.waitForTimeout(800); }
  ok((await sw.getAttribute("aria-checked")) === "false", "SAIPOS desligada: o gestor comanda a cozinha");

  // 2. abre o gestor ao vivo
  await pg.click('.cw-ad .navbtn:has-text("Pedidos")');
  await ad.locator(".kb-board").waitFor({ timeout: 8000 });
  ok((await ad.locator(".kb-col").count()) === 6, "seis colunas: Novos, Agendados, Em preparo, Prontos, Em rota, Concluídos");
  await pg.screenshot({ path: OUT + "/k1-vazio.png" });

  // 3. cliente faz o pedido no cardápio (pagamento na entrega)
  await sf.locator('[data-id="s40"] .info').click();
  await sf.locator('#g-g_sab40 .opt-row:has-text("4 Queijos") button[aria-label^="Adicionar"]').first().click();
  await sf.locator('#g-g_sab40 .opt-row:has(.o-n:text-is("Marguerita")) button[aria-label^="Adicionar"]').click();
  await sf.locator("#cta-add").click(); await pg.waitForTimeout(600);
  await sf.locator(".bagbar").click(); await pg.waitForTimeout(600);
  await sf.locator('[data-screen="bag"] .foot-cta .cta').click(); await pg.waitForTimeout(400);
  await sf.locator("#cw-a-postalCode").fill("22431-050"); await sf.locator("#cw-a-number").fill("100"); await sf.locator("#cw-a-street").fill("Rua Dias Ferreira"); await sf.locator("#cw-a-district").fill("Leblon"); await sf.locator("#cw-a-city").click();
  await sf.locator('[data-screen="checkout"] .okline').first().waitFor();
  await sf.locator('.payopt:has-text("na entrega")').first().click();
  if (await sf.locator("#cw-name").count()) {
    await sf.locator("#cw-name").fill("Kanban Teste"); await sf.locator("#cw-phone").fill("21 9" + String(Date.now()).slice(-8));
    await sf.locator('button:has-text("Receber código")').click(); await sf.locator("#cw-code").fill("1234"); await sf.locator('button:has-text("Confirmar código")').click();
    await sf.locator(".ident-ok").waitFor(); await pg.waitForTimeout(400);
  }
  await sf.locator('[data-screen="checkout"] .foot-cta .cta').click();
  await pg.waitForTimeout(1500);

  // 4. chega em Novos, pisca e toca até alguém ver
  const novo = ad.locator(".kb-novos .kb-card").first();
  await novo.waitFor({ timeout: 10000 });
  const num = await novo.getAttribute("data-order");
  ok(!!num, "pedido #" + num + " chegou em Novos sem recarregar");
  ok(/is-new/.test(await novo.getAttribute("class")) && (await pg.locator("#kb-ack").count()) === 1, "card pulsa e o botão 'Ciente' aparece (som + título piscando)");
  const txt = (await novo.textContent()).replace(/\s+/g, " ");
  ok(/Levar maquininha|Dinheiro/.test(txt) && /1\/2/.test(txt) && /Dias Ferreira/.test(txt), "card mostra pagamento, meio a meio e endereço: " + txt.slice(0, 140));
  await pg.screenshot({ path: OUT + "/k2-novo.png" });

  // 5. imprime a comanda
  await novo.locator('button:has-text("Imprimir")').click(); await pg.waitForTimeout(800);
  const ticket = await pg.frameLocator("#kb-print-frame").locator("body").textContent();
  ok(new RegExp("#" + num).test(ticket) && /TOTAL/.test(ticket) && /4 Queijos/.test(ticket), "comanda de 80 mm montada com itens e total");

  // 6. aceita e anda pelas colunas
  const card = (col) => ad.locator(`.kb-${col} .kb-card[data-order="${num}"]`);
  await novo.locator('button:has-text("Aceitar")').click();
  await card("em_preparo").waitFor({ timeout: 6000 });
  ok((await pg.locator("#kb-ack").count()) === 0, "aceitar silencia o alarme");
  ok(true, "aceito → Em preparo");
  await card("em_preparo").locator('button:has-text("Pronto")').click();
  await card("prontos").waitFor({ timeout: 6000 }); ok(true, "→ Prontos");
  await card("prontos").locator('button:has-text("Saiu para entrega")').click();
  await card("em_rota").waitFor({ timeout: 6000 }); ok(true, "→ Em rota");
  await pg.screenshot({ path: OUT + "/k3-rota.png" });
  await card("em_rota").locator('button:has-text("Entregue")').click();
  await card("concluidos").waitFor({ timeout: 6000 }); ok(true, "→ Concluídos hoje");

  // 7. o cliente vê o status no acompanhamento
  await pg.waitForTimeout(5000);
  ok(/Entregue|entregue/.test(await sf.textContent()), "acompanhamento do cliente mostra Entregue");

  // 8. configurações, pausa e histórico
  await pg.click("#kb-settings"); await pg.waitForTimeout(400);
  ok(/Aceitar pedidos automaticamente/.test(await pg.locator(".cw-ad .drawer").textContent()), "configurações do gestor abrem");
  await pg.keyboard.press("Escape");
  await pg.click("#kb-pause"); await pg.waitForTimeout(1200);
  ok(/Loja pausada/.test(await ad.locator(".kb-bar").textContent()), "pausar loja pelo gestor");
  await pg.click("#kb-pause"); await pg.waitForTimeout(1200);
  ok(/Recebendo pedidos/.test(await ad.locator(".kb-bar").textContent()), "reabrir loja");
  await pg.click('.cw-ad .tab:has-text("Histórico")'); await pg.waitForTimeout(1000);
  ok(new RegExp(num).test(await ad.locator("table tbody tr").first().textContent()), "histórico lista o pedido");
  await pg.click('.cw-ad .tab:has-text("Gestor ao vivo")'); await pg.waitForTimeout(800);

  // 9. celular: colunas viram carrossel com atalhos
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(600);
  ok(await ad.locator(".kb-colnav").isVisible(), "no celular aparecem os atalhos das colunas");
  await pg.screenshot({ path: OUT + "/k4-celular.png" });
  console.log(errs.length ? errs.slice(0, 10) : "sem erros");
  await b.close();
})();
