// Gera o app independente da LG. Dois canais, com o mesmo código:
//
//   npm run ipk         Developer: dist/webos/            (GitHub, Modo Desenvolvedor, se atualiza sozinho)
//   npm run ipk:store   Store:     dist/webos/store/      (LG Content Store, só a loja atualiza)
//   npm run ipk:store:fhd          dist/webos/store-fhd/  (o mesmo, em 1280x720: sem ele a loja não mostra o app nas TVs Full HD)
//
// Developer, opcionais: BUNDLE_VERSION (número da build; sem ele o IPK não se atualiza sozinho)
// e ANDROID_UPDATE_KEY (PEM usado para assinar o manifesto de atualização).
// Store, opcionais: WEBOS_STORE_ID (padrão com.kazamastudios.iptvkz) e WEBOS_STORE_VENDOR.
// Os dois: WEBOS_LAN_PAIRING=0 desliga o cadastro pelo celular (servidor só em 127.0.0.1).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const STORE = process.argv.includes('--store') || process.env.WEBOS_CHANNEL === 'store';
const CHANNEL = STORE ? 'store' : 'developer';
const FHD = STORE && process.argv.includes('--fhd');

const root = path.join(__dirname, '..');
const webos = path.join(root, 'platforms', 'webos');
const base = path.join(root, 'dist', 'webos');
const out = STORE ? path.join(base, FHD ? 'store-fhd' : 'store') : base;
const appDir = path.join(out, 'app');
const serviceDir = path.join(out, 'service');
const bundleDir = path.join(serviceDir, 'app');
const bundleVersion = Number(process.env.BUNDLE_VERSION || 0);
const NODE_TARGET = 'node8';
const UPDATE_BASE = process.env.UPDATE_BASE || 'https://github.com/kazamastudios/iptvkz/releases/latest/download/';
// Developer com número de build: baixa atualizações. IPK feito no PC e Store: nunca.
const AUTO_UPDATE = !STORE && bundleVersion > 0;

const DEV_ID = 'com.kazamastudios.iptvkz.dev';
const APP_ID = STORE ? process.env.WEBOS_STORE_ID || 'com.kazamastudios.iptvkz' : DEV_ID;
const SERVICE_ID = APP_ID + '.service';
// Cadastro pelo celular (servidor aberto à rede de casa). WEBOS_LAN_PAIRING=0 deixa só a própria TV.
const LAN_PAIRING = process.env.WEBOS_LAN_PAIRING !== '0';
const VENDOR = STORE ? process.env.WEBOS_STORE_VENDOR || 'Kazama Studios' : null;

