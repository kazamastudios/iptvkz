# Publicar o IPTVKZ na LG Content Store

Guia para gerar, testar e enviar o app da LG pelo **LG Seller Lounge**, com a marca **Kazama Studios**, de graça.

A auditoria técnica, com fontes e prioridades, está em [WEBOS_CERTIFICATION_AUDIT.md](WEBOS_CERTIFICATION_AUDIT.md).

Nada aqui publica sozinho. O envio é sempre manual, pela conta do Seller Lounge.

## Os dois canais

| | Developer | Store |
|---|---|---|
| Comando | `npm run ipk` | `npm run ipk:store` |
| Saída | `dist/webos/` | `dist/webos/store/` |
| Id do app | `com.lucasyemz.iptvkz` | `com.kazamastudios.iptvkz` (definitivo) |
| Fornecedor | lucasyemz | Kazama Studios (troca com `WEBOS_STORE_VENDOR`) |
| Instalação | `ares-install`, com o Modo Desenvolvedor ligado | LG Content Store |
| Atualização | Pacote assinado do GitHub Releases, só com `BUNDLE_VERSION` (CI). O IPK feito no PC não se atualiza. | Só por um IPK novo, aprovado pela LG. O código de atualização nem entra no pacote. |
| Pasta de dados | `$HOME/iptvkz`, a pasta do serviço ou `/media/developer/temp` (como sempre) | `/media/internal/<id>`, depois `$HOME/iptvkz` |
| Recursos | Todos | Todos, inclusive o cadastro pelo celular por QR Code |

Os dois saem do mesmo código: `src/server`, `src/web` e `platforms/webos`. Só mudam as constantes do build. Por terem ids diferentes, podem ficar instalados juntos na mesma TV.

Opção dos dois canais: `WEBOS_LAN_PAIRING=0` deixa o servidor só em 127.0.0.1, sem o cadastro pelo celular. Use se o QA da LG recusar a porta aberta para a rede de casa.

### Gerar

```bash
npm ci
```

```bash
npm run build
```

```bash
npm test
```

```bash
npm run ipk:store
```

O build confere o pacote antes de empacotar (`scripts/check-webos.js`) e para com erro se algo estiver errado:

- campos obrigatórios e formato da versão;
- ícones de 80×80 e 130×130;
- `requiredACG` com `activity.operation`;
- nomes do serviço, e se a abertura chama o serviço certo;
- tecla Voltar;
- e, na Store, a ausência de qualquer código de atualização ou de `/media/developer`.

A versão do app vem do `version` do `package.json`. A LG não aceita reenviar um número que já foi enviado: suba a versão antes de cada envio.

No GitHub, cada pull request gera o artefato **IPTVKZ-webOS-Store** com o IPK da Store. Ele não vai para a Release.

### Instalar o IPK da Store na sua TV para testar

Com o Modo Desenvolvedor ligado, no terminal:

```bash
npx ares-install --device lg dist/webos/store/com.kazamastudios.iptvkz_1.0.5_all.ipk
```

O app aparece como um segundo IPTVKZ, com as próprias listas, e não mexe no Developer.

Atenção: com o Modo Desenvolvedor ligado, a TV pode não aplicar o ACG como uma TV comum. O teste definitivo é o QA da LG.

## Antes de enviar: decisões e itens pendentes

1. **Id do app:** `com.kazamastudios.iptvkz`, decidido (igual ao da Google Play). Depois do primeiro envio, não muda mais. Não use `WEBOS_STORE_ID` nos builds de envio.
2. **Versões do webOS.** Marque só **webOS TV 5.0 ou mais novo**. O serviço precisa de Node 8 ou mais novo, e o webOS 4.x tem Node 0.12.
3. **Política de privacidade pública.** Publicada em https://iptvkz.kazamastudios.com.br/privacidade.html (termos em `/termos.html`). Use esse endereço no cadastro.
4. **Ícone de 400×400 para a loja**, a partir de `assets/brand/icon-1024.png`, e capturas de tela (veja abaixo).
5. **Botões só de ícone no modo TV:** ajuste os que ficam abaixo de 75×75 px (auditoria, item 15).
6. **Conta de vendedor** no Seller Lounge em nome de Kazama Studios, pessoa física ou jurídica, conforme o cadastro da LG.

## Passo a passo no LG Seller Lounge

1. Entre em https://seller.lgappstv.com com a conta da Kazama Studios e complete o cadastro de vendedor.
2. **Apps → Register App:**
   - informe o **App ID** (o mesmo do `appinfo.json`), o nome "IPTVKZ" e o tipo **web app**;
   - escolha **Free**;
   - selecione os países onde o app vai aparecer.
