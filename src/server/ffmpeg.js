// Componente opcional do PC: um FFmpeg reduzido, baixado só na primeira vez que um vídeo precisar.
// Ele lê o arquivo (MKV, TS, AVI...) pelo proxy do próprio app, copia a imagem como está e converte só o
// áudio (AC3, E-AC3, DTS, TrueHD...) para AAC, que o navegador toca. Não entra no instalador: o app continua leve.
// O endereço e o SHA-256 de cada arquivo ficam em ffmpeg.json; um arquivo diferente do esperado é recusado.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DATA } = require('./store');
const MANIFEST = require('./ffmpeg.json');

const DIR = path.join(DATA, 'componentes');
// Só Windows, Mac e Linux de PC (x64 ou arm64). A TV LG (Linux em ARM de 32 bits) e o Android não têm o
// componente: lá o vídeo vai ao player do próprio aparelho.
const OS = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
const KEY = OS && (process.arch === 'x64' || process.arch === 'arm64') ? `${OS}-${process.arch}` : null;
const ENTRY = KEY ? (MANIFEST.files || {})[KEY] : null;
// O app de PC traz o FFmpeg junto (scripts/build-desktop.js põe em resources/ffmpeg e o main.js avisa por
// IPTVKZ_FFMPEG). Sem ele (rodando pelo código, versões antigas), vale o baixado sob demanda.
const BUNDLED = process.env.IPTVKZ_FFMPEG && fs.existsSync(process.env.IPTVKZ_FFMPEG) ? process.env.IPTVKZ_FFMPEG : null;
const BIN = BUNDLED || path.join(DIR, `ffmpeg-${MANIFEST.version}${process.platform === 'win32' ? '.exe' : ''}`);

let job = null; // download em andamento: { got, total, error, done }

function available() {
  return !!(BUNDLED || (ENTRY && ENTRY.url && ENTRY.sha256)) || installed();
}

function installed() {
  return fs.existsSync(BIN);
}

function status() {
  return {
    available: available(),
    installed: installed(),
    size: ENTRY ? ENTRY.size || 0 : 0,
    installing: !!(job && !job.done),
    progress: job && job.total ? Math.min(1, job.got / job.total) : 0,
    error: job && job.error ? job.error : null,
  };
}

// Primeiro arquivo de um .zip (o pacote tem só o executável).
function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Pacote inválido');
  const method = buf.readUInt16LE(8);
  let size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (buf.readUInt16LE(6) & 8) { // tamanho só no diretório central
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cd = buf.readUInt32LE(eocd + 16);
    size = buf.readUInt32LE(cd + 20);
  }
  const data = buf.subarray(start, start + size);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error('Pacote inválido');
}

