// Sin tope, una petición colgada bloqueaba su paso del Workflow sus 10 min.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { Budget, SubBudget, filterRolimons, getJson } from "../src/sources.js";

let server, url;
const hits = { cuelga: 0, cuerpo: 0, ok: 0, error: 0 };
before(async () => {
  server = createServer((req, res) => {
    const path = req.url.slice(1);
    hits[path] = (hits[path] || 0) + 1;
    if (path === "cuelga") return;
    if (path === "error") { res.writeHead(503); res.end(); return; }
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
    const got = await within(2000, getJson(url(path), { budget, retries: 1, base: 1, timeout: 200 }));
    assert.equal(got, null);
    assert.equal(hits[path], 2, "un intento y un reintento");
    assert.equal(budget.used, 2);
  });
}

test("una respuesta a tiempo no cambia", async () => {
  const budget = new Budget(10);
  assert.deepEqual(await within(3000, getJson(url("ok"), { budget, timeout: 200 })), { data: [1] });
  assert.equal(budget.used, 1);
});

// Plan gratis: 50 peticiones por invocación, aunque al paso le quede presupuesto
test("el presupuesto de la invocación corta los reintentos del paso", async () => {
  const parent = new Budget(2), sub = new SubBudget(parent, 10);
  assert.equal(await within(2000, getJson(url("error"), { budget: sub, retries: 5, base: 1, timeout: 200 })), null);
  assert.equal(hits.error, 2);
  assert.equal(parent.used, 2);
  assert.equal(sub.left, 0);
});

// Un juego que se cae del filtro no entra en el radar
test("filterRolimons da lo mismo que JSON.parse y el filtro, con nombres raros", () => {
  const games = {
    1: ['a",999,"b', 299, "i"], 2: ["Café \\ x", 300, "i"], 3: ["n", 1000], 4: ["m", 2999, "i"],
    5: ["q", 30, "i"], 6: ["z\\", 450, "i"],
  };
  const text = JSON.stringify({ success: true, game_count: 6, games });
  const want = Object.entries(games).filter(([, g]) => g[1] >= 300).map(([pid, g]) => [Number(pid), g[0], g[1]]);
  assert.deepEqual(want, [[2, "Café \\ x", 300], [3, "n", 1000], [4, "m", 2999], [6, "z\\", 450]]);
  assert.deepEqual(filterRolimons(text, 300), want);
});
