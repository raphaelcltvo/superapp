import { createRoot } from "react-dom/client";
import { httpTransport } from "@cw/client";
import { Admin } from "./Admin";

const q = new URLSearchParams(location.search);
const api = q.get("api") || import.meta.env.VITE_API_URL || "http://localhost:8787";
document.documentElement.style.height = "100%"; document.body.style.margin = "0"; document.body.style.height = "100%";
createRoot(document.getElementById("root")!).render(<Admin transport={httpTransport(api)} />);
