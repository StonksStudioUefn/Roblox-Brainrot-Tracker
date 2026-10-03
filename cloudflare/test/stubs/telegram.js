// Stub temporal de src/telegram.js (solo para probar el backend mientras no exista).
export async function runTelegram({ exportData, now, getState, setState, force }) {
  const st = (await getState("telegram")) || {};
  await setState("telegram", { ...st, stub_last_run: new Date(now).toISOString() });
  return { stub: true, games: exportData?.games?.length ?? null, force: force || null };
}
