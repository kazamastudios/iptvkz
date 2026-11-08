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

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
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
  run('unzip', ['-q', '-o', path.join(tmp, zip), 'bin/armeabi-v7a/*', 'bin/arm64-v8a/*', 'include/*', '-d', target]);
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
  const zip = path.join(out, 'IPTVKZ-android-bundle.zip');
  fs.rmSync(zip, { force: true });
  run('zip', ['-q', '-r', zip, '.'], { cwd: stage });
  fs.rmSync(stage, { recursive: true, force: true });
  const assets = path.join(android, 'app', 'src', 'main', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(zip, path.join(assets, 'bundle.zip'));
  return zip;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function main() {
  const v = props();
  const bundleVersion = Number(process.env.BUNDLE_VERSION || v.bundleVersion);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  ensureLibnode();
  const bundle = buildBundle(bundleVersion);
  run('./gradlew', ['--no-daemon', 'assembleRelease'], {
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
