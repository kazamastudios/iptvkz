// Gera os ícones do IPTVKZ a partir de assets/brand/logo-original.png (sem dependências):
// recorta o quadrado arredondado, deixa os cantos transparentes e exporta
// src/web/img/icon.png (512), src/web/img/icon-192.png, src/web/favicon.png e platforms/windows/iptvkz.ico.
// Até 48px usa assets/brand/icon-small-original.png (só "KZ"), que continua legível em tamanho pequeno.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');

const RADIUS = 0.155; // raio do canto de assets/brand/icon-master.png, em fração do lado

// ---------- PNG: leitura (8 bits, RGB/RGBA, sem entrelaçamento) ----------
function decodePng(buf) {
  let pos = 8;
  let w, h, ct;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (ct !== 2 && ct !== 6)) throw new Error('PNG não suportado');
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = line[x * bpp];
      out[(y * w + x) * 4 + 1] = line[x * bpp + 1];
      out[(y * w + x) * 4 + 2] = line[x * bpp + 2];
      out[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, data: out };
}

// ---------- PNG: escrita (RGBA) ----------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(img) {
  const { w, h, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- recorte + máscara + redução ----------
function cropMask(src, crop, radius) {
  const S = crop.size;
  const r = S * radius;
  const out = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sx = crop.x + x;
      const sy = crop.y + y;
      const si = (sy * src.w + sx) * 4;
      const di = (y * S + x) * 4;
      // distância até o canto arredondado (borda suave de ~1.5px)
      const cx = Math.max(r, Math.min(S - r, x + 0.5));
      const cy = Math.max(r, Math.min(S - r, y + 0.5));
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r;
      const a = Math.max(0, Math.min(1, 0.5 - d / 1.5));
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = Math.round(a * 255);
    }
  }
  return { w: S, h: S, data: out };
}

// Redução em luz linear com cobertura exata de cada pixel: diagonais brancas sobre preto
// ficam lisas (na média comum em sRGB elas escurecem e parecem serrilhadas).
const TO_LINEAR = Array.from({ length: 256 }, (_, v) => Math.pow(v / 255, 2.2));
const toSrgb = (v) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));

function resize(src, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = src.w / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = x * scale, x1 = (x + 1) * scale, y0 = y * scale, y1 = (y + 1) * scale;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1) && sy < src.h; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1) && sx < src.w; sx++) {
          const w = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0));
          const i = (sy * src.w + sx) * 4;
          const al = (src.data[i + 3] / 255) * w;
          r += TO_LINEAR[src.data[i]] * al;
          g += TO_LINEAR[src.data[i + 1]] * al;
          b += TO_LINEAR[src.data[i + 2]] * al;
          a += al;
          n += w;
        }
      }
      const o = (y * size + x) * 4;
      if (a) { out[o] = toSrgb(r / a); out[o + 1] = toSrgb(g / a); out[o + 2] = toSrgb(b / a); }
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return { w: size, h: size, data: out };
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

const read = (name) => decodePng(fs.readFileSync(path.join(root, 'assets', 'brand', name)));

// Fundo preto vira transparência (o brilho neon se mantém) e corta as margens.
function blackToAlpha(src) {
  let l = src.w, r = 0, t = src.h, b = 0;
  const data = Buffer.from(src.data);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const a = Math.max(0, Math.min(1, (max - 8) / 200));
      if (a > 0.04) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); }
      if (max) for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, (data[i + c] * 255) / max);
      data[i + 3] = Math.round(a * 255);
    }
  }
  const pad = 6;
  l = Math.max(0, l - pad); t = Math.max(0, t - pad); r = Math.min(src.w - 1, r + pad); b = Math.min(src.h - 1, b + pad);
  const w = r - l + 1;
  const h = b - t + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) data.copy(out, y * w * 4, ((y + t) * src.w + l) * 4, ((y + t) * src.w + r + 1) * 4);
  return { w, h, data: out };
}

function trimAlpha(src) {
  let l = src.w, r = 0, t = src.h, b = 0;
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      if (src.data[(y * src.w + x) * 4 + 3] > 10) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); }
    }
  }
  if (l === 0 && t === 0 && r === src.w - 1 && b === src.h - 1) throw new Error('assets/brand/logo-transparent.png não tem fundo transparente.');
  const w = r - l + 1;
  const h = b - t + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) src.data.copy(out, y * w * 4, ((y + t) * src.w + l) * 4, ((y + t) * src.w + r + 1) * 4);
  return { w, h, data: out };
}

