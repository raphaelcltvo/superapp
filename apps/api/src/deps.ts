import type { Db } from "./db/types";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Storage {
  /** grava o arquivo e devolve a URL pública */
  put(tenantId: string, name: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

export interface Messenger {
  send(tenantId: string, to: string, text: string): Promise<{ id: string; status: "sent" | "queued" | "failed"; error?: string }>;
}

export interface Deps {
  db: Db;
  jwtSecret: string;
  now: () => Date;
  /** fetch usado para a SAIPOS (injetável para testes e demonstração) */
  saiposFetch?: Fetch;
  storage: Storage;
  messenger: Messenger;
  /** envia o código de verificação (WhatsApp/SMS). Retorna o código só em modo demonstração. */
  sendOtp: (tenantId: string, phone: string, code: string) => Promise<void>;
  demo?: boolean;
  publicUrl: string;
  log?: (msg: string, extra?: unknown) => void;
}

/** Armazenamento em memória que devolve data URLs (demonstração/testes). */
export const dataUrlStorage: Storage = {
  async put(_t, _n, bytes, type) {
    let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return `data:${type};base64,${btoa(s)}`;
  },
};

/** Provedor de mensagens que só registra (troque pelo WhatsApp Cloud API em produção). */
export const logMessenger: Messenger = { async send() { return { id: crypto.randomUUID(), status: "queued" }; } };
