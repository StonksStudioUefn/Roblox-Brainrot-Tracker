// Node no conoce cloudflare:workers: se cambia por un stub (node --import ./test/cf_loader.mjs).
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "cloudflare:workers") return { url: "data:text/javascript,export class WorkflowEntrypoint{constructor(c,e){this.env=e}}; export class WorkerEntrypoint{constructor(c,e){this.env=e}}", shortCircuit: true };
  return next(spec, ctx);
}`));
