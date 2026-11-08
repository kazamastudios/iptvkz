// Telas em uso: cada player avisa que está tocando; quem some por 15s deixa de contar.
const TTL = 15000;
const screens = new Map(); // device -> { device, name, list, title, seen, stop }

function prune() {
  const now = Date.now();
  for (const [k, s] of screens) if (now - s.seen > TTL) screens.delete(k);
}

function heartbeat({ device, name, list, title }) {
  prune();
  const cur = screens.get(device);
  if (cur && cur.stop) {
    screens.delete(device); // o aparelho soube que foi substituído
    return { stop: true, by: cur.stop };
  }
  screens.set(device, { device, name, list, title, seen: Date.now(), stop: null });
  return { ok: true };
}

function others(list, device) {
  prune();
  return [...screens.values()]
    .filter((s) => s.list === list && s.device !== device && !s.stop)
    .map(({ device: d, name, title }) => ({ device: d, name, title }));
}

function stop(target, by) {
  const s = screens.get(target);
  if (s) s.stop = by || 'outro aparelho';
}

// O aparelho substituído já parou? (sumiu da lista ao receber o aviso)
function isGone(target) {
  prune();
  return !screens.has(target);
}

function end(device) {
  const s = screens.get(device);
  if (s && !s.stop) screens.delete(device);
}

module.exports = { heartbeat, others, stop, isGone, end };