3. **Plataforma:** webOS TV, só as versões 5.0 ou mais novas.
4. **Informações do app (App info):**
   - **Categoria:** Entertainment ou Video.
   - **Descrição:** use o texto abaixo, em português e em inglês se for publicar fora do Brasil.
   - **Ícone de 400×400** e **capturas de 1920×1080** (veja "Capturas de tela").
   - **Política de privacidade:** o endereço público.
   - **Classificação etária:** responda o questionário (veja "Classificação").
   - **Contato de suporte:** um e-mail da Kazama Studios, não o pessoal.
5. **Pacote:** envie `dist/webos/store/com.kazamastudios.iptvkz_<versão>_all.ipk`. A LG confere a assinatura e os metadados. Se recusar por falta de `requiredACG`, o build está desatualizado.
6. **Self Checklist:** preencha com base na seção "App Self Checklist" abaixo e anexe o **UX Scenario** (fluxo das telas, abaixo).
7. **Notas para o testador:** cole o texto de "Instruções para os testadores da LG", com a lista de teste.
8. Envie para o QA e acompanhe o status. Em caso de reprovação, corrija, suba a versão no `package.json`, gere de novo e reenvie.

## Descrição sugerida

> **IPTVKZ** é um player gratuito para listas IPTV que você já tem. Adicione sua lista M3U/M3U8 ou sua conta Xtream Codes e assista a canais ao vivo, filmes e séries com guia de programação (XMLTV), favoritos, histórico, "continuar assistindo" e controle dos pais com PIN.
>
> Cadastre a lista pelo celular, escaneando um QR Code na TV: os dados vão direto do celular para a TV, pela rede de casa.
>
> O IPTVKZ **não fornece nenhum conteúdo**. Não inclui listas, canais, filmes nem séries, e não tem relação com nenhum provedor. Use apenas conteúdo que você tem direito de acessar.
>
> Sem anúncios, sem conta e sem coleta de dados.

Em inglês:

> **IPTVKZ** is a free player for IPTV playlists you already own. Add your M3U/M3U8 playlist or Xtream Codes account and watch live channels, movies and series with a program guide (XMLTV), favorites, history, resume playback and a parental PIN. Add playlists from your phone by scanning a QR code on the TV; the data goes straight to the TV over your home network.
>
> IPTVKZ **does not provide any content**: no playlists, channels, movies or series are included, and it is not affiliated with any provider. Only use content you are entitled to access. No ads, no account, no data collection.

## Política de privacidade (texto para a página pública)

A versão oficial está em https://iptvkz.kazamastudios.com.br/privacidade.html. Resumo, igual à seção 6 dos Termos, versão 4:

- O IPTVKZ não coleta, não envia e não vende dados pessoais.
- Não tem anúncios, contas, análise de uso nem relatórios de erro.
- Listas, senhas, favoritos, histórico e preferências ficam só na TV, na pasta do app.
- O app se conecta apenas a estes endereços:
  - os das listas, guias, imagens e vídeos cadastrados por quem usa;
  - os serviços públicos de teste de conexão do Google e da Microsoft, sem dados da conta;
  - o YouTube, só quando a pessoa pede um trailer.
- A versão da LG Content Store não procura atualizações fora da loja.
- O cadastro pelo celular funciona só dentro da rede de casa, com um código de uso único que vale 15 minutos.
- O arquivo de "Baixar lista" contém usuário e senha e fica com quem baixou.
- Contato: o e-mail de suporte da Kazama Studios.

## Classificação

O app não traz conteúdo próprio e tem controle dos pais (PIN para categorias adultas).

O que aparece depende só das listas de quem usa, e a LG testa o conteúdo "de acordo com a faixa etária". Por isso, a escolha mais segura contra reprovação é a faixa mais alta que o questionário permitir para players de mídia. Essa é uma recomendação, não uma regra confirmada da LG.

## Direitos e marcas

- **Código:** Licença MIT (`LICENSE`).
- **Marca e ícone:** da Kazama Studios / IPTVKZ (`assets/brand/`).
- **Bibliotecas de terceiros, todas com licença aberta e no pacote:** hls.js (Apache-2.0), mpegts.js (Apache-2.0) e qrcode-generator (MIT).
- **Capturas e material de divulgação:** não use canais, logotipos, filmes nem séries reais. Use os dados fictícios.

## Capturas de tela

A LG pede imagens de 1920×1080 do app rodando.

Faça com **dados 100% fictícios**: lista M3U, guia, pôsteres e vídeos gerados, servidos de 127.0.0.1. É o mesmo método das capturas do README, em `docs/screenshots/`.

Telas sugeridas:

1. Ao vivo com o guia.
2. Filmes.
3. Detalhe de uma série.
4. Player com controles.
5. Adicionar lista com o QR Code.
6. Configurações.

Não mostre nomes ou logotipos de canais reais.

## Instruções para os testadores da LG

Texto para o campo de notas ao QA, em inglês:

