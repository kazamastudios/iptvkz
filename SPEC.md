# IPTVKZ — Spec v1.0

Player IPTV pessoal que roda no PC (janela de app do Chrome), alimentado pelas listas que o próprio usuário cadastra. O app não fornece, busca nem embute nenhuma lista.

## 1. Escopo da v1

**Dentro:** listas M3U/M3U8 (link ou arquivo) e Xtream Codes; TV ao Vivo, Filmes, Séries, Guia (EPG); várias listas com troca rápida; áudio e legenda; "Abrir no VLC".

**Fora:** conversão com ffmpeg (planejada pra v2), gravação, multi-tela, Chromecast, PIN/controle parental, outros idiomas além de PT-BR.

## 2. Arquitetura

- **Servidor Node local** (`server.js` + `lib/`, sem dependências), só em `127.0.0.1:8787`:
  - serve a interface (`public/`);
  - `/proxy?url=`: repassa playlists e streams (CORS, links `http`, `Range`) e reescreve manifestos HLS;
  - `/api/state/*`: guarda os dados em `data/*.json`;
  - `/api/catalog`: baixa e normaliza a lista (M3U ou Xtream) em um catálogo único, com cache em `data/`;
  - `/api/epg`: baixa e processa o XMLTV (inclusive `.gz`), guarda de −6h a +24h e responde só os canais pedidos;
  - `/api/vlc`: abre o VLC instalado tocando a URL;
  - desliga sozinho após **5 min** sem a janela aberta (heartbeat).
- **Front-end:** HTML/CSS/JS (módulos ES) sem build. Players: `hls.js`, `mpegts.js` e `<video>` nativo.
- **Abrir:** atalho "IPTVKZ" na área de trabalho → `launcher/start.vbs` sobe o servidor escondido (se ainda não estiver no ar) e abre o **Chrome em modo app** (`--app`).

## 3. Dados (`data/`)

| Arquivo | Conteúdo |
|---|---|
| `lists.json` | listas: id, nome, tipo, URL ou arquivo, servidor/usuário/senha Xtream (texto puro, local), URL do EPG, ajuste de fuso |
| `settings.json` | lista ativa, preferências de áudio/legenda, próximo episódio automático |
| `favorites.json`, `recents.json`, `progress.json` | por lista |
| `catPrefs.json` | categorias ocultas e ordem, por lista e seção |
| `catalog-<id>.json`, `epg-<id>.json`, `m3u-<id>.m3u` | caches |

## 4. Visual

Tema escuro estilo streaming, destaque **vermelho `#FF2A2A`** (da logo), capas grandes, cantos arredondados. Barra lateral (logo, seletor de lista, seções) + conteúdo com busca global no topo.

## 5. Listas
- Formulário com abas **Link M3U / Arquivo M3U / Xtream**, mais o campo opcional **URL do EPG** e o **ajuste do guia (±h)**.
- Abre do cache na hora. Se o cache tiver mais de **12h**, atualiza em segundo plano. Também tem o botão "Atualizar agora".
- Configurações: renomear, editar, atualizar, excluir, usar. Por lista e seção: **ocultar e reordenar categorias**.

## 6. TV ao Vivo
- Categorias (com filtro) + Todas / Favoritos / Recentes. Grade de canais com logo, nome e programa atual com barra de progresso. Busca local e ordenação (original, A–Z).
- Ao assistir: **vídeo grande + lista lateral** da categoria pra zapear, e embaixo o agora/próximo do EPG.
- Teclas: ↑/↓ troca de canal, `F` tela cheia, `M` mudo, `/` busca.
- Xtream: tenta **HLS (`.m3u8`)** primeiro e cai pro **`.ts`** se falhar.
- Renderização incremental (50 mil+ itens sem travar).

## 7. Filmes e Séries
- Prateleiras: Continuar assistindo, Favoritos e uma por categoria ("Ver tudo" abre a grade).
- **Versões juntas:** itens "Dublado/Legendado/Nacional/Dual" do mesmo título viram **um cartão**, com seletor de **Versão**.
- Detalhe: capa, sinopse, ano, nota, duração e gênero (via `get_vod_info` / `get_series_info` no Xtream).
- Séries: seletor de temporada, episódios com progresso e **próximo episódio automático** (contagem de 8s, dá pra desligar).
- M3U: séries agrupadas pelo nome (`S01E02`, `T01E02`, `1x02`).
- Player em **tela cheia na janela**, com o progresso salvo a cada 10s.

