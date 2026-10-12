import { setCors } from "../lib/http.js";
export default function handler(req, res) {
  setCors(res, req, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  // Deliberately expose no environment, provider, secret-configuration, or route inventory.
  return res.status(200).json({ ok: true, service: "Trimémo Academic Engine", status: "available" });
}
