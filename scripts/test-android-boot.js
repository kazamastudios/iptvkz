// Abre o APK num emulador Android já ligado e confere que o app inicia: o Node sobe, a página carrega e a interface
// sai da abertura (mostra os termos na primeira vez). Uma rodada por ABI; armeabi-v7a é o Node de 32 bits das
// TV box antigas, que só existe em aparelho de verdade e não aparece nos testes do PC.
//   node scripts/test-android-boot.js dist/android/IPTVKZ-android.apk armeabi-v7a [arm64-v8a ...]
// Precisa do adb no PATH (ou ANDROID_HOME) e do APK de teste (IPTVKZ Beta, com a depuração da WebView ligada).
// No CI roda num emulador Android 11 x86, que traduz apps ARM de 32 bits.
const { execFileSync } = require('child_process');
const path = require('path');

const [apk, ...abis] = process.argv.slice(2);
if (!apk || !abis.length) {
  console.error('uso: node scripts/test-android-boot.js <apk> <abi> [abi...]');
  process.exit(2);
}
const ADB = process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PKG = 'com.lucasyemz.iptvkz.beta';
const DEVTOOLS_PORT = 9339;

async function page(expr) {
  const pages = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`)).json();
  const target = pages.find((p) => p.type === 'page' && /127\.0\.0\.1/.test(p.url));
  if (!target) return null;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  const value = await new Promise((ok) => {
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id === 1) ok(d.result && d.result.result ? d.result.result.value : null);
    };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
  });
  ws.close();
  return value;
}

const STATE = `(() => {
  const s = document.getElementById('splash');
  return {
    splash: !!s && !s.classList.contains('out'),
    terms: !!document.querySelector('.modal-back.show'),
    msg: ((s && s.querySelector('.sp-msg')) || {}).textContent || '',
    chrome: (/Chrome\\/(\\d+)/.exec(navigator.userAgent) || [])[1],
  };
})()`;

async function boot(abi) {
  const supported = adb('shell', 'getprop', 'ro.product.cpu.abilist').split(',');
  if (!supported.includes(abi)) throw new Error(`o emulador não roda ${abi} (tem ${supported.join(', ')})`);
  try { adb('uninstall', PKG); } catch {}
  adb('install', '--abi', abi, apk);
  const cpu = (adb('shell', 'dumpsys', 'package', PKG).match(/primaryCpuAbi=(\S+)/) || [])[1];
  if (cpu !== abi) throw new Error(`instalou como ${cpu}, não ${abi}`);
  adb('logcat', '-c');
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');

  const end = Date.now() + 150000;
  let last = null;
  while (Date.now() < end) {
    await sleep(3000);
    const crash = adb('logcat', '-d', '-s', 'AndroidRuntime:E', 'IPTVKZ:E');
    if (/FATAL EXCEPTION|Falha ao iniciar|Node encerrou/.test(crash)) throw new Error('o app caiu:\n' + crash.slice(-1500));
    const pid = adb('shell', 'pidof', PKG).split(/\s+/)[0];
    if (!pid) continue;
    if (!adb('shell', 'cat', '/proc/net/unix').includes(`webview_devtools_remote_${pid}`)) continue;
    try { adb('forward', '--remove', `tcp:${DEVTOOLS_PORT}`); } catch {}
    adb('forward', `tcp:${DEVTOOLS_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
    last = await page(STATE).catch(() => null);
    if (last && (last.terms || !last.splash)) {
      console.log(`ok   ${abi}: abriu (Chrome ${last.chrome}${last.terms ? ', termos na tela' : ''})`);
      return;
    }
  }
  throw new Error('não saiu da abertura em 150 s' + (last ? `: ${JSON.stringify(last)}` : ' (a página nem carregou)'));
}

(async () => {
  let failed = 0;
  for (const abi of abis) {
    try {
      await boot(abi);
    } catch (e) {
      failed++;
      console.log(`FALHOU ${abi}: ${e.message}`);
    }
  }
  try { adb('uninstall', PKG); } catch {}
  process.exit(failed ? 1 : 0);
})();
