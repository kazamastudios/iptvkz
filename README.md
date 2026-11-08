<p align="center">
  <img src="assets/icon-1024.png" width="160" alt="IPTVKZ" />
</p>

<h1 align="center">IPTVKZ</h1>

<p align="center">Player IPTV pessoal para o computador e a TV — listas M3U e Xtream Codes, guia de programação, filmes, séries, áudio e legendas.</p>

---

> O IPTVKZ é **só um player**. Ele não vem com nenhuma lista, canal ou conteúdo: você usa as listas que você mesmo cadastrar. Use apenas conteúdo que você tem direito de assistir.

## Recursos

- **Listas:** link M3U/M3U8, arquivo `.m3u` ou conta **Xtream Codes** — várias listas com troca rápida, cache e atualização automática a cada 12h.
- **TV ao Vivo:** categorias, favoritos, recentes, busca, agora/a seguir do guia; ao assistir, lista lateral para zapear (↑/↓).
- **Filmes e Séries:** prateleiras, “Continuar assistindo”, temporadas/episódios, próximo episódio automático. Versões **Dublado/Legendado** do mesmo título viram um cartão só.
- **Guia (EPG):** XMLTV (inclusive `.gz`) em grade de horários, com ajuste de fuso por lista.
- **Player:** HLS (hls.js), MPEG-TS (mpegts.js) e nativo; troca de **áudio**, **legendas** (do stream ou arquivo `.srt`/`.vtt`, com atraso, tamanho e fundo), qualidade, picture-in-picture e **“Abrir no VLC”** para formatos que o navegador não toca.
- **Modo TV:** use pelo navegador da Smart TV (testado para LG webOS) com o PC como servidor — navegação pelas setas/OK/Voltar do controle e zapping em tela cheia. Versão compatível com TVs antigas (webOS 4+).
- **Busca global**, categorias ocultáveis/reordenáveis, tudo em PT-BR.

## Como rodar

Requisitos: [Node.js](https://nodejs.org) 18 ou mais novo. No Windows, o VLC é opcional.

```bash
git clone https://github.com/lucasyemz/iptvkz.git
cd iptvkz
npm start
```

Abra `http://localhost:8787` e adicione sua lista.

**Windows:** para ter um atalho na área de trabalho que abre o app numa janela própria:

```bash
powershell -ExecutionPolicy Bypass -File scripts/criar-atalho.ps1
```

### Assistir na TV

1. No computador: **Configurações → TV e outros aparelhos → Permitir acesso pela rede de casa**.
2. Se o Windows perguntar, permita o Node.js em **Redes privadas**.
3. No navegador da TV, abra o endereço mostrado (ex.: `http://192.168.1.10:8787`).

O computador precisa ficar ligado. A opção **Iniciar com o Windows** sobe o servidor sozinho, sem abrir janela.

## Como funciona

```
public/        interface (HTML/CSS/JS sem framework)
  js/app.legacy.js   versão para TVs antigas (gerada por `npm run build`)
lib/           catálogo (M3U/Xtream), guia (XMLTV), dados, rede
server.js      servidor local: interface, API, proxy de streams
launcher/      atalho do Windows (sobe o servidor e abre o Chrome em modo app)
data/          suas listas e preferências (fica só no seu computador, fora do Git)
```

O servidor local faz proxy dos streams (resolve CORS e links `http`), normaliza as listas num catálogo único e processa o guia. Ele aceita só o próprio computador — e, se você ligar, aparelhos da sua rede de casa.

Depois de mexer em `public/js`, rode `npm install` (uma vez) e `npm run build` para atualizar a versão das TVs antigas.

## Licença

MIT
