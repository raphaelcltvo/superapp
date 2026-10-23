const { chromium } = require("playwright");
const OUT = process.env.OUT || ".";
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,localhost,127.0.0.1" }, args: ["--ignore-certificate-errors"] });
  const pg = await b.newPage({ viewport: { width: 1500, height: 920 }, ignoreHTTPSErrors: true });
  const errs = []; pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  const ok = (c, m) => console.log((c ? "ok: " : "FALHOU: ") + m);
  await pg.goto("http://localhost:8811/index.html");
  await pg.waitForSelector(".cw-sf .store-name", { timeout: 60000 });
  const sf = pg.locator(".demo-screen");
  // novo: sem triagem
  await pg.waitForTimeout(1200);
  ok(!(await sf.locator(".eg-triage").count()), "cliente novo não vê triagem");
  // "antes de ir" no computador
  await sf.locator('[data-id="d3"] .qadd').click(); await pg.waitForTimeout(300);
  await pg.mouse.move(700, 300); await pg.mouse.move(700, 0); await pg.mouse.move(700, -5);
  await pg.evaluate(() => document.dispatchEvent(new MouseEvent("mouseout", { clientY: 0, relatedTarget: null, bubbles: true })));
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: OUT + "/e1-exit.png" });
  ok(await sf.locator(".eg-sheet code").count() > 0, "antes de ir mostra o cupom FICA8");
  await sf.locator('.eg-sheet button.link').click();
  // recorrente: triagem
  await pg.selectOption("#demo-visitor", "recorrente");
  await sf.locator(".eg-triage").waitFor({ timeout: 8000 });
  await pg.screenshot({ path: OUT + "/e2-triagem.png" });
  ok(/quantas pessoas/i.test(await sf.locator(".eg-triage").textContent()), "recorrente vê 'pra quantas pessoas'");
  await sf.locator('.eg-opt:has-text("Família ou galera")').click();
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: OUT + "/e3-hero.png" });
  const hero = await sf.locator("#t-hero").textContent();
  ok(/galera/i.test(hero), "card do topo virou 'Pra galera': " + hero.slice(0, 80));
  // montagem: brilho quando completa
  await sf.locator('[data-id="s40"] .info').click();
  await sf.locator('#g-g_sab40 .opt-row:has-text("4 Queijos") button[aria-label^="Adicionar"]').first().click();
  await sf.locator('#g-g_sab40 .opt-row:has(.o-n:text-is("Marguerita")) button[aria-label^="Adicionar"]').click();
  await pg.waitForTimeout(150);
  ok(/fx-glow/.test(await sf.locator("#cta-add").getAttribute("class")), "botão Adicionar brilha quando a pizza fica pronta");
  await pg.screenshot({ path: OUT + "/e4-glow.png" });
  await sf.locator("#cta-add").click(); await pg.waitForTimeout(600);
  await sf.locator(".bagbar").click(); await pg.waitForTimeout(600);
  await pg.screenshot({ path: OUT + "/e5-bag.png" });
  await sf.locator('[data-screen="bag"] .foot-cta .cta').click(); await pg.waitForTimeout(400);
  await sf.locator("#cw-a-postalCode").fill("22431-050"); await sf.locator("#cw-a-number").fill("100"); await sf.locator("#cw-a-street").fill("Rua Dias Ferreira"); await sf.locator("#cw-a-district").fill("Leblon"); await sf.locator("#cw-a-city").click();
  await sf.locator('[data-screen="checkout"] .okline').first().waitFor();
  await sf.locator('.payopt:has-text("na entrega")').first().click();
  await pg.waitForTimeout(400);
  await sf.locator('[data-screen="checkout"] .foot-cta .cta').click();
  await pg.waitForTimeout(2500);
  const pay = sf.locator('button:has-text("Já paguei")'); if (await pay.count() && await pay.first().isVisible()) await pay.first().click();
  await pg.waitForTimeout(26000);
  await sf.locator(".eg-fb").waitFor({ timeout: 10000 });
  await sf.locator('.eg-fb .npsb:text-is("5")').click();
  await sf.locator('.eg-fb .nchip:has-text("Chegou frio")').click();
  await sf.locator('.eg-fb .nchip').nth(6).click();
  await pg.screenshot({ path: OUT + "/e6-fb.png" });
  await sf.locator('.eg-fb .btn-brand').click(); await pg.waitForTimeout(800);
  const done = await sf.locator(".eg-fb.done").textContent();
  ok(/crédito/.test(done), "detrator recebe crédito: " + done.slice(0, 120));
  await pg.screenshot({ path: OUT + "/e7-fbdone.png" });
  await pg.click('.cw-ad .navbtn:has-text("Pesquisa e engajamento")'); await pg.waitForTimeout(1500);
  await pg.screenshot({ path: OUT + "/e8-admin.png", fullPage: true });
  ok(/NPS/.test(await pg.locator(".cw-ad .content").textContent()), "painel de pesquisa abre");
  for (const t of ["Triagem", "Pós-pedido", "Efeitos na jornada"]) { await pg.click(`.cw-ad .tab:has-text("${t}")`); await pg.waitForTimeout(500); await pg.screenshot({ path: OUT + `/e9-${t.slice(0, 4)}.png` }); }
  console.log(errs.length ? errs.slice(0, 10) : "sem erros");
  await b.close();
})();
