// Gera build-info.json junto com a interface: versão, número da build, modo, commit e data.
// O app mostra isso em Configurações → Sobre e no rodapé do menu.
// Modo: "producao" só nas builds de uma tag v* no CI (a versão publicada); qualquer outra (PR, build local)
// é "desenvolvimento". Rodando direto pelo código não há arquivo, e o servidor informa "desenvolvimento".
// Uso: node scripts/build-info.js [pasta]   (padrão: src/web, para os instaladores de PC)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

// channel: força o modo (o IPK da Store é sempre a versão de produção, mesmo gerado no PC).
function buildInfo({ build, channel } = {}) {
  const { version } = require(path.join(root, 'package.json'));
  let commit = (process.env.GITHUB_SHA || '').slice(0, 7);
  if (!commit) {
    try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim(); } catch {}
  }
  const n = Number(build ?? process.env.BUNDLE_VERSION ?? process.env.GITHUB_RUN_NUMBER);
  return {
    version,
    build: n > 0 ? n : null,
    channel: channel || ((process.env.GITHUB_REF || '').startsWith('refs/tags/v') ? 'producao' : 'desenvolvimento'),
    commit: commit || null,
    date: new Date().toISOString(),
  };
}

function writeBuildInfo(dir, opts) {
  fs.writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify(buildInfo(opts), null, 2));
}

module.exports = { buildInfo, writeBuildInfo };

if (require.main === module) writeBuildInfo(path.resolve(process.argv[2] || path.join(root, 'src', 'web')));
