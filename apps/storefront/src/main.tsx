import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { httpTransport } from "@cw/client";
import { Storefront } from "./Storefront";

const qs = new URLSearchParams(location.search);
const api = qs.get("api") || import.meta.env.VITE_API_URL || "http://localhost:8787";
const idle = Number(qs.get("idle")) || undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="cw-standalone">
      <Storefront transport={httpTransport(api)} slug={qs.get("marca") || "forneria-original"} storeId={qs.get("loja") || undefined} source={qs.get("utm_source") || undefined} idleOverrideSeconds={idle} />
    </div>
  </StrictMode>,
);
