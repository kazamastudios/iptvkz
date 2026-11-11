// Entrada do servidor dentro do app Android. Recebe a pasta privada do app em argv[2].
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = process.argv[2];
process.env.IPTVKZ_DATA = path.join(base, 'data');
process.env.IPTVKZ_KEEPALIVE = '1';

// O Android 11+ bloqueia a listagem de interfaces de rede, e aqui ela não é necessária.
const listInterfaces = os.networkInterfaces;
os.networkInterfaces = () => { try { return listInterfaces(); } catch { return {}; } };
const hostname = os.hostname;
os.hostname = () => { try { return hostname(); } catch { return 'Android TV'; } };

// O app Beta (build no PC) fica instalado ao lado do oficial: com a mesma porta, o oficial parado em segundo
// plano pelo Android ainda segura a 8787 e a interface do Beta não abre.
const beta = /\.beta$/.test(path.basename(path.dirname(base)));

require('./src/server/index.js')
  .start({ host: '0.0.0.0', port: beta ? 8797 : 8787, portFallback: true, keepAlive: true, pairing: true })
  .then(({ port }) => {
    const target = path.join(base, 'port');
    fs.writeFileSync(target + '.tmp', String(port));
    fs.renameSync(target + '.tmp', target);
    console.log('IPTVKZ na porta ' + port);
  }, (err) => { console.error(err); process.exit(1); });
