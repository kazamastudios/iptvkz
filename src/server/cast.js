// "Assistir na TV": acha na rede de casa as TVs que recebem vídeo (Chromecast/Android TV/Google TV pelo protocolo
// Cast, LG/Samsung/outras pelo DLNA) e manda o vídeo para elas tocarem, sem instalar nada na TV.
// O vídeo sai deste servidor (o proxy, que já cuida do User-Agent e do HLS); só a TV escolhida pode buscá-lo
// enquanto a transmissão dura (allowed()). Sem bibliotecas: mDNS, SSDP, SOAP e o protocolo Cast feitos aqui.
const dgram = require('dgram');
const tls = require('tls');
const net = require('./network');

const SCAN_MS = 2500;
const CACHE_MS = 30000;
let cache = { at: 0, list: [] };
let scanning = null;
let session = null; // { device, kind, ip, ... } transmissão em andamento (uma por vez)

// ---------- mDNS: _googlecast._tcp ----------

function dnsName(name) {
  return Buffer.concat([...name.split('.').map((p) => Buffer.concat([Buffer.from([Buffer.byteLength(p)]), Buffer.from(p)])), Buffer.from([0])]);
}

function readName(buf, off) {
  const parts = [];
  let jumped = false;
  let next = off;
  for (let guard = 0; guard < 64; guard++) {
    const len = buf[off];
    if (len === undefined) break;
    if (len === 0) { off += 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) next = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      jumped = true;
      continue;
    }
    parts.push(buf.toString('utf8', off + 1, off + 1 + len));
    off += 1 + len;
  }
  return { name: parts.join('.'), next: jumped ? next : off };
}

function parseDns(buf) {
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let off = 12;
  for (let i = 0; i < qd; i++) off = readName(buf, off).next + 4;
  const recs = [];
  for (let i = 0; i < total && off < buf.length; i++) {
    const { name, next } = readName(buf, off);
    off = next;
    const type = buf.readUInt16BE(off);
    const len = buf.readUInt16BE(off + 8);
    const data = off + 10;
    const r = { name, type };
    if (type === 12) r.ptr = readName(buf, data).name;
    if (type === 33) { r.port = buf.readUInt16BE(data + 4); r.target = readName(buf, data + 6).name; }
    if (type === 1) r.ip = [...buf.subarray(data, data + 4)].join('.');
    if (type === 16) {
      r.txt = {};
      for (let p = data; p < data + len;) {
        const l = buf[p];
        const kv = buf.toString('utf8', p + 1, p + 1 + l);
        const eq = kv.indexOf('=');
        if (eq > 0) r.txt[kv.slice(0, eq)] = kv.slice(eq + 1);
        p += 1 + l;
      }
    }
    recs.push(r);
    off = data + len;
  }
  return recs;
}

function scanCast() {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const q = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), dnsName('_googlecast._tcp.local'), Buffer.from([0, 12, 0x80, 1])]);
    sock.on('message', (msg, rinfo) => {
      let recs;
      try { recs = parseDns(msg); } catch { return; }
      const srv = recs.find((r) => r.type === 33);
      const txt = recs.find((r) => r.type === 16);
      if (!srv && !txt) return;
      const a = recs.find((r) => r.type === 1);
      const ip = (a && a.ip) || rinfo.address;
      const t = (txt && txt.txt) || {};
      const id = 'cast:' + (t.id || ip);
      found.set(id, { id, kind: 'cast', name: t.fn || 'Chromecast', model: t.md || '', ip, port: (srv && srv.port) || 8009 });
    });
    sock.on('error', () => {});
    sock.bind(0, () => {
      const send = () => { try { sock.send(q, 5353, '224.0.0.251'); } catch {} };
      send();
      setTimeout(send, 600);
    });
    setTimeout(() => { try { sock.close(); } catch {} resolve([...found.values()]); }, SCAN_MS);
  });
}

// ---------- SSDP + DLNA (MediaRenderer) ----------

const tag = (xml, name) => {
  const m = new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(xml);
  return m ? m[1].trim() : '';
};

