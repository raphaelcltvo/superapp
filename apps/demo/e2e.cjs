const { chromium } = require("playwright");
const OUT = process.env.OUT || ".";
(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,localhost,127.0.0.1" } : undefined;
  const b = await chromium.launch({ proxy, args: ["--ignore-certificate-errors"] });
  const pg = await b.newPage({ viewport: { width: 1500, height: 920 }, ignoreHTTPSErrors: true });
  const errs = [];
  pg.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  pg.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await pg.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  try { await pg.waitForSelector(".cw-ad .rail", { timeout: 60000 }); } catch (e) { await pg.screenshot({ path: OUT + "/fail.png" }); console.log(errs.join("\n")); console.log(await pg.content().then((h) => h.slice(0, 600))); throw e; }
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: OUT + "/1-inicio.png" });
  for (const [btn, name] of [["Estratégias", "2-estrategias"], ["Painel e funil", "3-crm"], ["Lojas e entrega", "4-lojas"], ["Integrações e bases", "5-integracoes"], ["Vitrine e sugestões", "6-vitrine"]]) {
    await pg.click(`.cw-ad .navbtn:has-text("${btn}")`); await pg.waitForTimeout(1500); await pg.screenshot({ path: `${OUT}/${name}.png` });
  }
  console.log(errs.length ? errs.slice(0, 15).join("\n") : "sem erros");
  await b.close();
})();
