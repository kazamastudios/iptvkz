// Gera o APK da Android TV e os arquivos de atualização em dist/android/.
// Uso: npm run android           (compila)
// Chaves: ANDROID_KEYSTORE, ANDROID_KEYSTORE_PASSWORD e ANDROID_UPDATE_KEY (arquivo PEM).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const android = path.join(root, 'platforms', 'android');
const out = path.join(root, 'dist', 'android');
const NODE_VERSION = 'v18.20.4';

const WIN = process.platform === 'win32';
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); // o do Windows, não o do Git

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', shell: WIN && /\.(bat|cmd)$/.test(cmd), ...opts });
}

// Linux e Mac usam zip/unzip; no Windows, o tar que vem com o sistema lê e grava zip.
function zipDir(zip, cwd) {
  if (WIN) run(TAR, ['-a', '-cf', zip, ...fs.readdirSync(cwd)], { cwd });
  else run('zip', ['-q', '-r', zip, '.'], { cwd });
}

function props() {
  const text = fs.readFileSync(path.join(android, 'version.properties'), 'utf8');
  return Object.fromEntries(text.split('\n').filter((l) => /^\w+=/.test(l)).map((l) => l.trim().split('=')));
}

// Node para Android: versão fixa, baixada uma vez para app/libnode.
function ensureLibnode() {
  const target = path.join(android, 'app', 'libnode');
  if (fs.existsSync(path.join(target, 'include', 'node', 'node.h'))) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'libnode-'));
  const zip = `nodejs-mobile-${NODE_VERSION}-android.zip`;
  run('gh', ['release', 'download', NODE_VERSION, '--repo', 'nodejs-mobile/nodejs-mobile', '-p', zip, '-D', tmp]);
  fs.mkdirSync(target, { recursive: true });
  if (WIN) run(TAR, ['-xf', path.join(tmp, zip), '-C', target, 'bin/armeabi-v7a', 'bin/arm64-v8a', 'include']);
  else run('unzip', ['-q', '-o', path.join(tmp, zip), 'bin/armeabi-v7a/*', 'bin/arm64-v8a/*', 'include/*', '-d', target]);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// O pacote é um zip igual ao de atualização: main.js, version.txt e src/.
function buildBundle(version) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvkz-bundle-'));
  fs.copyFileSync(path.join(android, 'node', 'main.js'), path.join(stage, 'main.js'));
  fs.writeFileSync(path.join(stage, 'version.txt'), String(version));
  fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), {
    recursive: true,
    filter: (f) => !f.endsWith('.map'),
  });
  require('./build-info').writeBuildInfo(path.join(stage, 'src', 'web'), { build: version }); // versão e modo no app
  const zip = path.join(out, 'IPTVKZ-android-bundle.zip');
  fs.rmSync(zip, { force: true });
  zipDir(zip, stage);
  fs.rmSync(stage, { recursive: true, force: true });
  const assets = path.join(android, 'app', 'src', 'main', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(zip, path.join(assets, 'bundle.zip'));
  // abertura nativa: no Beta (tudo fora de uma tag v*), o logo âmbar
  const beta = !(process.env.GITHUB_REF || '').startsWith('refs/tags/v');
  fs.copyFileSync(path.join(root, 'src', 'web', 'img', beta ? 'logo-horizontal-beta.webp' : 'logo-horizontal.webp'), path.join(assets, 'logo-horizontal.webp'));
  return zip;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function main() {
  const v = props();
  // Sem a chave oficial (build no PC), sai o app "IPTVKZ Beta", ao lado do oficial. A versão do pacote fica acima
  // de 1 bilhão, para ele não trocar o código local pelo da versão publicada, e cresce a cada build (minutos desde
  // 2026): com o mesmo número, o app reinstalado manteria o código da instalação anterior.
  const local = !process.env.ANDROID_KEYSTORE;
  const localVersion = 1000000000 + Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000);
  const bundleVersion = Number(process.env.BUNDLE_VERSION || (local ? localVersion : v.bundleVersion));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  ensureLibnode();
  const bundle = buildBundle(bundleVersion);
  run(WIN ? path.join(android, 'gradlew.bat') : './gradlew', ['--no-daemon', 'assembleRelease'], {
    cwd: android,
    env: { ...process.env, BUNDLE_VERSION: String(bundleVersion) },
  });
  const apk = path.join(out, 'IPTVKZ-android.apk');
  fs.copyFileSync(path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), apk);

  const keyFile = process.env.ANDROID_UPDATE_KEY;
  if (!keyFile) {
    console.log('ANDROID_UPDATE_KEY não definida: manifesto de atualização não gerado.');
    return;
  }
  const manifest = Buffer.from(JSON.stringify({
    nativeVersion: Number(v.nativeVersion),
    nativeName: v.nativeName,
    bundleVersion,
    apk: path.basename(apk),
    apkSha256: sha256(apk),
    bundle: path.basename(bundle),
    bundleSha256: sha256(bundle),
  }));
  const signature = crypto.sign('sha256', manifest, fs.readFileSync(keyFile));
  fs.writeFileSync(path.join(out, 'android-update.json'), manifest);
  fs.writeFileSync(path.join(out, 'android-update.json.sig'), signature.toString('base64'));
}

main();
