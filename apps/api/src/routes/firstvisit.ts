import { Hono } from "hono";
import { z } from "zod";
import { sign } from "hono/jwt";
import { validBirthDate, validCpfDigits, type Customer } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { checkPassword, hashPassword, readToken } from "../auth";
import { snapshotFor } from "../services/orders";
import { saveFirstVisit } from "../services/firstvisit";
import { activePayments, isOnlineCode } from "../services/payments";
import { consumeOtp } from "../services/otp";

type C = Customer & { id: string };
interface Credential { id: string; passwordHash: string; setAt: string; failed: number; lockedUntil?: string }
interface OnlineClaims { kind: "online"; cid: string; tid: string; exp: number; [k: string]: unknown }

const signOnline = (cid: string, tid: string, secret: string) => sign({ kind: "online", cid, tid, exp: Math.floor(Date.now() / 1000) + 20 * 60 }, secret, "HS256");

/** Pedido com pagamento online exige o token curto que sai da senha (quando a marca pede senha). */
export async function requireOnlineAuth(c: import("hono").Context<Env>, paymentCode: string) {
  if (!isOnlineCode(paymentCode)) return;
  const pay = await activePayments(ctxOf(c));
  if (!pay || pay.cfg.requirePassword === false) return;
  const cid = c.get("customerId");
  if (!cid) throw new HttpError(401, "Confirme seu telefone para pagar online");
  const tok = await readToken<OnlineClaims>(c.req.header("x-online-token"), c.get("deps").jwtSecret);
  if (!tok || tok.kind !== "online" || tok.cid !== cid || tok.tid !== c.get("tenantId")) throw new HttpError(401, "Confirme sua senha para pagar online");
}

const pw = z.string().min(6, "A senha precisa de pelo menos 6 caracteres").max(72);

export function registerFirstVisitPublic(r: Hono<Env>) {
  /** Triagem da primeira visita: respostas, contato (opcional ou exigido pelo cupom) ou "pular". */
  r.post("/firstvisit", async (c) => {
    const i = await body(c, z.object({
      leadId: z.string().max(40).optional(), sessionId: z.string().max(60).optional(), skip: z.boolean().optional(),
      answers: z.record(z.string().max(40)).default({}),
      contact: z.object({ name: z.string().max(80).optional(), phone: z.string().max(20).optional(), email: z.string().max(120).optional(), optinWhatsapp: z.boolean().optional(), optinEmail: z.boolean().optional() }).optional(),
      source: z.string().max(40).optional(), campaign: z.string().max(80).optional(),
    }));
    if (c.get("customerId")) throw new HttpError(409, "Você já é cliente");
    const ctx = ctxOf(c);
    return c.json(await saveFirstVisit(ctx, await snapshotFor(ctx), i));
  });

  /* ---------- senha só para pagamento online ---------- */
  const me = async (c: import("hono").Context<Env>) => {
    const id = c.get("customerId"); if (!id) throw new HttpError(401, "Confirme seu telefone");
    const cust = await c.get("deps").db.get<C>("customers", c.get("tenantId"), id); if (!cust) throw new HttpError(401, "Confirme seu telefone");
    return cust;
  };
  const cred = (c: import("hono").Context<Env>, id: string) => c.get("deps").db.get<Credential>("credentials", c.get("tenantId"), id);

  r.get("/me/online-auth", async (c) => {
    const cust = await me(c); const cr = await cred(c, cust.id);
    const pay = await activePayments(ctxOf(c));
    return c.json({ required: !!pay && pay.cfg.requirePassword !== false, hasPassword: !!cr, hasDocument: !!cust.document, hasBirthDate: !!cust.birthday, documentEnd: cust.document ? cust.document.slice(-2) : undefined });
  });

  /** Primeiro pagamento online: CPF + data de nascimento + senha nova. */
  r.post("/me/online-identity", async (c) => {
    const cust = await me(c);
    if (await cred(c, cust.id)) throw new HttpError(409, "Você já tem senha. Use a senha ou peça uma nova.");
    const i = await body(c, z.object({ cpf: z.string(), birthDate: z.string(), password: pw }));
    const cpf = i.cpf.replace(/\D/g, "");
    if (!validCpfDigits(cpf)) throw new HttpError(422, "CPF inválido");
    if (!validBirthDate(i.birthDate, c.get("deps").now())) throw new HttpError(422, "Data de nascimento inválida");
    const check = c.get("deps").verifyIdentity ? await c.get("deps").verifyIdentity!(cpf, i.birthDate) : null;
    if (check === false) throw new HttpError(422, "CPF e data de nascimento não conferem");
    const now = c.get("deps").now().toISOString();
    await c.get("deps").db.patch("customers", c.get("tenantId"), cust.id, { document: cpf, birthday: i.birthDate, identityCheckedAt: check ? now : undefined });
    await c.get("deps").db.put("credentials", c.get("tenantId"), { id: cust.id, passwordHash: await hashPassword(i.password), setAt: now, failed: 0 } as never);
    return c.json({ onlineToken: await signOnline(cust.id, c.get("tenantId"), c.get("deps").jwtSecret), verified: !!check });
  });

  /** Pagamentos seguintes: só a senha (5 erros bloqueiam por 15 minutos). */
  r.post("/me/online-auth", async (c) => {
    const cust = await me(c); const cr = await cred(c, cust.id);
    if (!cr) throw new HttpError(404, "Crie sua senha primeiro");
    const now = c.get("deps").now();
    if (cr.lockedUntil && cr.lockedUntil > now.toISOString()) throw new HttpError(429, "Muitas tentativas. Tente em alguns minutos ou peça uma senha nova.");
    const i = await body(c, z.object({ password: z.string().max(72) }));
    if (!(await checkPassword(i.password, cr.passwordHash))) {
      const failed = (cr.failed || 0) + 1;
      await c.get("deps").db.patch("credentials", c.get("tenantId"), cust.id, { failed, lockedUntil: failed >= 5 ? new Date(+now + 15 * 60e3).toISOString() : undefined });
      throw new HttpError(422, "Senha incorreta");
    }
    await c.get("deps").db.patch("credentials", c.get("tenantId"), cust.id, { failed: 0, lockedUntil: undefined });
    return c.json({ onlineToken: await signOnline(cust.id, c.get("tenantId"), c.get("deps").jwtSecret) });
  });

  /** Esqueci a senha: código no WhatsApp (POST /auth/otp antes) + nova senha. */
  r.post("/me/online-reset", async (c) => {
    const cust = await me(c);
    const i = await body(c, z.object({ code: z.string().max(8), password: pw }));
    if (!cust.phone) throw new HttpError(422, "Cadastro sem telefone");
    consumeOtp(c.get("tenantId"), cust.phone, i.code);
    await c.get("deps").db.put("credentials", c.get("tenantId"), { id: cust.id, passwordHash: await hashPassword(i.password), setAt: c.get("deps").now().toISOString(), failed: 0 } as never);
    return c.json({ onlineToken: await signOnline(cust.id, c.get("tenantId"), c.get("deps").jwtSecret) });
  });
}
