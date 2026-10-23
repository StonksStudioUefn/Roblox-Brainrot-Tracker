// workers.dev no pasa por Access: ahí solo /api/admin/*; ADMIN_TOKEN, en tiempo constante.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "roblox-http-"));
const OPTS = {
  local: true, persistTo: dir, ip: "127.0.0.1", logLevel: "none", vars: { ADMIN_TOKEN: "test-admin" },
  experimental: { disableExperimentalWarning: true },
};
let worker, uploader;

before(async () => {
  // Con la ruta del dominio, wrangler dev cambia el host de cada petición por el de la ruta
  const toml = join(dir, "wrangler.toml");
  writeFileSync(toml, readFileSync(join(ROOT, "wrangler.toml"), "utf8").replace(/^routes = \[[\s\S]*?^\]\n/m, ""));
  worker = await unstable_dev(join(ROOT, "src/index.js"), { ...OPTS, config: toml });
  uploader = await unstable_dev(join(ROOT, "tools/uploader.js"), {
    ...OPTS, config: join(ROOT, "test/filas.wrangler.toml"), r2: [{ binding: "BUCKET", bucket_name: "x" }],
  });
});
after(async () => {
  await worker?.stop();
  await uploader?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const status = async (w, url, init) => {
  const r = await w.fetch(url, init);
  await r.arrayBuffer();
  return r.status;
};
const DEV = "http://roblox-tracker.x.workers.dev";
const ADMIN = { authorization: "Bearer test-admin" };

test("workers.dev: fuera de /api/admin/* no hay nada", async () => {
  for (const p of ["/api/export", "/", "/metrics.js", "/api/history/123"]) assert.equal(await status(worker, DEV + p), 404, p);
});

test("admin: sin token o con otro del mismo largo, 401", async () => {
  assert.equal(await status(worker, `${DEV}/api/admin/nada`), 401);
  assert.equal(await status(worker, `${DEV}/api/admin/nada`, { headers: { authorization: "Bearer test-admiN" } }), 401);
  assert.equal(await status(worker, `${DEV}/api/admin/nada`, { headers: ADMIN }), 405);
});

test("la web solo responde a GET y HEAD", async () => {
  const WEB = "http://robloxtracker.stonksstudio.com";
  assert.equal(await status(worker, `${WEB}/metrics.js`), 200);
  assert.equal(await status(worker, `${WEB}/api/live`, { method: "POST" }), 405);
});

test("uploader: solo site/ y deploy/, sin «..», y con token", async () => {
  const put = (p, headers = ADMIN) => status(uploader, `http://u.test/file/${p}`, { method: "PUT", headers, body: "x" });
  assert.equal(await put("site/a..b"), 400);
  assert.equal(await put("otra/x"), 400);
  assert.equal(await put("site/x.html", {}), 401);
});
