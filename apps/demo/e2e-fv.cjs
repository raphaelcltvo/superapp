const { chromium } = require("playwright");
const OUT = process.env.OUT || ".";
const PORT = process.env.PORT || 8833;
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,localhost,127.0.0.1" }, args: ["--ignore-certificate-errors"] });
  const pg = await b.newPage({ viewport: { width: 1500, height: 920 }, ignoreHTTPSErrors: true });
  const errs = []; pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  const ok = (c, m) => console.log((c ? "ok: " : "FALHOU: ") + m);
  const shot = async (name) => { await pg.screenshot({ path: `${OUT}/${name}.png` }); await pg.screenshot({ path: `${OUT}/${name}-cel.png`, clip: { x: 1085, y: 60, width: 405, height: 770 } }); };
  await pg.goto(`http://localhost:${PORT}/index.html`);
  await pg.waitForSelector(".cw-sf .store-name", { timeout: 90000 });
  const sf = pg.locator(".demo-screen");

  // A) modo recompensa (visitante novo, entrou direto)
  await sf.locator(".fv-sheet").waitFor({ timeout: 8000 });
  await shot("fv-a1-pergunta");
  ok(/pessoas/i.test(await sf.locator(".fv-sheet").textContent()), "primeira pergunta: pra quantas pessoas");
  let n = 0;
  while (await sf.locator(".fv-sheet .eg-opt").count() && n < 4) { await sf.locator(".fv-sheet .eg-opt").last().click(); n++; await pg.waitForTimeout(250); if (n === 1) await shot("fv-a2-segunda"); }
  ok(n >= 2, `respondeu ${n} perguntas`);
  await shot("fv-a3-contato");
  await sf.locator("#fv-name").fill("Ana Teste"); await sf.locator("#fv-phone").fill("21987651234"); await sf.locator("#fv-email").fill("ana@teste.com");
  await sf.locator('.fv-sheet button[type="submit"]').click(); await pg.waitForTimeout(700);
  await shot("fv-a4-cupom");
  ok(/BEMVINDO10/.test(await sf.locator(".fv-sheet").textContent()), "cupom liberado (BEMVINDO10)");
  await sf.locator('.fv-sheet button:has-text("Aplicar")').click(); await pg.waitForTimeout(1500);
  await shot("fv-a5-topo");
  const hero = await sf.locator("#t-hero").textContent();
  ok(/parecido/i.test(hero), "topo: quem pede parecido com você → " + hero.replace(/\s+/g, " ").slice(0, 110));
  await sf.locator("#t-hero button").click(); await pg.waitForTimeout(600);
  await shot("fv-a6-item-montado");
  ok(!/blocked/.test(await sf.locator("#cta-add").getAttribute("class")), "item abre já montado com a combinação da persona");
  await sf.locator(".sheet .x").click(); await pg.waitForTimeout(300);

  // painel: personas e modo portão
  await pg.click('.cw-ad .navbtn:has-text("Pesquisa e engajamento")'); await pg.waitForTimeout(800);
  await pg.click('.cw-ad .tab:has-text("Primeira visita")'); await pg.waitForTimeout(1500);
  await pg.screenshot({ path: `${OUT}/fv-painel.png`, fullPage: true });
  ok(/Personas da base/.test(await pg.locator(".cw-ad .content").textContent()), "painel mostra as personas");
  await pg.locator('label.field:has-text("Como o cupom aparece") select').selectOption("gate");
  await pg.click('.cw-ad .content .btn.primary:has-text("Salvar")'); await pg.waitForTimeout(800);

  // B) modo portão: troca o visitante para recomeçar a visita
  await pg.selectOption("#demo-visitor", "recorrente"); await pg.waitForTimeout(800);
  await pg.selectOption("#demo-visitor", "direto");
  await sf.locator(".fv-sheet").waitFor({ timeout: 8000 });
  await shot("fv-b1-oferta");
  ok(/Ganhe/.test(await sf.locator(".fv-sheet").textContent()), "portão: o cupom aparece primeiro");
  await sf.locator('.fv-sheet button:has-text("Quero o cupom")').click(); await pg.waitForTimeout(200);
  n = 0; while (await sf.locator(".fv-sheet .eg-opt").count() && n < 4) { await sf.locator(".fv-sheet .eg-opt").first().click(); n++; await pg.waitForTimeout(250); }
  await shot("fv-b2-contato-obrigatorio");
  ok(await sf.locator('.fv-sheet button[type="submit"]').isDisabled(), "sem celular e e-mail o cupom não libera");
  await sf.locator("#fv-name").fill("Bruno Teste"); await sf.locator("#fv-phone").fill("21976543210"); await sf.locator("#fv-email").fill("bruno@teste.com");
  await sf.locator('.fv-sheet button[type="submit"]').click(); await pg.waitForTimeout(700);
  await shot("fv-b3-liberado");
  ok(/BEMVINDO10/.test(await sf.locator(".fv-sheet").textContent()), "portão: liberou com contato");
  await sf.locator('.fv-sheet button:has-text("Aplicar")').click(); await pg.waitForTimeout(1200);

  // D) senha só no pagamento online
  await sf.locator(".card .qadd").first().click(); await pg.waitForTimeout(400);
  await sf.locator(".bagbar").click(); await pg.waitForTimeout(500);
  await sf.locator('[data-screen="bag"] .foot-cta .cta').click(); await pg.waitForTimeout(400);
  await sf.locator("#cw-a-postalCode").fill("22431-050"); await sf.locator("#cw-a-number").fill("100"); await sf.locator("#cw-a-street").fill("Rua Dias Ferreira"); await sf.locator("#cw-a-district").fill("Leblon"); await sf.locator("#cw-a-city").click();
  await sf.locator('[data-screen="checkout"] .okline').first().waitFor();
  await sf.locator('.payopt:has-text("pague agora")').first().click();
  await sf.locator("#cw-name").fill("Bruno Teste"); await sf.locator("#cw-phone").fill("21976543210");
  await sf.locator('button:has-text("Receber código")').click(); await sf.locator("#cw-code").fill("1234"); await sf.locator('button:has-text("Confirmar código")').click();
  await sf.locator(".ident-ok").waitFor(); await sf.locator("#cw-oa-cpf").waitFor({ timeout: 5000 });
  await sf.locator("#cw-oa-cpf").scrollIntoViewIfNeeded(); await shot("fv-d1-senha-online");
  ok(/Confirme CPF/.test(await sf.locator('[data-screen="checkout"] .foot-cta .cta').textContent()), "Pix online pede CPF, nascimento e senha");
  await sf.locator("#cw-oa-cpf").fill("52998224725"); await sf.locator("#cw-oa-bday").fill("1990-05-10"); await sf.locator("#cw-oa-pw").fill("segredo1");
  await sf.locator('[data-screen="checkout"] .foot-cta .cta').click(); await pg.waitForTimeout(2500);
  await shot("fv-d2-pix");
  ok(/Pix|pix/.test(await sf.locator('[data-screen="pix"]').textContent()), "pedido com Pix online criado depois da senha");

  // C) campanha: produto do anúncio, sem triagem
  await pg.selectOption("#demo-visitor", "novo"); await pg.waitForTimeout(2500);
  await shot("fv-c1-campanha");
  ok(/anúncio/i.test(await sf.locator("#t-hero").textContent()) && !(await sf.locator(".fv-sheet").count()), "anúncio: topo com o produto do criativo e sem triagem");
  console.log(errs.length ? errs.slice(0, 10) : "sem erros");
  await b.close();
})();