function publicKey() {
  if (process.env.UPDATE_PUBLIC_PEM) return fs.readFileSync(process.env.UPDATE_PUBLIC_PEM, 'utf8');
  const xml = fs.readFileSync(path.join(root, 'platforms', 'android', 'app', 'src', 'main', 'res', 'values', 'update_key.xml'), 'utf8');
  const b64 = />([A-Za-z0-9+/=\s]{100,})</.exec(xml)[1].replace(/\s+/g, '');
  return `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

// Cada canal limpa só o que é dele: o Developer não apaga a pasta store/.
if (STORE) fs.rmSync(out, { recursive: true, force: true });
else if (fs.existsSync(out)) {
  for (const name of fs.readdirSync(out)) if (!name.startsWith('store')) fs.rmSync(path.join(out, name), { recursive: true, force: true });
}
fs.mkdirSync(appDir, { recursive: true });
fs.mkdirSync(bundleDir, { recursive: true });

// ---------- app (abertura) ----------
for (const e of fs.readdirSync(webos, { withFileTypes: true })) {
  if (e.isFile()) fs.copyFileSync(path.join(webos, e.name), path.join(appDir, e.name));
}
fs.copyFileSync(path.join(root, 'src', 'web', 'img', 'logo-horizontal.webp'), path.join(appDir, 'logo-horizontal.webp'));
const { version } = readJson(path.join(root, 'package.json'));
const info = path.join(appDir, 'appinfo.json');
const appinfo = { ...readJson(info), id: APP_ID, version };
if (VENDOR) appinfo.vendor = VENDOR;
if (FHD) appinfo.resolution = '1280x720';
// Developer fora da versão publicada (build no PC ou de um PR): o app de testes aparece como "IPTVKZ Beta".
if (!STORE && require('./build-info').buildInfo().channel !== 'producao') {
  appinfo.title = 'IPTVKZ Beta';
  // ícones âmbar com o selo BETA (scripts/make-beta-icons.py)
  for (const f of ['icon.png', 'largeIcon.png']) fs.copyFileSync(path.join(webos, 'beta', f), path.join(appDir, f));
  // abertura em âmbar, como o tema do app Beta
  fs.copyFileSync(path.join(root, 'src', 'web', 'img', 'logo-horizontal-beta.webp'), path.join(appDir, 'logo-horizontal.webp'));
  const launcher = path.join(appDir, 'index.html');
  let html = fs.readFileSync(launcher, 'utf8');
  for (const [from, to] of [['#4d0d12', '#4d3208'], ['rgba(77, 13, 18', 'rgba(77, 50, 8'], ['#3a0716', '#3a2406'], ['rgba(58, 7, 22', 'rgba(58, 36, 6'], ['#ff2a2a', '#ffb547']]) {
    html = html.split(from).join(to);
  }
  fs.writeFileSync(launcher, html);
}
writeJson(info, appinfo);
// a abertura chama o serviço pelo nome: troca o do Developer pelo do canal
const splash = path.join(appDir, 'index.html');
fs.writeFileSync(splash, fs.readFileSync(splash, 'utf8').split(DEV_ID + '.service').join(SERVICE_ID));

// ---------- serviço ----------
const service = path.join(webos, 'service');
writeJson(path.join(serviceDir, 'package.json'), { ...readJson(path.join(service, 'package.json')), name: SERVICE_ID, version, ...(AUTO_UPDATE ? {} : { description: 'Servidor interno do IPTVKZ' }) });
const services = readJson(path.join(service, 'services.json'));
services.id = SERVICE_ID;
if (!AUTO_UPDATE) services.description = 'Servidor interno do IPTVKZ';
services.services = services.services.map((s) => ({ ...s, name: SERVICE_ID, description: services.description }));
writeJson(path.join(serviceDir, 'services.json'), services);

const nodeBuild = { bundle: true, platform: 'node', target: NODE_TARGET, format: 'cjs', minify: true, legalComments: 'none', logLevel: 'warning' };
esbuild.buildSync({
  ...nodeBuild,
  entryPoints: [path.join(service, 'main.js')],
  outfile: path.join(serviceDir, 'main.js'),
  external: ['webos-service'],
  define: {
    __CHANNEL__: JSON.stringify(CHANNEL),
    __SERVICE_ID__: JSON.stringify(SERVICE_ID),
    __AUTO_UPDATE__: JSON.stringify(AUTO_UPDATE),
    __LAN_PAIRING__: JSON.stringify(LAN_PAIRING),
    // a Store não leva endereço nem chave de atualização
    __UPDATE_BASE__: JSON.stringify(AUTO_UPDATE ? UPDATE_BASE : ''),
    __UPDATE_KEY__: JSON.stringify(AUTO_UPDATE ? publicKey() : ''),
  },
});

// ---------- servidor compilado + interface (no Developer, também o pacote atualizável) ----------
esbuild.buildSync({ ...nodeBuild, entryPoints: [path.join(service, 'app-entry.js')], outfile: path.join(bundleDir, 'server.js') });
fs.cpSync(path.join(root, 'src', 'web'), path.join(bundleDir, 'web'), {
  recursive: true,
  filter: (f) => !f.endsWith('.map') && path.basename(f) !== 'logo-horizontal.png', // a abertura usa o WebP
});
fs.writeFileSync(path.join(bundleDir, 'version.txt'), String(bundleVersion));
require('./build-info').writeBuildInfo(path.join(bundleDir, 'web'), { build: bundleVersion, channel: STORE ? 'producao' : undefined }); // versão e modo no app

// O pacote baixável só existe no Developer: a Store não publica nem lê pacotes de fora.
let bundleFile = null;
if (!STORE) {
  const files = {};
  for (const rel of walk(bundleDir)) files[rel] = fs.readFileSync(path.join(bundleDir, rel)).toString('base64');
  bundleFile = path.join(out, 'IPTVKZ-webos-bundle.gz');
  fs.writeFileSync(bundleFile, zlib.gzipSync(JSON.stringify(files), { level: 9 }));
}

// ---------- conferência antes de empacotar ----------
require('./check-webos').check({ appDir, serviceDir, channel: CHANNEL, appId: APP_ID, serviceId: SERVICE_ID });

// ---------- IPK ----------
const cli = path.join(root, 'node_modules', '@webos-tools', 'cli', 'bin', 'ares-package.js');
execFileSync(process.execPath, [cli, appDir, serviceDir, '--outdir', out, '--no-minify'], { stdio: 'inherit' });

// ---------- manifesto assinado (Developer) ----------
const keyFile = process.env.ANDROID_UPDATE_KEY;
if (STORE) {
  console.log(`Canal Store: ${APP_ID} ${version}, sem atualização automática. IPK em ${path.relative(root, out)}.`);
} else if (!keyFile) {
  console.log('ANDROID_UPDATE_KEY não definida: manifesto de atualização não gerado.');
} else {
  const manifest = Buffer.from(JSON.stringify({ bundleVersion, bundle: path.basename(bundleFile), bundleSha256: sha256(bundleFile) }));
  fs.writeFileSync(path.join(out, 'webos-update.json'), manifest);
  fs.writeFileSync(path.join(out, 'webos-update.json.sig'), crypto.sign('sha256', manifest, fs.readFileSync(keyFile)).toString('base64'));
}