async function download() {
  const r = await fetch(ENTRY.url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Download falhou (${r.status})`);
  job.total = Number(r.headers.get('content-length')) || ENTRY.size || 0;
  const chunks = [];
  for await (const c of r.body) {
    chunks.push(c);
    job.got += c.length;
  }
  const buf = Buffer.concat(chunks);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== ENTRY.sha256) throw new Error('O arquivo baixado não confere. Tente de novo.');
  const exe = unzipFirst(buf);
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = BIN + '.tmp';
  fs.writeFileSync(tmp, exe, { mode: 0o755 });
  fs.renameSync(tmp, BIN);
}

// Começa a baixar (se ainda não está baixando) e responde na hora; a interface acompanha por status().
function install() {
  if (!available()) throw Object.assign(new Error('Componente indisponível neste sistema'), { status: 400 });
  if (installed()) return status();
  if (!job || job.done) {
    job = { got: 0, total: 0, error: null, done: false };
    const j = job;
    download().catch((err) => { j.error = err.message || String(err); }).finally(() => { j.done = true; });
  }
  return status();
}

// Lê o cabeçalho do vídeo: duração e faixas. O FFmpeg só com -i mostra isso e sai com erro (sem saída), o
// que dispensa o ffprobe e mantém o componente pequeno.
function probe(input) {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, ['-hide_banner', '-i', input], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 200000) p.kill(); });
    const timer = setTimeout(() => p.kill(), 20000);
    p.on('error', reject);
    p.on('close', () => {
      clearTimeout(timer);
      const dur = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      const out = { duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : null, video: null, audio: [] };
      const re = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\(([a-z]{2,3})\))?: (Video|Audio): ([a-z0-9_]+)[^\n]*/g;
      let m;
      while ((m = re.exec(err))) {
        if (m[2] === 'Video' && !out.video && !/attached pic/.test(m[0])) out.video = { codec: m[3] };
        if (m[2] === 'Audio') {
          const ch = /(\d)\.1|stereo|mono/.exec(m[0]);
          out.audio.push({ lang: m[1] || '', codec: m[3], channels: ch ? (ch[1] ? +ch[1] + 1 : ch[0] === 'stereo' ? 2 : 1) : 0 });
        }
      }
      if (!out.video && !out.audio.length) return reject(new Error('Não foi possível ler o vídeo'));
      resolve(out);
    });
  });
}

// Vídeo copiado + áudio em AAC estéreo, em MP4 fragmentado, a partir de "start" segundos (a busca recomeça daqui).
// Vídeo que o navegador não decodifica (AVI com Xvid/DivX, MPG com MPEG-2, WMV...): esse é convertido para H.264.
// São arquivos antigos e de resolução baixa, leves para o PC. O resto (H.264, H.265, VP9, AV1) passa sem mexer.
const OLD_VIDEO = /^(mpeg4|msmpeg4v[123]|mpeg2video|mpeg1video|wmv[123]|vc1|h263|flv1|rv[1-4]0|theora|mjpeg)$/;
let encoders = null;
function h264Encoder() {
  if (encoders === null) {
    try {
      encoders = require('child_process').execFileSync(BIN, ['-hide_banner', '-encoders'], { windowsHide: true }).toString();
    } catch {
      encoders = '';
    }
  }
  // por ordem: o da placa de vídeo do sistema (rápido, leve) e depois os de software
  const opts = {
    h264_mf: ['-c:v', 'h264_mf', '-b:v', '6M', '-pix_fmt', 'nv12'],
    h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-b:v', '6M', '-realtime', '1'],
    libx264: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'],
    libopenh264: ['-c:v', 'libopenh264', '-b:v', '6M', '-pix_fmt', 'yuv420p'],
  };
  const order = process.platform === 'win32' ? ['libx264', 'h264_mf', 'libopenh264'] : ['h264_videotoolbox', 'libx264', 'libopenh264'];
  const name = order.find((n) => encoders.split(/\s+/).includes(n));
  return name ? opts[name] : null;
}

function stream(req, res, input, { start = 0, audio = 0, hevc = false, video = '' } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', input, '-map', '0:v:0?', '-map', `0:a:${audio}?`);
  const enc = OLD_VIDEO.test(video) ? h264Encoder() : null;
  if (enc) args.push(...enc, '-vf', "scale='min(1920,iw)':-2", '-g', '48');
  else args.push('-c:v', 'copy');
  if (hevc && !enc) args.push('-tag:v', 'hvc1'); // o Chrome só aceita H.265 em MP4 com esta marcação
  args.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-sn', '-dn',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1');
  const p = spawn(BIN, args, { windowsHide: true });
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
  p.stdout.pipe(res);
  let err = '';
  p.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
  const stop = () => { try { p.kill('SIGKILL'); } catch {} };
  res.on('close', stop);
  p.on('error', () => res.destroy());
  p.on('close', (code) => {
    if (code && !res.writableEnded) console.error('ffmpeg:', err.trim().split('\n').pop());
    res.end();
  });
}

module.exports = { available, installed, status, install, probe, stream };
