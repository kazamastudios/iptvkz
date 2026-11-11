# Spec da landing page do IPTVKZ

Status: versão 3, implementada em `public/`. Substitui o conteúdo de `public/`, mantendo a pasta, o domínio (`iptvkz.kazamastudios.com.br`) e o deploy sem build no Cloudflare Pages.

**Referência:** a estrutura de [IPTVnator](https://4gray.github.io/iptvnator/). Seguimos a ordem das seções, a simplicidade e o download detectado. Textos, imagens, cores e código são do IPTVKZ, sem copiar nada de lá.

## 1. Objetivo

Em poucos segundos, quem chega precisa saber o que é, ver que é grátis e baixar a versão certa. A promessa: **você já paga pela lista, então pare de pagar pelo player.** Gratuidade primeiro, depois QR Code, visualizações e leveza.

## 2. Estrutura

| # | Seção | O que tem |
|---|---|---|
| 1 | Barra do topo | Logo, Recursos, Telas, Baixar e botão "Baixar grátis" |
| 2 | Topo | Título, texto, download recomendado e print com o botão Clássica/Streaming |
| 3 | Promessas | Três frases curtas, separadas por linhas finas |
| 4 | Recursos | Grade de cartões de tamanhos diferentes, com o QR Code como cartão maior |
| 5 | Onde roda | Uma linha com os seis sistemas |
| 6 | Telas | Lista de telas à esquerda, print grande à direita |
| 7 | Baixar | Recomendado em destaque, demais aparelhos recolhidos |
| 8 | Ajude a melhorar | Único bloco com chamada para o GitHub: sugestões, problemas e estrela |
| 9 | Dúvidas e rodapé | Até cinco perguntas, aviso legal, termos e privacidade |

Não entram agora: blog, comparativo com outros apps e doações.

### 2.1 Topo

- **Linha acima do título, em texto simples:** "Grátis · Sem anúncio · Sem cadastro".
- **Título, em três linhas:** "O player IPTV / **que não cobra** / para ser bom.", com a linha do meio em vermelho.
- **Texto:** player completo para listas M3U e Xtream, com QR Code, visual de streaming, guia, filmes e séries, de graça.
- **Botões:** principal detectado, como "Baixar grátis para Windows", e "Outros aparelhos".
- **Print:** tela real ao lado do texto, com o botão de visualização funcionando de verdade. Alterna a imagem entre Clássica e Streaming, como no app.
- **Legenda do print:** "Filmes fictícios. O IPTVKZ é só o player: a lista é sua."

### 2.2 Promessas

Três frases curtas logo abaixo do topo, sem números soltos: grátis de verdade, lista por QR Code e feito para não travar. Licença, estrelas e GitHub ficam no bloco "Ajude a melhorar" e no rodapé.

**Regras de texto:** não citar concorrentes nem preços deles, não dizer "o melhor" sem prova, não prometer gratuidade "para sempre" e sempre falar em app pago de player, nunca em conteúdo grátis.

### 2.3 Recursos

Cartões com recortes de prints reais, em tamanhos variados:

| Cartão | Tamanho | Texto central |
|---|---|---|
| QR Code | Grande | "Escaneie, preencha no celular, pronto." Um link de lista são cerca de 445 cliques no controle. O celular fala direto com a TV pela sua rede, e o código vale 15 minutos e só uma vez. |
| Clássica ou Streaming | Grande | Grade de sempre ou destaque com fileiras, com um toque ao lado da busca. |
| TV ao vivo e guia | Médio | Zapeie em tela cheia e veja o que passa agora. |
| Continuar assistindo | Médio | Volte do minuto em que parou. |
| Dublado e legendado | Pequeno | As duas versões viram um cartão só. |
| Controle dos pais | Pequeno | PIN que esconde o conteúdo adulto. |
| Backup da lista | Pequeno | Leve lista, favoritos e histórico para outro aparelho. |
| Leve até em TV antiga | Pequeno | LG com webOS 4 ou mais novo, sem computador ligado. |

Fechando a seção, uma faixa: **"Tudo isso de graça. Sem plano premium, sem anúncio, sem recurso bloqueado."** Não citamos concorrentes nem preços deles.

### 2.4 Baixar

O visitante vê um cartão principal, com a etiqueta **"Recomendado para você"**, o nome do aparelho, o arquivo, o tamanho e o botão. Abaixo, "Outros aparelhos" abre a lista completa.

| Quem visita pelo | Recomendado |
|---|---|
| Windows | Instalador (portátil na lista completa) |
| macOS | Apple Silicon e Intel, lado a lado, porque o navegador não informa com segurança |
| Linux | AppImage (.deb na lista completa) |
| Celular Android | APK |
| TV LG | Explica a instalação pelo computador |
| Android TV | APK, com o endereço curto do site para digitar no Downloader |
| iPhone ou desconhecido | Lista completa aberta |

- O download nunca começa sozinho. Links e tamanhos vêm da API de releases do GitHub, com os do HTML como reserva.
- **LG:** deixar claro que hoje exige Developer Mode, conta LG Developer e renovação da sessão, até a loja aprovar.
- **Aviso contra golpe, curto, logo abaixo:** "O IPTVKZ é grátis. Se alguém te vendeu, é golpe."

## 3. Visual

- **Fundo e cores:** variáveis de `src/web/css/app.css`. O vermelho `--accent` entra no botão principal, na palavra de destaque e no foco.
- **Fonte:** uma só, arquivo latino reduzido em `public/fonts/`. Etiquetas e números pequenos em monoespaçada do sistema.
- **Formas:** cartões chapados com borda fina, como no app. Sem brilho, partículas ou inclinação 3D.
- **Imagens:** só prints reais de `Downloads\iptvkz-prints`, convertidos para WebP. Saem `images/mockups/` e as capturas antigas com capas em degradê.

## 4. Uma página, três aparelhos

| Elemento | PC (mouse) | TV (controle) | Celular (toque) |
|---|---|---|---|
| Botões e cartões | Hover | Moldura vermelha segue as setas, OK ativa | Toque |
| Clássica/Streaming | Clique | Setas e OK | Toque |
| Telas | Passa sozinho e pausa no hover | Passa sozinho e pausa com foco | Carrossel de arrastar |
| Outros aparelhos | Clique abre | OK abre | Toque abre |

Na TV, corpo de texto de pelo menos 24 px em 1920x1080.

## 5. Limites técnicos

- Sai o Three.js (676 KB). GSAP e ScrollTrigger (116 KB sem compressão) só carregam fora da TV, depois da página, para fade in, fade out e rolagem suave. Na TV, o equivalente é a moldura deslizante e a troca suave de telas.
- JavaScript próprio de até 15 KB comprimido e primeira carga de até 300 KB, sem contar o GSAP, que não bloqueia a página.
- Animar só `transform` e `opacity`, um elemento por vez, nada fora da tela, e respeitar "reduzir movimento".
- Compatível com Chromium 53 (webOS 4): sem `aspect-ratio`, `gap` em flex, `:has`, `?.` ou `??`.
- Sem JavaScript, todo o conteúdo aparece e o download leva às releases.
- Sem rastreamento e sem cookies. Nada de `src/`, sem build.

## 6. Pronto quando

- [ ] O botão principal mostra o arquivo certo em Windows, macOS, Linux e Android, e nunca baixa sozinho.
- [ ] O botão Clássica/Streaming funciona com mouse, controle e toque.
- [ ] A página inteira funciona só com setas e OK.
- [ ] Nenhum 404, erro de JavaScript ou rolagem horizontal em 390, 1280 e 1920 px.
- [ ] Limites da seção 5 medidos e anotados no PR.
- [ ] Testada em uma LG ou Android TV real.
- [ ] Nada citado como disponível sem estar em uma release publicada.

## 7. Dependência

A Visualização Streaming é destaque da página, mas só existe no PR #13. A landing deve entrar no ar junto com uma versão publicada que inclua esse recurso, com o bug do celular deitado corrigido.