function scanDlna() {
  return new Promise((resolve) => {
    const locations = new Set();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\n'
      + 'ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n');
    sock.on('message', (m) => {
      const loc = /^location:\s*(\S+)/im.exec(m.toString());
      if (loc) locations.add(loc[1]);
    });
    sock.on('error', () => {});
    sock.bind(0, () => {
      const send = () => { try { sock.send(msg, 1900, '239.255.255.250'); } catch {} };
      send();
      setTimeout(send, 600);
    });
    setTimeout(async () => {
      try { sock.close(); } catch {}
      const out = [];
      await Promise.all([...locations].map(async (loc) => {
        try {
          const xml = await (await fetch(loc, { signal: AbortSignal.timeout(3000) })).text();
          const services = xml.split(/<service>/i).slice(1);
          const av = services.find((s) => /AVTransport/i.test(tag(s, 'serviceType')));
          if (!av) return;
          const base = tag(xml, 'URLBase') || loc;
          const ip = new URL(loc).hostname;
          out.push({ id: 'dlna:' + (tag(xml, 'UDN') || loc), kind: 'dlna', name: tag(xml, 'friendlyName') || 'TV', model: tag(xml, 'modelName'), ip,
            control: new URL(tag(av, 'controlURL'), base).href });
        } catch {}
      }));
      resolve(out);
    }, SCAN_MS);
  });
}

// Procura (ou devolve a busca recente). Um aparelho que fala os dois protocolos aparece uma vez, pelo Cast.
async function devices(fresh = false) {
  if (!fresh && Date.now() - cache.at < CACHE_MS) return cache.list;
  if (!scanning) {
    scanning = Promise.all([scanCast(), scanDlna()]).then(([c, d]) => {
      const castIps = new Set(c.map((x) => x.ip));
      const list = [...c, ...d.filter((x) => !castIps.has(x.ip))].sort((a, b) => a.name.localeCompare(b.name));
      cache = { at: Date.now(), list };
      scanning = null;
      return list;
    });
  }
  return scanning;
}

// ---------- DLNA: comandos SOAP ----------

