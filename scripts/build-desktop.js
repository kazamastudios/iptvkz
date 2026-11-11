// Gera o app de computador em dist/desktop/. Uso: node scripts/build-desktop.js --win|--mac|--linux [--publish ...]
// Só a versão publicada (tag v* no CI) se chama IPTVKZ. Qualquer outro build (no PC ou de um PR) é o app de
// testes "IPTVKZ Beta": outro id e outro nome, instalado ao lado do oficial e com os próprios dados.
const path = require('path');
const { execFileSync } = require('child_process');
const { writeBuildInfo, buildInfo } = require('./build-info');

const root = path.join(__dirname, '..');
writeBuildInfo(path.join(root, 'src', 'web'));
const beta = buildInfo().channel !== 'producao';
const args = process.argv.slice(2);
if (beta) {
  args.push(
    '-c.productName=IPTVKZ Beta',
    '-c.appId=com.lucasyemz.iptvkz.beta',
    '-c.artifactName=IPTVKZ-Beta-${version}-${os}-${arch}.${ext}',
    '-c.nsis.shortcutName=IPTVKZ Beta',
    '-c.nsis.artifactName=IPTVKZ-Beta-${version}-windows-setup.${ext}',
    '-c.portable.artifactName=IPTVKZ-Beta-${version}-windows-portable.${ext}',
  );
}
// pelo Node, sem shell: no Windows o .cmd quebraria "IPTVKZ Beta" em dois argumentos
const cli = require.resolve('electron-builder/cli.js', { paths: [root] });
execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit', cwd: root });
