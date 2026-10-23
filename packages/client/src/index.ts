/** Cliente HTTP da API. O transporte é injetável: fetch real em produção, app em memória na demonstração. */
export type Transport = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; json: unknown }>;

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export function httpTransport(baseUrl: string): Transport {
  return async (method, path, body, headers = {}) => {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const res = await fetch(baseUrl.replace(/\/$/, "") + path, { method, headers: isForm ? headers : { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

export function createClient(transport: Transport, auth: { admin?: () => string | null; customer?: () => string | null } = {}) {
  const call = async <T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> => {
    const h: Record<string, string> = { ...extra };
    const a = auth.admin?.(); if (a) h.authorization = "Bearer " + a;
    const c = auth.customer?.(); if (c) h["x-customer-token"] = c;
    const r = await transport(method, path, body, h);
    if (r.status >= 400) { const j = (r.json || {}) as { error?: string; details?: unknown }; throw new ApiError(r.status, j.error || `Erro ${r.status}`, j.details); }
    return r.json as T;
  };
  return {
    get: <T>(p: string) => call<T>("GET", p),
    post: <T>(p: string, b?: unknown) => call<T>("POST", p, b ?? {}),
    put: <T>(p: string, b: unknown) => call<T>("PUT", p, b),
    patch: <T>(p: string, b: unknown) => call<T>("PATCH", p, b),
    del: <T>(p: string) => call<T>("DELETE", p),
    upload: <T>(p: string, fd: FormData) => call<T>("POST", p, fd),
  };
}
export type Api = ReturnType<typeof createClient>;