async function soap(control, action, args) {
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>`
    + `<u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID>${args || ''}</u:${action}></s:Body></s:Envelope>`;
  const r = await fetch(control, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"urn:schemas-upnp-org:service:AVTransport:1#${action}"` },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`A TV recusou (${action}: ${tag(text, 'errorDescription') || r.status})`);
  return text;
}

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const hms = (t) => { t = Math.max(0, Math.floor(t)); return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const secs = (s) => { const p = String(s || '').split(':').map(Number); return p.length === 3 && p.every(Number.isFinite) ? p[0] * 3600 + p[1] * 60 + p[2] : 0; };

async function dlnaPlay(dev, url, { title, contentType, startAt }) {
  const meta = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">`
    + `<item id="0" parentID="-1" restricted="1"><dc:title>${esc(title || 'IPTVKZ')}</dc:title><upnp:class>object.item.videoItem</upnp:class>`
    + `<res protocolInfo="http-get:*:${esc(contentType)}:*">${esc(url)}</res></item></DIDL-Lite>`;
  await soap(dev.control, 'Stop').catch(() => {});
  await soap(dev.control, 'SetAVTransportURI', `<CurrentURI>${esc(url)}</CurrentURI><CurrentURIMetaData>${esc(meta)}</CurrentURIMetaData>`);
  await soap(dev.control, 'Play', '<Speed>1</Speed>');
  if (startAt > 1) setTimeout(() => soap(dev.control, 'Seek', `<Unit>REL_TIME</Unit><Target>${hms(startAt)}</Target>`).catch(() => {}), 2500);
}

// ---------- Cast (Chromecast, Android TV, Google TV) ----------
// Mensagens do protocolo Cast: protobuf CastMessage simples, com 4 bytes de tamanho na frente.

function varint(n) {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
const pbString = (field, s) => { const b = Buffer.from(s); return Buffer.concat([varint((field << 3) | 2), varint(b.length), b]); };
const pbInt = (field, n) => Buffer.concat([varint(field << 3), varint(n)]);

function encodeCast(source, dest, ns, payload) {
  const body = Buffer.concat([pbInt(1, 0), pbString(2, source), pbString(3, dest), pbString(4, ns), pbInt(5, 0), pbString(6, JSON.stringify(payload))]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

function decodeCast(buf) {
  const out = {};
  for (let p = 0; p < buf.length;) {
    let key = 0; let shift = 0; let b;
    do { b = buf[p++]; key |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const field = key >> 3;
    if ((key & 7) === 0) { do { b = buf[p++]; } while (b & 0x80); continue; }
    let len = 0; shift = 0;
    do { b = buf[p++]; len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const s = buf.toString('utf8', p, p + len);
    p += len;
    if (field === 4) out.ns = s;
    if (field === 6) { try { out.data = JSON.parse(s); } catch {} }
  }
  return out;
}

const NS = {
  conn: 'urn:x-cast:com.google.cast.tp.connection',
  beat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  recv: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
};
const DEFAULT_RECEIVER = 'CC1AD845'; // o player padrão do Google: toca HLS, MP4, WebM... sem app nosso na TV

function castConnect(dev) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: dev.ip, port: dev.port || 8009, rejectUnauthorized: false }, () => resolve(conn));
    let buf = Buffer.alloc(0);
    let reqId = 1;
    const waiters = [];
    const conn = {
      sock,
      status: null,
      send(dest, ns, payload) { sock.write(encodeCast('sender-0', dest, ns, payload)); },
      request(dest, ns, payload, match) {
        const requestId = reqId++;
        this.send(dest, ns, { ...payload, requestId });
        return new Promise((res, rej) => {
          const w = { match: (m) => (m.data && m.data.requestId === requestId) || (match && match(m)), res };
          waiters.push(w);
          setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('A TV não respondeu')); } }, 10000);
        });
      },
      close() { clearInterval(beat); try { sock.destroy(); } catch {} },
    };
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.length < 4 + len) break;
        const m = decodeCast(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
        if (m.ns === NS.beat && m.data && m.data.type === 'PING') { conn.send('receiver-0', NS.beat, { type: 'PONG' }); continue; }
        if (m.ns === NS.media && m.data && m.data.type === 'MEDIA_STATUS' && m.data.status && m.data.status[0]) conn.status = m.data.status[0];
        for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].match(m)) { waiters.splice(i, 1)[0].res(m); }
      }
    });
    sock.on('error', reject);
    sock.on('close', () => { if (session && session.conn === conn) session.closed = true; });
    const beat = setInterval(() => { try { conn.send('receiver-0', NS.beat, { type: 'PING' }); } catch {} }, 5000);
  });
}

async function castPlay(dev, url, { title, contentType, live, startAt }) {
  const conn = await castConnect(dev);
  conn.send('receiver-0', NS.conn, { type: 'CONNECT' });
  const st = await conn.request('receiver-0', NS.recv, { type: 'LAUNCH', appId: DEFAULT_RECEIVER });
  const app = st.data && st.data.status && (st.data.status.applications || []).find((a) => a.appId === DEFAULT_RECEIVER);
  if (!app) throw new Error('A TV não abriu o player do Cast');
  conn.transport = app.transportId;
  conn.send(conn.transport, NS.conn, { type: 'CONNECT' });
  const r = await conn.request(conn.transport, NS.media, {
    type: 'LOAD', autoplay: true, currentTime: startAt > 1 ? startAt : 0,
    media: { contentId: url, contentType, streamType: live ? 'LIVE' : 'BUFFERED', metadata: { metadataType: 0, title: title || 'IPTVKZ' } },
  }, (m) => m.data && (m.data.type === 'LOAD_FAILED' || m.data.type === 'LOAD_CANCELLED'));
  if (r.data && /LOAD_FAILED|LOAD_CANCELLED/.test(r.data.type)) { conn.close(); throw new Error('A TV não conseguiu abrir este vídeo'); }
  return conn;
}

// ---------- transmissão ----------

