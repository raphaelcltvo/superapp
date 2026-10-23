import { Hono } from "hono";
import { z } from "zod";
import type { EngagementSettings } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { engagementReport, engagementSettings, putEngagementSettings, saveFeedback, saveTriage } from "../services/engagement";

/** Rotas públicas da pesquisa (registradas dentro de /public/:slug, que já identifica marca e cliente). */
export function registerEngagePublic(r: Hono<Env>) {
  r.post("/triage", async (c) => {
    const id = c.get("customerId"); if (!id) throw new HttpError(401, "Entre com seu telefone");
    const i = await body(c, z.object({ kind: z.enum(["party", "mood", "craving", "avoid", "skip"]), values: z.array(z.string().max(40)).max(10).default([]), sessionId: z.string().optional() }));
    return c.json(await saveTriage(ctxOf(c), id, i));
  });
  r.post("/orders/:id/feedback", async (c) => {
    const i = await body(c, z.object({ nps: z.number().int().min(0).max(10), reasons: z.array(z.string().max(60)).max(6).default([]), wantToTry: z.string().max(60).optional(), comment: z.string().max(600).optional(), sessionId: z.string().optional() }));
    return c.json(await saveFeedback(ctxOf(c), c.req.param("id"), c.get("customerId"), i));
  });
}

const avoidTag = z.object({ id: z.string().min(1).max(30), label: z.string().min(1).max(40), keywords: z.array(z.string().min(2)).min(1) });
export const engagementSchema = z.object({
  triage: z.object({
    enabled: z.boolean(), cooldownDays: z.number().min(0).max(90), occasionHours: z.number().min(1).max(48),
    questions: z.array(z.object({ kind: z.enum(["party", "mood", "craving", "avoid"]), enabled: z.boolean(), title: z.string().min(3).max(80) })),
    partyItems: z.object({ solo: z.string().optional(), dupla: z.string().optional(), galera: z.string().optional() }),
    noveltyItemId: z.string().optional(), avoidTags: z.array(avoidTag),
  }),
  postOrder: z.object({
    enabled: z.boolean(), reasonsLow: z.array(z.string().min(2).max(40)).max(10), reasonsHigh: z.array(z.string().min(2).max(40)).max(10),
    detractorCredit: z.number().min(0).max(200), creditExpiresInDays: z.number().int().min(1).max(365), alertPhone: z.string().optional(), googleReviewUrl: z.string().url().optional().or(z.literal("")),
  }),
  effects: z.object({
    vibrate: z.boolean(), glowCta: z.boolean(), glowPresetSeconds: z.number().min(0).max(120), freeShippingNudge: z.number().min(0).max(200),
    exitIntent: z.object({ enabled: z.boolean(), couponId: z.string().optional(), title: z.string().min(2).max(60), text: z.string().min(2).max(200) }),
    returnAfterSeconds: z.number().min(0).max(3600), statusBuzz: z.boolean(),
  }),
});

/** Painel: /admin/engagement */
export function engageAdminRoutes() {
  const r = new Hono<Env>();
  r.get("/settings", async (c) => c.json(await engagementSettings(ctxOf(c))));
  r.put("/settings", async (c) => {
    const v = await body(c, engagementSchema);
    if (v.postOrder.googleReviewUrl === "") delete v.postOrder.googleReviewUrl;
    return c.json(await putEngagementSettings(ctxOf(c), v as EngagementSettings));
  });
  r.get("/report", async (c) => c.json(await engagementReport(ctxOf(c), Math.min(365, Number(c.req.query("days") || 30)))));
  return r;
}
