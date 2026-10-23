import type { Deps } from "../deps";
export interface Ctx { deps: Deps; tenantId: string }
export class HttpError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }
