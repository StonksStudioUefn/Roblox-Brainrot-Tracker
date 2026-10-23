// Despliegue por la API de Cloudflare (sin wrangler): solo claves de site/ y deploy/.
const PREFIX = "roblox-tracker/";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const enc = new TextEncoder();
    const got = enc.encode(req.headers.get("authorization") || ""), want = enc.encode("Bearer " + (env.ADMIN_TOKEN || ""));
    if (!env.ADMIN_TOKEN || got.byteLength !== want.byteLength || !crypto.subtle.timingSafeEqual(got, want)) return new Response("No autorizado", { status: 401 });
    const key = decodeURIComponent(url.pathname.replace(/^\/file\//, ""));
    if (!url.pathname.startsWith("/file/") || !/^(site|deploy)\/[\w.\-\/]+$/.test(key) || key.includes("..")) return new Response("Clave no válida", { status: 400 });
    if (req.method === "PUT") {
      const ct = req.headers.get("content-type");
      const o = await env.BUCKET.put(PREFIX + key, req.body, {
        ...(ct ? { httpMetadata: { contentType: ct } } : {}),
        customMetadata: { app: "roblox-tracker", fecha: new Date().toISOString(), nombre: key.split("/").pop() },
      });
      return Response.json({ key: PREFIX + key, etag: o.etag, size: o.size });
    }
    if (req.method === "DELETE") { await env.BUCKET.delete(PREFIX + key); return Response.json({ key: PREFIX + key, deleted: true }); }
    return new Response("Método no permitido", { status: 405 });
  },
};
