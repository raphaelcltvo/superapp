import type { SaiposCatalogRow, SaiposEvent, SaiposOrder } from "./types";

/**
 * SAIPOS de mentira, compatível com o contrato público (auth, order, update-order-status, cancel-order, v2/catalog).
 * Usada nos testes e no modo demonstração para exercitar o fluxo sem credenciais.
 */
export class FakeSaipos {
  orders = new Map<string, { payload: SaiposOrder; status: string; codSale: number }>();
  calls: { path: string; body: unknown }[] = [];
  catalogRows: SaiposCatalogRow[] = [];
  private seq = 1000;
  constructor(public base = "https://fake-saipos.local", private secrets: Record<string, string> = {}) {}

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ path: url.pathname, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const err = (status: number, code: number, msg: string) => json(status, { type: url.pathname.slice(1), errorCode: code, dateTime: new Date().toISOString(), errorMessage: msg, guidRequest: crypto.randomUUID() });
    if (url.pathname === "/auth") {
      if (!body?.idPartner || !body?.secret || (this.secrets[body.idPartner] && this.secrets[body.idPartner] !== body.secret)) return err(401, 901, "Token inválido ou expirado.");
      return json(200, { token: "fake-" + body.idPartner + "-" + Date.now() });
    }
    if (url.pathname === "/catalog-file.json") return json(200, this.catalogRows);
    const auth = (init.headers as Record<string, string>)?.Authorization;
    if (!auth?.startsWith("fake-")) return err(401, 901, "Token inválido ou expirado.");
    if (url.pathname === "/order") {
      const o = body as SaiposOrder;
      if (this.orders.has(o.order_id)) return err(400, 904, "Pedido com o order_id informado já importado.");
      if (o.order_method?.mode === "DELIVERY" && !o.delivery_address && o.order_method.delivery_by === "RESTAURANT") return err(400, 923, "Estrutura de endereço inválida.");
      if (!o.items?.length || o.items.some((i) => !i.integration_code)) return err(400, 902, "Erro na validação dos dados enviados.");
      this.orders.set(o.order_id, { payload: o, status: "PENDING", codSale: ++this.seq });
      return json(200, {});
    }
    if (url.pathname === "/update-order-status") {
      const o = this.orders.get(body.order_id);
      if (!o) return err(400, 914, "Não existe pedido com esse identificador.");
      o.status = body.status;
      return json(200, { code: "set-sale-partner-sale-status-success", idStore: "896", codSale1: o.codSale, statusToUpdate: { status: body.status }, update: true, confirmed_by: "SAIPOS" });
    }
    if (url.pathname === "/cancel-order") {
      const o = this.orders.get(body.order_id);
      if (!o) return err(400, 914, "Não existe pedido com esse identificador.");
      o.status = "CANCELLED";
      return json(200, {});
    }
    if (url.pathname === "/v2/catalog") return json(200, { url: this.base + "/catalog-file.json" });
    return err(404, 900, "Rota inexistente na SAIPOS de teste");
  };

  /** Simula o restaurante mudando o status no PDV: devolve o corpo que a SAIPOS envia ao webhook. */
  event(orderId: string, event: SaiposEvent) {
    const o = this.orders.get(orderId);
    if (o) o.status = event;
    return { event, cod_store: o?.payload.cod_store || "", order_id: orderId };
  }
}
