// Acesso pela rede de casa (TV), endereços locais e "Iniciar com o Windows".
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');

function clean(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

function isLoopback(ip) {
  const a = clean(ip);
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

// Só redes domésticas/privadas podem entrar quando o acesso pela rede está ligado.
function isPrivate(ip) {
  const a = clean(ip);
  if (isLoopback(a)) return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [o1, o2] = [+m[1], +m[2]];
    return o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254);
  }
  const low = a.toLowerCase();
  return low.startsWith('fe80:') || low.startsWith('fc') || low.startsWith('fd');
}

// Nomes aceitos no cabeçalho Host: IP, localhost, nome do aparelho na rede (sem ponto) e
// domínios locais. Um domínio da internet apontado para cá (DNS rebinding) fica de fora.
function allowedHost(host) {
  if (!host) return true; // HTTP/1.0 sem Host: não vem de navegador
  const h = String(host).toLowerCase().replace(/:\d+$/, '');
  if (/^\[[0-9a-f:.]+\]$/.test(h)) return true; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/^[a-z0-9-]+$/.test(h)) return true;
  return /\.(local|lan|home|home\.arpa|internal|localdomain)$/.test(h);
}

// Navegadores mandam Origin em pedidos de outra origem; sem Origin ou com a mesma, segue.
function sameOrigin(origin, host) {
  if (origin == null || origin === '') return true;
  try {
    const o = new URL(origin);
    return (o.protocol === 'http:' || o.protocol === 'https:') && o.host.toLowerCase() === String(host || '').toLowerCase();
  } catch {
    return false; // "null" (iframe isolado, arquivo local) e lixo
  }
}

let cache = { at: 0, value: false };
function lanEnabled() {
  if (Date.now() - cache.at > 2000) {
    const s = store.readJson('settings.json', {});
    cache = { at: Date.now(), value: !!s.lanAccess };
  }
  return cache.value;
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' && i.family !== 4) continue;
      if (i.internal || !isPrivate(i.address) || i.address.startsWith('169.254.')) continue;
      // adaptadores virtuais (VirtualBox, WSL, Hyper-V, VPN) não servem para a TV
      const virtual = /virtual|vbox|vmware|hyper-v|vethernet|wsl|loopback|tailscale|zerotier|vpn/i.test(name) || i.address.startsWith('192.168.56.');
      out.push({ name, address: i.address, virtual });
    }
  }
  return out.sort((a, b) => a.virtual - b.virtual);
}

// ---------- Internet ----------
// Os mesmos endereços que Android e Windows usam para testar a conexão. Um portal de login
// (Wi-Fi de hotel etc.) responde outra coisa, então só o código exato conta como online.
const PROBES = [
  ['http://connectivitycheck.gstatic.com/generate_204', 204],
  ['http://www.msftconnecttest.com/connecttest.txt', 200],
];
const NET_TTL = 8000;
let netCache = { at: 0, value: null };
let netInflight = null;

async function probe([url, code]) {
  const started = Date.now();
  const res = await fetch(url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(5000) });
  try { res.body && res.body.cancel(); } catch {}
  if (res.status !== code) throw new Error('resposta inesperada');
  return Date.now() - started;
}

// isBusy: o servidor está ocupado (montando uma lista)? O tempo medido inclui a espera do próprio servidor para
// ouvir a resposta, então com ele ocupado a medição não diz nada sobre a internet (busy: true, a tela ignora o tempo).
function checkInternet(isBusy = () => false) {
  if (netCache.value && Date.now() - netCache.at < NET_TTL) return Promise.resolve(netCache.value);
  if (!netInflight) {
    const busyAtStart = isBusy();
    netInflight = Promise.any(PROBES.map(probe))
      .then((ms) => ({ online: true, ms, busy: busyAtStart || isBusy() }), () => ({ online: false }))
      .then((value) => {
        netCache = { at: Date.now(), value };
        netInflight = null;
        return value;
      });
  }
  return netInflight;
}

// ---------- Iniciar com o Windows ----------

function startupLink() {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'IPTVKZ (servidor).lnk');
}

function autostartEnabled() {
  const p = startupLink();
  return !!p && fs.existsSync(p);
}

function setAutostart(on) {
  const link = startupLink();
  if (!link || process.platform !== 'win32') return Promise.reject(new Error('Disponível só no Windows.'));
  if (!on) {
    try { fs.unlinkSync(link); } catch {}
    return Promise.resolve(false);
  }
  const root = path.join(__dirname, '..', '..');
  const vbs = path.join(root, 'platforms', 'windows', 'start.vbs');
  const ico = path.join(root, 'platforms', 'windows', 'iptvkz.ico');
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + q(link) + ')',
    '$s.TargetPath = ' + q(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'wscript.exe')),
    '$s.Arguments = ' + q('"' + vbs + '" /server'),
    '$s.WorkingDirectory = ' + q(root),
    '$s.IconLocation = ' + q(ico + ',0'),
    "$s.Description = 'IPTVKZ - servidor para a TV'",
    '$s.Save()',
  ].join('; ');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err) => {
      if (err) reject(new Error('Não consegui criar o atalho de inicialização.'));
      else resolve(true);
    });
  });
}

module.exports = { allowedHost, sameOrigin, checkInternet, isLoopback, isPrivate, lanEnabled, lanAddresses, autostartEnabled, setAutostart, clean };