function resizeTo(src, w) {
  // reduz em uma tela quadrada virtual mantendo a proporção
  const h = Math.round((src.h * w) / src.w);
  const out = Buffer.alloc(w * h * 4);
  const sc = src.w / w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(y * sc); sy < Math.min(src.h, Math.ceil((y + 1) * sc)); sy++) {
        for (let sx = Math.floor(x * sc); sx < Math.min(src.w, Math.ceil((x + 1) * sc)); sx++) {
          const i = (sy * src.w + sx) * 4;
          const al = src.data[i + 3] / 255;
          r += TO_LINEAR[src.data[i]] * al; g += TO_LINEAR[src.data[i + 1]] * al; b += TO_LINEAR[src.data[i + 2]] * al; a += al; n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a) { out[o] = toSrgb(r / a); out[o + 1] = toSrgb(g / a); out[o + 2] = toSrgb(b / a); }
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return { w, h, data: out };
}

const master = read('icon-master.png');
const full = cropMask(master, { x: 0, y: 0, size: Math.min(master.w, master.h) }, RADIUS);

// ---------- ícone desenhado para tamanhos pequenos (até 48px) ----------
// Em vez de reduzir uma imagem, desenha o "KZ" em vetor em cada tamanho: letras maiores e
// mais grossas e sem borda fina, que é o que serrilha numa barra de tarefas.
const K = [[275, 448], [392, 448], [317, 619], [570, 448], [727, 448], [424, 653], [590, 829], [456, 830], [343, 710], [105, 882]];
const Z = [[765, 448], [1170, 450], [864, 746], [1150, 745], [1075, 829], [622, 829], [960, 531], [679, 531]];
const PLAY = [[586, 572], [735, 660], [586, 752]];
const VARIANT = process.env.ICON_VARIANT || 'black';
const PALETTE = { red: { tile: [225, 22, 28], text: [255, 255, 255] }, black: { tile: [10, 10, 15], text: [255, 255, 255] } };

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearPoly(x, y, poly, t) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const dx = poly[i][0] - ax;
    const dy = poly[i][1] - ay;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - ax - k * dx, y - ay - k * dy) <= t) return true;
  }
  return false;
}

function drawSmall(size) {
  const SS = 8;
  const { tile, text } = PALETTE[VARIANT];
  const out = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const sx = (size * 0.86) / 1065;
  const sy = sx * (size <= 24 ? 1.35 : 1.2);
  const bold = size <= 24 ? 14 : size <= 32 ? 9 : 5; // engrossa as letras (unidades do desenho)
  const showPlay = VARIANT === 'black' && size >= 32;
  const lin = (c) => Math.pow(c / 255, 2.2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0;
      const sum = [0, 0, 0];
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const px = x + (i + 0.5) / SS;
          const py = y + (j + 0.5) / SS;
          const cx = Math.max(r, Math.min(size - r, px));
          const cy = Math.max(r, Math.min(size - r, py));
          if (Math.hypot(px - cx, py - cy) > r) continue;
          covered++;
          const ax = (px - size / 2) / sx + 637.5;
          const ay = (py - size / 2) / sy + 665;
          let c = tile;
          if (inPoly(ax, ay, K) || inPoly(ax, ay, Z) || nearPoly(ax, ay, K, bold) || nearPoly(ax, ay, Z, bold)) c = text;
          else if (showPlay && inPoly(ax, ay, PLAY)) c = [255, 42, 42];
          for (let k = 0; k < 3; k++) sum[k] += lin(c[k]);
        }
      }
      const o = (y * size + x) * 4;
      if (covered) for (let k = 0; k < 3; k++) out[o + k] = toSrgb(sum[k] / covered);
      out[o + 3] = Math.round((covered / (SS * SS)) * 255);
    }
  }
  return { w: size, h: size, data: out };
}

const render = (size) => (size <= 24 ? drawSmall(size) : resize(full, size));
const png = (size) => encodePng(render(size));
const write = (rel, buf) => fs.writeFileSync(path.join(root, rel), buf);

