// Gera o app independente da LG em dist/webos/: IPK e, com a chave, os arquivos de atualização.
// Uso: npm run ipk
// Opcionais: BUNDLE_VERSION (número da versão) e ANDROID_UPDATE_KEY (PEM usado para assinar).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const webos = path.join(root, 'platforms', 'webos');
const out = path.join(root, 'dist', 'webos');
const appDir = path.join(out, 'app');
const serviceDir = path.join(out, 'service');
const bundleDir = path.join(serviceDir, 'app');
const bundleVersion = Number(process.env.BUNDLE_VERSION || 0);
const NODE_TARGET = 'node8';
const UPDATE_BASE = process.env.UPDATE_BASE || 'https://github.com/lucasyemz/iptvkz/releases/latest/download/';

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

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
fs.mkdirSync(bundleDir, { recursive: true });

// ---------- app (abertura) ----------
for (const e of fs.readdirSync(webos, { withFileTypes: true })) {
  if (e.isFile()) fs.copyFileSync(path.join(webos, e.name), path.join(appDir, e.name));
}
fs.copyFileSync(path.join(root, 'src', 'web', 'img', 'logo-horizontal.webp'), path.join(appDir, 'logo-horizontal.webp'));
const info = path.join(appDir, 'appinfo.json');
const { version } = require(path.join(root, 'package.json'));
fs.writeFileSync(info, JSON.stringify({ ...JSON.parse(fs.readFileSync(info, 'utf8')), version }, null, 2));

// ---------- serviço ----------
const service = path.join(webos, 'service');
for (const f of ['package.json', 'services.json']) fs.copyFileSync(path.join(service, f), path.join(serviceDir, f));
const nodeBuild = { bundle: true, platform: 'node', target: NODE_TARGET, format: 'cjs', minify: true, legalComments: 'none', logLevel: 'warning' };
esbuild.buildSync({
  ...nodeBuild,
  entryPoints: [path.join(service, 'main.js')],
  outfile: path.join(serviceDir, 'main.js'),
  external: ['webos-service'],
  define: { __UPDATE_BASE__: JSON.stringify(UPDATE_BASE), __UPDATE_KEY__: JSON.stringify(publicKey()) },
});

// ---------- pacote atualizável: servidor compilado + interface ----------
esbuild.buildSync({ ...nodeBuild, entryPoints: [path.join(service, 'app-entry.js')], outfile: path.join(bundleDir, 'server.js') });
fs.cpSync(path.join(root, 'src', 'web'), path.join(bundleDir, 'web'), {
  recursive: true,
  filter: (f) => !f.endsWith('.map') && path.basename(f) !== 'logo-horizontal.png', // a abertura usa o WebP
});
fs.writeFileSync(path.join(bundleDir, 'version.txt'), String(bundleVersion));

const files = {};
for (const rel of walk(bundleDir)) files[rel] = fs.readFileSync(path.join(bundleDir, rel)).toString('base64');
const bundleFile = path.join(out, 'IPTVKZ-webos-bundle.gz');
fs.writeFileSync(bundleFile, zlib.gzipSync(JSON.stringify(files), { level: 9 }));

// ---------- IPK ----------
const cli = path.join(root, 'node_modules', '@webos-tools', 'cli', 'bin', 'ares-package.js');
execFileSync(process.execPath, [cli, appDir, serviceDir, '--outdir', out, '--no-minify'], { stdio: 'inherit' });

// ---------- manifesto assinado ----------
const keyFile = process.env.ANDROID_UPDATE_KEY;
if (!keyFile) {
  console.log('ANDROID_UPDATE_KEY não definida: manifesto de atualização não gerado.');
} else {
  const manifest = Buffer.from(JSON.stringify({ bundleVersion, bundle: path.basename(bundleFile), bundleSha256: sha256(bundleFile) }));
  fs.writeFileSync(path.join(out, 'webos-update.json'), manifest);
  fs.writeFileSync(path.join(out, 'webos-update.json.sig'), crypto.sign('sha256', manifest, fs.readFileSync(keyFile)).toString('base64'));
}
