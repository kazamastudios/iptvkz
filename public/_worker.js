// IPTVKZ: recebe o formulário de suporte e abre um chamado no GitHub. Roda no Cloudflare Pages, no modo
// avançado (_worker.js), e entrega o restante do site sem mudanças. O segredo GITHUB_TOKEN fica só no
// painel do Cloudflare: token com acesso apenas a este repositório e permissão de escrita em Issues.
const REPO = 'kazamastudios/iptvkz';

const TIPOS = { erro: 'Algo deu errado', sugestao: 'Sugestão', duvida: 'Dúvida' };
const AREAS = {
  instalacao: 'Instalação do app', lista: 'Adicionar ou atualizar lista', qr: 'QR Code e celular', aovivo: 'TV ao vivo',
  guia: 'Guia de programação', filmes: 'Filmes', series: 'Séries', player: 'Player de vídeo',
  historico: 'Continuar assistindo e Histórico', favoritos: 'Favoritos e Minha lista', busca: 'Busca',
  config: 'Configurações', pais: 'Controle dos pais', backup: 'Baixar e carregar lista', site: 'Este site', outro: 'Outro',
};
const MOMENTOS = {
  abrir: 'Ao abrir o app', carregar: 'Ao carregar a lista', navegar: 'Ao navegar pelas telas', iniciar: 'Ao iniciar um vídeo',
  assistindo: 'Durante o vídeo', trocar: 'Ao trocar de canal ou episódio', salvar: 'Ao salvar uma configuração',
  instalar: 'Ao instalar ou atualizar', sempre: 'Acontece sempre', outro: 'Outro',
};
const APARELHOS = {
  lg: 'TV LG', atv: 'Android TV', android: 'Celular Android', win: 'Windows', mac: 'macOS', linux: 'Linux',
  browser: 'Pelo navegador', outro: 'Outro',
};

const LIMITE_POR_IP = 5;
const JANELA_MS = 10 * 60 * 1000;
const envios = new Map(); // só em memória, por alguns minutos: nunca é salvo nem publicado

function resposta(status, corpo) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function limitado(ip, agora) {
  for (const [chave, horas] of envios) {
    const validas = horas.filter((h) => agora - h < JANELA_MS);
    if (validas.length) envios.set(chave, validas); else envios.delete(chave);
  }
  const horas = envios.get(ip) || [];
  if (horas.length >= LIMITE_POR_IP) return true;
  horas.push(agora);
  envios.set(ip, horas);
  return false;
}

// O chamado é público: tira endereços e credenciais, e evita menções e formatação vindas do texto.
function limpar(valor, max) {
  return String(valor == null ? '' : valor)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[link removido]')
    .replace(/\b(?:www\.)\S+/gi, '[link removido]')
    .replace(/\b(username|usuario|usuário|user|password|senha|pass)\s*[=:]\s*\S+/gi, '$1: [removido]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[endereço removido]')
    .trim()
    .slice(0, max);
}
const linha = (valor, max) => limpar(valor, max).replace(/\s+/g, ' ').replace(/@/g, '@​').replace(/[`<>|]/g, '');
const bloco = (texto) => '```text\n' + texto.replace(/`{3,}/g, "'''") + '\n```';

function campo(mapa, chave, outro) {
  if (!Object.prototype.hasOwnProperty.call(mapa, chave)) return null;
  if (chave !== 'outro') return mapa[chave];
  const texto = linha(outro, 80);
  return texto ? 'Outro: ' + texto : null;
}

function mesmaOrigem(request) {
  try {
    return new URL(request.headers.get('origin') || '').host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function criarChamado(env, payload) {
  const enviar = (dados) => fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'iptvkz-site',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify(dados),
  });
  let r = await enviar(payload);
  // Sem permissão para etiquetas, o chamado ainda entra: o título e o texto trazem os mesmos dados.
  if (r.status === 403 || r.status === 422) {
    const semEtiquetas = { title: payload.title, body: payload.body };
    r = await enviar(semEtiquetas);
  }
  return r.ok;
}

async function relato(request, env) {
  if (request.method !== 'POST') return resposta(405, { erro: 'metodo' });
  if (!mesmaOrigem(request)) return resposta(403, { erro: 'origem' });
  if (!env.GITHUB_TOKEN) return resposta(503, { erro: 'indisponivel' });

  const bruto = await request.text();
  if (bruto.length > 8192) return resposta(413, { erro: 'tamanho' });
  let d;
  try {
    d = JSON.parse(bruto);
  } catch {
    return resposta(400, { erro: 'formato' });
  }
  if (!d || typeof d !== 'object') return resposta(400, { erro: 'formato' });

  // Armadilhas para robôs: resposta "ok" para não ensinar o que foi detectado.
  if (d.empresa || !(Number(d.tempo) >= 3000)) return resposta(200, { ok: true });

  const ip = request.headers.get('cf-connecting-ip') || 'sem-ip';
  if (limitado(ip, Date.now())) return resposta(429, { erro: 'limite' });

  const tipo = campo(TIPOS, d.tipo);
  const area = campo(AREAS, d.area, d.areaOutro);
  const momento = campo(MOMENTOS, d.momento, d.momentoOutro);
  const aparelho = campo(APARELHOS, d.aparelho, d.aparelhoOutro);
  const mensagem = limpar(d.mensagem, 3000);
  if (!tipo || !area || !momento || !aparelho || mensagem.length < 10) return resposta(400, { erro: 'campos' });

  const versao = linha(d.versao, 30);
  const resumo = linha(mensagem, 60);
  const title = `[${area.replace(/^Outro: /, '')}] ${tipo}: ${resumo}`.slice(0, 120);
  const body = [
    `**Tipo:** ${tipo}`,
    `**Onde:** ${area}`,
    `**Quando:** ${momento}`,
    `**Aparelho:** ${aparelho}`,
    `**Versão do app:** ${versao || 'não informada'}`,
    '',
    '**O que aconteceu**',
    bloco(mensagem),
    '',
    '_Enviado pelo formulário do site._',
  ].join('\n');
  const labels = ['suporte-site', `tipo:${d.tipo}`, `area:${d.area}`, `aparelho:${d.aparelho}`];

  let ok = false;
  try {
    ok = await criarChamado(env, { title, body, labels });
  } catch {
    ok = false;
  }
  return ok ? resposta(201, { ok: true }) : resposta(502, { erro: 'github' });
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/api/relato') return relato(request, env);
    return env.ASSETS.fetch(request);
  },
};
