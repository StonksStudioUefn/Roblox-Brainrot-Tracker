// Lo común de las pruebas: el mismo D1 y R2 de mentira y el mismo generador en todas.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const rng = seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

export const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

// Como en producción: schema.sql sin comentarios, sentencia a sentencia
export async function aplicarEsquema(db) {
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  for (const q of schema.split(";").map(x => x.trim()).filter(Boolean)) await db.prepare(q).run();
}

// fallos: pasos cuyas escrituras fallan; corte: paso en el que falla todo (se corta la ejecución)
export function contador(raw, log, tagRef = { tag: "" }, fallos = new Set()) {
  const add = (sql, meta) => log.push({ tag: tagRef.tag, sql: sql.replace(/\s+/g, " ").trim().slice(0, 80), read: meta?.rows_read ?? 0, written: meta?.rows_written ?? 0 });
  const corte = () => { if (tagRef.corte && tagRef.tag === tagRef.corte) throw new Error(`corte simulado en ${tagRef.tag}`); };
  class Stmt {
    constructor(s, sql) { this.s = s; this.sql = sql; }
    bind(...a) { return new Stmt(this.s.bind(...a), this.sql); }
    async all() { corte(); const r = await this.s.all(); add(this.sql, r.meta); return r; }
    async run() {
      corte();
      if (fallos.has(tagRef.tag)) throw new Error(`fallo simulado en ${tagRef.tag}`);
      const r = await this.s.run(); add(this.sql, r.meta); return r;
    }
    // first() de D1 no devuelve meta: se hace con all() para contar sus filas
    async first(col) { const row = (await this.all()).results[0]; return row ? (col ? row[col] : row) : null; }
  }
  return {
    prepare: sql => new Stmt(raw.prepare(sql), sql),
    async batch(list) {
      corte();
      if (fallos.has(tagRef.tag)) throw new Error(`fallo simulado en ${tagRef.tag}`);
      const r = await raw.batch(list.map(x => x.s));
      r.forEach((x, i) => add(list[i].sql, x.meta));
      return r;
    },
  };
}

export function memBucket(now = () => new Date()) {
  const store = new Map(), uploaded = new Map();
  const text = async v => typeof v === "string" ? v : v instanceof ReadableStream ? new Response(v).text() : new TextDecoder().decode(v);
  const obj = (k, t) => ({ key: k, size: Buffer.byteLength(t), text: async () => t, json: async () => JSON.parse(t), get body() { return new Response(t).body; } });
  return {
    store,
    seed(k, t, date) { store.set(k, t); uploaded.set(k, date); },
    async put(k, v) { const t = await text(v); store.set(k, t); uploaded.set(k, now()); return { key: k, size: Buffer.byteLength(t) }; },
    async get(k) { return store.has(k) ? obj(k, store.get(k)) : null; },
    async list({ prefix = "", limit = 1000 } = {}) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit);
      return { objects: keys.map(key => ({ key, size: Buffer.byteLength(store.get(key)), uploaded: uploaded.get(key) })), truncated: false };
    },
    async delete(keys) { for (const k of [].concat(keys)) { store.delete(k); uploaded.delete(k); } },
  };
}
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

// N procesos Node nuevos (JIT frío); cada hijo imprime su JSON en la última línea
export function enFrio(self, args, { runs, env = process.env }) {
  const loader = new URL("./cf_loader.mjs", import.meta.url).pathname;
  const out = [];
  for (let i = 0; i < runs; i++) {
    const stdout = execFileSync(process.execPath, ["--single-threaded", "--no-warnings", "--import", loader, self, ...args], { env, encoding: "utf8" });
    out.push(JSON.parse(stdout.trim().split("\n").pop()));
  }
  return { ms: out.map(x => x.ms).sort((a, b) => a - b), last: out[out.length - 1] };
}

export const fmtMs = ms => `mediana ${ms[ms.length >> 1].toFixed(2)} ms  (min ${ms[0].toFixed(2)} · max ${ms[ms.length - 1].toFixed(2)})`;
