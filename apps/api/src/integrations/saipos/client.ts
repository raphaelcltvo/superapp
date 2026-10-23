import { SAIPOS_BASE, SaiposError, type SaiposCatalogRow, type SaiposConfig, type SaiposOrder } from "./types";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const tokens = new Map<string, { token: string; exp: number }>();

/** Cliente da API de Pedidos SAIPOS (v2.5). O token vale 2 dias; renovamos com folga e repetimos 1x em erro 901. */
export class SaiposClient {
  constructor(private cfg: SaiposConfig, private http: Fetch = fetch) {}
  get base() { return this.cfg.baseUrl || SAIPOS_BASE[this.cfg.env]; }

  private async parse(res: Response) {
    const text = await res.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : {}; } catch { /* texto puro */ }
    if (!res.ok || (body && typeof body === "object" && "errorCode" in (body as object))) {
      const b = body as { errorCode?: number; errorMessage?: string; message?: string };
      throw new SaiposError(res.status, b?.errorCode, b?.errorMessage || b?.message || `HTTP ${res.status}`, body);
    }
    return body;
  }

  async token(force = false): Promise<string> {
    const key = `${this.base}|${this.cfg.idPartner}`;
    const hit = tokens.get(key);
    if (!force && hit && hit.exp > Date.now()) return hit.token;
    const res = await this.http(`${this.base}/auth`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ idPartner: this.cfg.idPartner, secret: this.cfg.secret }) });
    const body = (await this.parse(res)) as Record<string, unknown>;
    const token = (body.token || body.access_token || (body.data as Record<string, unknown>)?.token || (typeof body === "string" ? body : "")) as string;
    if (!token) throw new SaiposError(res.status, undefined, "Resposta de /auth sem token", body);
    tokens.set(key, { token, exp: Date.now() + 44 * 3600e3 }); // 2 dias de validade, renova com 4h de folga
    return token;
  }

  private async call(path: string, init: RequestInit = {}, retried = false): Promise<unknown> {
    const t = await this.token();
    const res = await this.http(`${this.base}${path}`, { ...init, headers: { accept: "application/json", "content-type": "application/json", Authorization: t, ...(init.headers || {}) } });
    try { return await this.parse(res); }
    catch (e) {
      if (!retried && e instanceof SaiposError && (e.code === 901 || e.status === 401)) { await this.token(true); return this.call(path, init, true); }
      throw e;
    }
  }

  createOrder(o: SaiposOrder) { return this.call("/order", { method: "POST", body: JSON.stringify(o) }); }
  updateStatus(orderId: string, status: "DISPATCHED" | "CONCLUDED" | "CANCELLED") { return this.call("/update-order-status", { method: "POST", body: JSON.stringify({ order_id: orderId, status }) }); }
  cancel(orderId: string) { return this.call("/cancel-order", { method: "POST", body: JSON.stringify({ order_id: orderId, cod_store: this.cfg.codStore }) }); }

  /** GET /v2/catalog devolve um link (30 min) para o JSON do cardápio com os códigos PDV. */
  async catalog(): Promise<SaiposCatalogRow[]> {
    const r = (await this.call("/v2/catalog", { method: "GET" })) as { url?: string };
    if (!r?.url) throw new SaiposError(200, undefined, "Catálogo sem URL", r);
    const res = await this.http(r.url);
    if (!res.ok) throw new SaiposError(res.status, undefined, "Falha ao baixar o catálogo");
    return (await res.json()) as SaiposCatalogRow[];
  }
}