> IPTVKZ is a media player only; it ships with no content. To test playback, add this test playlist on the first screen:
> **Add playlist → M3U link →** `https://iptvkz.kazamastudios.com.br/teste/lista.m3u`
> The test playlist contains only freely licensed or public test streams (e.g. Blender Foundation open movies under CC-BY, and public HLS test streams), plus a sample XMLTV guide.
>
> Navigation: arrows move the focus, OK selects, Back goes to the previous screen; on the home screen Back asks to exit. The Magic Remote pointer works on every screen. The phone QR-code flow is optional and needs a phone on the same Wi-Fi.
>
> Parental PIN for the test: none is set by default; Settings → Parental control lets you create one.

Monte a lista de teste antes de enviar. Inclua só streams de licença livre ou de teste público: canais HLS, alguns "filmes" e uma "série" em MP4 e um guia XMLTV. Hospede onde a Kazama Studios controla, por exemplo no GitHub Pages. **Nunca** use uma lista de provedor real.

## UX Scenario (fluxo das telas)

1. **Abertura:** logo e barra de progresso, "Carregando". Voltar sai do app.
2. **Termos de uso:** aceite obrigatório na primeira vez. "Recusar" explica e oferece sair.
3. **Boas-vindas / Adicionar lista:**
   - Xtream (servidor, usuário e senha), link M3U ou "Carregar lista";
   - QR Code para fazer pelo celular;
   - teclado do sistema com voz, ou o teclado do app.
4. **Início:** barra lateral com Ao vivo, Filmes, Séries, Guia, Busca, Favoritos, Histórico, Minha lista e Configurações.
5. **Ao vivo:** categorias, lista de canais e prévia. OK abre em tela cheia. As setas trocam de canal, e o guia aparece por cima.
6. **Filmes / Séries:** prateleiras de pôsteres, detalhe, temporadas e episódios, "continuar assistindo".
7. **Player:** play/pausa, avançar/voltar, legendas e áudio, próximo episódio. Voltar fecha o player.
8. **Configurações:** listas, controle dos pais, modo TV, sobre, sair do aplicativo.
9. **Sair:** Voltar na tela inicial abre "Sair do IPTVKZ?". "Sair" fecha o app, e o serviço encerra sozinho até 15 minutos depois.

## App Self Checklist (respostas esperadas)

| Item | Situação |
|---|---|
| Voltar em todas as telas | Volta um nível. Na tela inicial, abre o aviso de saída. Na abertura, `platformBack()`. |
| Sair e voltar à tela inicial da TV | Pelo aviso de saída ou por Configurações → Sair. |
| Navegação por setas e OK | Em todas as telas, com foco visível (anel vermelho). |
| Ponteiro do Magic Remote | Funciona em todas as telas. Pendente: área mínima de 75×75 px nos botões só de ícone. |
| Teclado virtual | Teclado do sistema (com voz) ao apertar OK num campo. Se ele não abrir, o teclado do app. |
| Resolução | 1920×1080. A interface do modo TV fica cerca de 35% maior para ser lida do sofá. |
| Mensagens de erro | Em português e sem códigos técnicos: lista fora do ar, senha errada, sem internet, formato não suportado. |
| Desempenho | Só `transform` e `opacity` nas animações, carregamento sob demanda e catálogo comprimido. |
| Privacidade | Nos Termos (seção 6), dentro do app, e no endereço público. |
| Conteúdo | Nenhum no app. |

## O que testar na TV de verdade antes de enviar

Instale o IPK da Store e confira:

1. **Primeira abertura:** a abertura vai para os Termos. No `boot.log` (pela inspeção, em `/media/internal/com.kazamastudios.iptvkz/boot.log` ou na pasta que ele indicar), a pasta de dados **não** pode ser `/tmp`.
2. **ACG:** nenhum "Denied method call" no registro. O vídeo não para depois de 5 a 10 minutos.
3. **Voltar:**
   - na abertura, quando ela falha (desligue a internet e a rede antes de abrir);
   - em cada tela;
   - na tela inicial, o aviso de saída.
4. **Sair:** sair pelo aviso e, 15 a 20 minutos depois, confirmar que o serviço encerrou: `ares-inspect` ou o registro mostra "encerrando o serviço".
5. **Segundo plano:**
   - aperte Home com um vídeo tocando e volte depois de 1 minuto;
   - depois, volte de novo após mais de 20 minutos;
   - a tela deve se recuperar sozinha (`lifeline.js`).
6. **Reiniciar a TV:** listas, favoritos e progresso continuam.
7. **Sem internet:** o app abre e mostra que está sem conexão.
8. **Cadastro pelo celular:** QR Code, enviar uma lista e "Baixar lista".
9. **Ponteiro:** passe por todas as telas só com o Magic Remote e anote os botões difíceis de acertar.
10. **Reprodução longa:** 2 horas ao vivo, medindo memória e CPU do serviço pela inspeção. A memória não pode subir sem parar.
11. **Teclado:** campos de servidor, usuário e senha, com o teclado do sistema e por voz.