// TV LG: a LG põe o ícone sobre um cartão da cor de iconColor. Sem moldura nem cantos transparentes,
// o desenho se funde com o cartão preto. ICON_TV_ONLY=1 gera só estes dois.
function tvIcon() {
  const side = Math.min(master.w, master.h);
  const inset = Math.round(side * 0.12);
  const s = side - inset * 2;
  const data = Buffer.alloc(s * s * 4);
  const fade = s * 0.07;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const from = ((y + inset) * master.w + x + inset) * 4;
      const to = (y * s + x) * 4;
      const edge = Math.min(1, Math.min(x, y, s - 1 - x, s - 1 - y) / fade);
      for (let c = 0; c < 3; c++) data[to + c] = Math.round(master.data[from + c] * edge);
      data[to + 3] = 255;
    }
  }
  return { w: s, h: s, data };
}
const tvArt = tvIcon();
write('platforms/webos/icon.png', encodePng(resize(tvArt, 80)));
write('platforms/webos/largeIcon.png', encodePng(resize(tvArt, 130)));
if (process.env.ICON_TV_ONLY) process.exit(0);

fs.mkdirSync(path.join(root, 'platforms', 'windows'), { recursive: true });
write('src/web/img/icon.png', png(512));
write('src/web/img/icon-192.png', png(192));
write('src/web/favicon.png', png(64));
for (const size of [16, 24, 32, 48]) write(`src/web/favicon-${size}.png`, png(size));
write('src/web/img/icon-small.png', png(128));
// Prefere um PNG com transparência real em assets/brand/logo-transparent.png; sem ele, usa a versão em fundo preto.
const transparent = path.join(root, 'assets', 'brand', 'logo-transparent.png');
const hsrc = fs.existsSync(transparent) ? trimAlpha(decodePng(fs.readFileSync(transparent))) : blackToAlpha(read('logo-horizontal-original.png'));
// Logo da barra lateral: achata sobre preto antes de remover o fundo, o que elimina o halo escuro do recorte.
{
  const sb = read('logo-sidebar-original.png');
  const flat = Buffer.from(sb.data);
  for (let i = 0; i < flat.length; i += 4) {
    const a = flat[i + 3] / 255;
    for (let c = 0; c < 3; c++) flat[i + c] = Math.round(flat[i + c] * a);
    flat[i + 3] = 255;
  }
  write('src/web/img/logo-sidebar.png', encodePng(resizeTo(blackToAlpha({ w: sb.w, h: sb.h, data: flat }), 900)));
}
write('src/web/img/logo-horizontal.png', encodePng(resizeTo(hsrc, Math.min(1200, hsrc.w))));
write('assets/brand/icon-1024.png', encodePng(resize(full, 1024)));
// macOS: o desenho ocupa 824 de 1024 px, com margem transparente, como os demais ícones do Dock.
{
  const inner = resize(full, 824);
  const data = Buffer.alloc(1024 * 1024 * 4);
  for (let y = 0; y < 824; y++) inner.data.copy(data, ((y + 100) * 1024 + 100) * 4, y * 824 * 4, (y + 1) * 824 * 4);
  write('assets/brand/icon-mac-1024.png', encodePng({ w: 1024, h: 1024, data }));
}
write('assets/brand/icon-small-64.png', encodePng(drawSmall(64)));
const icoBuf = ico([256, 128, 64, 48, 40, 32, 24, 20, 16].map((size) => ({ size, buf: png(size) })));
write('platforms/windows/iptvkz.ico', icoBuf);
write('src/web/favicon.ico', icoBuf);

// Prévia ampliada dos tamanhos pequenos: ICON_PREVIEW=pasta node scripts/make-icon.js
if (process.env.ICON_PREVIEW) {
  const sizes = [16, 20, 24, 32, 48];
  const scale = 6;
  const W = sizes.reduce((n, s) => n + s * scale + 12, 12);
  const H = 48 * scale + 24;
  const data = Buffer.alloc(W * H * 4, 32);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  let ox = 12;
  for (const s of sizes) {
    const im = render(s);
    for (let y = 0; y < s * scale; y++) {
      for (let x = 0; x < s * scale; x++) {
        const si = (Math.floor(y / scale) * s + Math.floor(x / scale)) * 4;
        const di = ((y + 12) * W + ox + x) * 4;
        const a = im.data[si + 3] / 255;
        for (let c = 0; c < 3; c++) data[di + c] = im.data[si + c] * a + 32 * (1 - a);
      }
    }
    ox += s * scale + 12;
  }
  fs.writeFileSync(path.join(process.env.ICON_PREVIEW, `icon-preview-${VARIANT}.png`), encodePng({ w: W, h: H, data }));
}
console.log('Ícones gerados.');