## 8. Player
- Motor escolhido pela URL: `.m3u8` → hls.js; `.ts` ou ao vivo sem extensão → mpegts.js; o resto → nativo.
- 3 tentativas automáticas → URL alternativa → erro claro + **"Abrir no VLC"** (que abre o VLC direto).
- Menu ⚙️:
  - **Áudio:** faixas do HLS. No MP4/MKV o navegador não permite trocar, então aparece o aviso + VLC.
  - **Legenda:** faixas do HLS, **arquivo .srt/.vtt** do PC (UTF-8 ou Windows-1252) ou desligada.
  - **Qualidade:** níveis do HLS.
  - Legenda: **atraso** (±0,5s), **tamanho** (P/M/G/GG), **fundo** (nenhum/sombra/caixa).
- Legendas desenhadas pelo próprio app (uma camada por cima do vídeo), o que permite estilo e atraso para qualquer fonte.
- Padrões: **áudio em português**, se houver. A legenda fica desligada quando o áudio é PT e entra em PT quando não é (configurável: automático/sempre/desligada).

## 9. Guia (EPG)
- Fonte: URL informada → `url-tvg` do M3U → `xmltv.php` do Xtream. Casamento por `tvg-id`, com fallback pelo nome.
- Grade: canais × horário, linha do "agora", de −3h a +21h. Programa em exibição → abre o canal, os outros mostram os detalhes.
- Ajuste de fuso por lista.

## 10. Busca global
Procura em canais, filmes e séries ao mesmo tempo, com os resultados em três blocos.

## 11. Critérios de pronto
- Lista pública (iptv-org) com ~10 mil canais carrega e rola sem travar.
- Toca HLS e `.ts` ao vivo. MP4 avança/volta. Troca de áudio/legenda funciona num HLS com várias faixas. Legenda .srt carrega e o atraso funciona.
- Xtream (testado com servidor simulado): ao vivo, filmes, séries e EPG.
- Favoritos, recentes, progresso e categorias ocultas sobrevivem a fechar o app.
- O atalho da área de trabalho abre o app numa janela própria.

## 12. Modo TV (v1.1): navegador da TV + PC como servidor
- **Acesso pela rede:** desligado por padrão. Liga em Configurações → *TV e outros aparelhos*, que mostra o endereço pra digitar na TV (`http://IP-do-PC:8787`). Só aceita aparelhos da rede privada. Pela rede, VLC, "Fechar" e "Iniciar com o Windows" ficam bloqueados. Com o acesso ligado, o servidor não desliga sozinho.
- **Iniciar com o Windows** (opcional, desligado): atalho na pasta Inicializar → `launcher/start.vbs /server` (sobe só o servidor, sem janela).
- **Modo TV** (por aparelho, liga sozinho em TVs; `?tv=1` / `?tv=0` força): interface ~35% maior e navegação espacial por ←↑→↓ + OK; Voltar = Back do controle LG (461) / Esc.
  - TV ao Vivo: canal em tela cheia; ▲▼/CH± troca de canal, ◀ abre a gaveta de canais, OK mostra o banner agora/a seguir.
  - Filmes/séries: OK pausa; ▼ leva aos botões do player (⚙️ áudio/legenda navegável); teclas de mídia funcionam.
- **TVs antigas (webOS 4+ / Chromium 53+):** `index.html` detecta o navegador e carrega `js/app.legacy.js` (gerado com `npm run build`, esbuild → chrome53 + polyfills) e o CSS tem fallbacks (sem `inset`, `aspect-ratio`, flex `gap`, `cqh`). **Rodar `npm run build` após mudar `public/js`.**

## 13. App de computador (v1.2): Electron
- `electron/main.js` roda o mesmo `server.js` dentro do app (porta 8787; se ocupada, a próxima livre) e abre a interface numa janela própria. Dados em `userData/data` (ex.: `%APPDATA%\iptvkz\data`).
- Com o acesso pela rede ligado, fechar a janela deixa o app na **bandeja** (Windows/Linux); “Iniciar com o sistema” usa o login item nativo e abre com `--background`.
- hls.js e mpegts.js ficam em `public/vendor` (sem CDN).
- Instaladores via electron-builder: Windows (NSIS + portátil), macOS (dmg x64/arm64), Linux (AppImage + deb), sem assinatura por enquanto.
- GitHub Actions (`.github/workflows/build.yml`): PR/manual → artefatos; tag `v*` → rascunho de Release.
