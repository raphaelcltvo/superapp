import type { Context } from "hono";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { HttpError } from "./services/ctx";
import type { Deps } from "./deps";
import type { AdminClaims } from "./auth";

export type Env = { Variables: { deps: Deps; tenantId: string; admin?: AdminClaims; customerId?: string; scopes?: string[] } };

export async function body<S extends ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw new HttpError(400, "JSON inválido"); }
  return schema.parse(raw);
}

export function onError(err: Error, c: Context) {
  if (err instanceof HttpError) return c.json({ error: err.message, details: err.details }, err.status as 400);
  if (err instanceof ZodError) return c.json({ error: "Dados inválidos", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 422);
  console.error(err);
  return c.json({ error: "Erro interno" }, 500);
}
export const ctxOf = (c: Context<Env>) => ({ deps: c.get("deps"), tenantId: c.get("tenantId") });
