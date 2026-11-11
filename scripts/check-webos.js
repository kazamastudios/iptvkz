// Confere o app da LG antes de empacotar (chamado por build-ipk.js). Para o build com erro se algo
// que a LG exige estiver faltando ou se o canal Store levar código de atualização automática.
// Regras: webostv.developer.lge.com (appinfo.json, ACG guide, JS service, App Self Checklist).
const fs = require('fs');
const path = require('path');

const RESERVED = /^(com\.palm|com\.webos|com\.lge|com\.palmdts)(\.|$)/;
const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

function check({ appDir, serviceDir, channel, appId, serviceId }) {
  const errors = [];
  const warnings = [];
  const need = (ok, text) => { if (!ok) errors.push(text); };
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

  // ---------- appinfo.json ----------
  const info = read(path.join(appDir, 'appinfo.json'));
  for (const k of ['id', 'title', 'type', 'main', 'icon', 'version']) need(info[k], `appinfo.json sem "${k}"`);
  need(info.id === appId, `appinfo.json: id ${info.id}, esperado ${appId}`);
  need(/^[a-z0-9][a-z0-9.-]+$/.test(info.id) && !RESERVED.test(info.id), `appinfo.json: id inválido ou reservado (${info.id})`);
  need(VERSION.test(info.version), `appinfo.json: versão deve ser x.y.z sem zeros à esquerda (${info.version})`);
  need(info.type === 'web', 'appinfo.json: type deve ser "web"');
  need(fs.existsSync(path.join(appDir, info.main)), `appinfo.json: main ${info.main} não existe`);
  const icons = { icon: [80, 80], largeIcon: [130, 130] };
  for (const [k, want] of Object.entries(icons)) {
    const file = info[k] && path.join(appDir, info[k]);
    const size = file && fs.existsSync(file) ? pngSize(file) : null;
    need(size && size[0] === want[0] && size[1] === want[1], `appinfo.json: ${k} deve ser PNG ${want.join('x')} (${size ? size.join('x') : 'ausente'})`);
  }
  need(['1920x1080', '1280x720'].includes(info.resolution), 'appinfo.json: resolution deve ser 1920x1080 ou 1280x720');
  need(info.disableBackHistoryAPI === true, 'appinfo.json: o app trata o Voltar sozinho (disableBackHistoryAPI: true)');
  if (info.appDescription) need(info.appDescription.length <= 60, 'appinfo.json: appDescription passa de 60 caracteres');
  // webOS TV 27+: requiredACG é obrigatório. O serviço usa o Activity Manager (activity.operation).
  need(Array.isArray(info.requiredACG), 'appinfo.json: requiredACG ausente (obrigatório no webOS TV 27+)');
  need((info.requiredACG || []).includes('activity.operation'), 'appinfo.json: requiredACG precisa de "activity.operation" (activityManager.create)');
  if (channel === 'store') need(info.vendor && info.vendor !== 'lucasyemz', 'appinfo.json: vendor da Store deve ser a marca (Kazama Studios)');

  // ---------- serviço ----------
  const services = read(path.join(serviceDir, 'services.json'));
  need(services.id === serviceId, `services.json: id ${services.id}, esperado ${serviceId}`);
  need(serviceId.indexOf(appId + '.') === 0, 'serviço: o nome precisa começar com o id do app');
  need(!/-/.test(serviceId) && !/\.\d/.test(serviceId), 'serviço: nome sem "-" e sem "." seguido de número');
  need((services.services || []).length && services.services.every((s) => s.name === serviceId), 'services.json: services[].name diferente do id');
  const pkg = read(path.join(serviceDir, 'package.json'));
  need(pkg.name === serviceId, 'service/package.json: name diferente do id do serviço');
  need(fs.existsSync(path.join(serviceDir, pkg.main || 'main.js')), 'service/package.json: main não existe');
  need(fs.existsSync(path.join(serviceDir, 'app', 'server.js')), 'serviço sem app/server.js');
  need(fs.existsSync(path.join(serviceDir, 'app', 'web', 'index.html')), 'serviço sem a interface (app/web/index.html)');

  // ---------- abertura ----------
  const splash = fs.readFileSync(path.join(appDir, info.main), 'utf8');
  need(splash.includes(`luna://${serviceId}/boot`), 'index.html não chama o serviço deste canal');
  need(/461/.test(splash), 'index.html sem tratamento da tecla Voltar (461)');

  // ---------- canal Store: nada de código vindo de fora ----------
  const main = fs.readFileSync(path.join(serviceDir, 'main.js'), 'utf8');
  if (channel === 'store') {
    need(!splash.includes('com.kazamastudios.iptvkz.dev'), 'Store: index.html ainda cita o id do Developer');
    for (const bad of ['webos-update.json', 'releases/latest', 'createVerify', 'gunzipSync', '/media/developer']) {
      need(!main.includes(bad), `Store: service/main.js contém "${bad}" (atualização automática ou caminho do Modo Desenvolvedor)`);
    }
  }

  // ---------- tamanho ----------
  const bytes = walk(appDir).concat(walk(serviceDir)).reduce((n, f) => n + fs.statSync(f).size, 0);
  if (bytes > 50 * 1024 * 1024) warnings.push(`pacote grande: ${(bytes / 1048576).toFixed(1)} MB`);

  warnings.forEach((w) => console.warn('aviso: ' + w));
  if (errors.length) {
    errors.forEach((e) => console.error('erro: ' + e));
    throw new Error(`Conferência do app da LG falhou (${errors.length} erro${errors.length > 1 ? 's' : ''}).`);
  }
  console.log(`Conferência ok (${channel}): ${appId} ${info.version}, ${(bytes / 1048576).toFixed(1)} MB sem compactar.`);
  return { bytes };
}

module.exports = { check };