function contentTypeOf(url) {
  const p = String(url).split(/[?#]/)[0].toLowerCase();
  if (/\.m3u8?$/.test(p)) return 'application/x-mpegURL';
  if (/\.ts$/.test(p)) return 'video/mp2t';
  if (/\.mkv$/.test(p)) return 'video/x-matroska';
  if (/\.webm$/.test(p)) return 'video/webm';
  return 'video/mp4';
}

// mediaUrl(ip): endereço que a TV usa para buscar o vídeo neste servidor (pelo IP da rede de casa)
async function play({ id, url, title, live, startAt, mediaUrl }) {
  const dev = (await devices()).find((d) => d.id === id) || (await devices(true)).find((d) => d.id === id);
  if (!dev) throw Object.assign(new Error('TV não encontrada. Ela está ligada e no mesmo Wi-Fi?'), { status: 404 });
  await stop();
  session = { dev, ip: dev.ip, url, title, live: !!live, at: Date.now() };
  const src = mediaUrl(dev.ip);
  const contentType = contentTypeOf(url);
  try {
    if (dev.kind === 'cast') session.conn = await castPlay(dev, src, { title, contentType, live, startAt });
    else await dlnaPlay(dev, src, { title, contentType, startAt });
  } catch (err) {
    session = null;
    throw Object.assign(err, { status: 502 });
  }
  return status();
}

async function control(action, t) {
  const s = session;
  if (!s) throw Object.assign(new Error('Nada tocando na TV'), { status: 409 });
  if (s.dev.kind === 'dlna') {
    if (action === 'pause') await soap(s.dev.control, 'Pause');
    if (action === 'play') await soap(s.dev.control, 'Play', '<Speed>1</Speed>');
    if (action === 'seek') await soap(s.dev.control, 'Seek', `<Unit>REL_TIME</Unit><Target>${hms(t)}</Target>`);
    if (action === 'stop') return stop();
    return status();
  }
  const c = s.conn;
  if (!c || s.closed) throw Object.assign(new Error('A TV encerrou a transmissão'), { status: 409 });
  if (action === 'stop') return stop();
  const mediaSessionId = c.status && c.status.mediaSessionId;
  const type = { pause: 'PAUSE', play: 'PLAY', seek: 'SEEK' }[action];
  if (type && mediaSessionId) await c.request(c.transport, NS.media, { type, mediaSessionId, ...(type === 'SEEK' ? { currentTime: t } : {}) }).catch(() => {});
  return status();
}

async function stop() {
  const s = session;
  session = null;
  if (!s) return { casting: false };
  try {
    if (s.dev.kind === 'dlna') await soap(s.dev.control, 'Stop');
    else if (s.conn) {
      if (s.conn.transport) s.conn.send('receiver-0', NS.recv, { type: 'STOP', requestId: 999 });
      s.conn.close();
    }
  } catch {}
  return { casting: false };
}

async function status() {
  const s = session;
  if (!s) return { casting: false };
  const out = { casting: true, device: { id: s.dev.id, name: s.dev.name, kind: s.dev.kind }, title: s.title, live: s.live };
  if (s.dev.kind === 'cast') {
    const st = s.conn && s.conn.status;
    if (s.closed) { session = null; return { casting: false, ended: true }; }
    if (st) Object.assign(out, { state: st.playerState, time: st.currentTime, duration: st.media && st.media.duration });
  } else {
    try {
      const [pos, info] = await Promise.all([soap(s.dev.control, 'GetPositionInfo'), soap(s.dev.control, 'GetTransportInfo')]);
      Object.assign(out, { state: tag(info, 'CurrentTransportState'), time: secs(tag(pos, 'RelTime')), duration: secs(tag(pos, 'TrackDuration')) });
    } catch {}
  }
  return out;
}

// Só a TV da transmissão em andamento busca vídeo neste servidor sem o "acesso pela rede" ligado.
const allowed = (ip) => !!(session && net.isPrivate(ip) && ip.replace(/^::ffff:/, '') === session.ip);

module.exports = { devices, play, control, stop, status, allowed, _test: { encodeCast, decodeCast, parseDns, dnsName } };
