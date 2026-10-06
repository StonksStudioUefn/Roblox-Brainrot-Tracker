/**
 * sources.test.mjs — getJson() contra un servidor local que se queda colgado.
 *
 *   node --test test/sources.test.mjs
 *
 * Una petición sin respuesta (o con el cuerpo a medias) tiene que acabar en
 * `timeout` ms como un fallo más: reintenta, gasta del Budget y da null. Antes
 * no tenía tope y bloqueaba su paso del Workflow hasta sus 10 minutos.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { Budget, getJson } from "../src/sources.js";

let server, url;
const hits = { cuelga: 0, cuerpo: 0, ok: 0 };
before(async () => {
  server = createServer((req, res) => {
    const path = req.url.slice(1);
    hits[path] = (hits[path] || 0) + 1;
    if (path === "cuelga") return;   // ni cabeceras
    if (path === "cuerpo") { res.writeHead(200, { "content-type": "application/json" }); res.write('{"data": ['); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"data": [1]}');
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  url = path => `http://127.0.0.1:${server.address().port}/${path}`;
});
after(() => { server.closeAllConnections(); server.close(); });

// Si getJson no corta, la prueba falla aquí en vez de quedarse colgada
const within = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`sigue esperando tras ${ms} ms`)), ms).unref())]);

for (const [path, what] of [["cuelga", "sin respuesta"], ["cuerpo", "con el cuerpo a medias"]]) {
  test(`una petición ${what} acaba en timeout, reintenta y da null`, async () => {
    const budget = new Budget(10);
    const t0 = Date.now();
    const got = await within(3000, getJson(url(path), { budget, retries: 1, base: 1, timeout: 200 }));
    assert.equal(got, null);
    assert.equal(hits[path], 2, "un intento y un reintento");
    assert.equal(budget.used, 2);
    assert.ok(Date.now() - t0 < 2000, `tardó ${Date.now() - t0} ms`);
  });
}

test("una respuesta a tiempo no cambia", async () => {
  const budget = new Budget(10);
  assert.deepEqual(await within(3000, getJson(url("ok"), { budget, timeout: 200 })), { data: [1] });
  assert.equal(budget.used, 1);
});
