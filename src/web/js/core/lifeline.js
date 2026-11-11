// Ligação com o servidor local. Igual em todas as plataformas: o aviso a cada minuto diz ao servidor
// que o app continua aberto (o da TV LG se desliga sozinho alguns minutos depois que o app fecha).
// Na LG, se o servidor sumir (falha ou TV que ficou muito tempo com o app em segundo plano), o app
// pede ao serviço da TV para subir de novo e recarrega a tela, sem a pessoa precisar fechar o app.
const PING_MS = 60000;
const REVIVE_MS = 40000;
let reviving = false;
let bridge = null; // referência viva enquanto espera a resposta do serviço

function ping() {
  return fetch('/api/ping', { cache: 'no-store' }).then((r) => r.ok, () => false);
}

// Serviço do próprio app: o mesmo id do app + ".service" (ver scripts/build-ipk.js).
function lgService() {
  const sys = window.webOSSystem || window.PalmSystem;
  const Bridge = window.WebOSServiceBridge || window.PalmServiceBridge;
  const id = sys && (typeof sys.identifier === 'function' ? sys.identifier() : sys.identifier);
  if (!Bridge || !id) return null;
  return { Bridge, uri: `luna://${String(id).split(' ')[0]}.service/boot` };
}

function revive() {
  const lg = lgService();
  if (!lg || reviving) return;
  reviving = true;
  const done = (port) => {
    clearTimeout(timer);
    reviving = false;
    bridge = null;
    if (port) location.replace(`http://127.0.0.1:${port}/${location.search}${location.hash}`);
  };
  const timer = setTimeout(() => done(0), REVIVE_MS);
  const call = () => {
    bridge = new lg.Bridge();
    bridge.onservicecallback = (raw) => {
      let s;
      try { s = JSON.parse(raw); } catch { return; }
      if (s.phase === 'ready') done(s.port);
      else if (s.phase === 'restart') setTimeout(call, 1500); // o serviço reiniciou: chama de novo
      else if (s.phase === 'error' || s.returnValue === false) done(0);
    };
    bridge.call(lg.uri, JSON.stringify({ subscribe: true }));
  };
  try { call(); } catch { done(0); }
}

async function check() {
  if (await ping()) return;
  if (await ping()) return; // uma falha só pode ser a rede piscando
  revive();
}

export function startLifeline() {
  setInterval(check, PING_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
