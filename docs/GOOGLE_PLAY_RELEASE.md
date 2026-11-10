# Publicar o IPTVKZ na Google Play

Guia da primeira publicação na Google Play, sob a marca **Kazama Studios**, e das atualizações seguintes.
O que foi encontrado e corrigido para chegar aqui está em [`RELEASE_AUDIT.md`](RELEASE_AUDIT.md).

> Nada aqui garante aprovação. A Play revisa cada envio; este guia só deixa o app dentro das regras que dá para conferir no código.

## 1. Os dois canais do Android

O mesmo código gera dois apps, separados por *product flavors* do Gradle (`platforms/android/app/build.gradle`):

| | **Developer** (o de sempre) | **Google Play** |
|---|---|---|
| Flavor | `developer` | `play` |
| Arquivo | APK (`dist/android/IPTVKZ-android.apk`) | AAB (`dist/android/play/IPTVKZ-play-<versão>-<code>.aab`) |
| Identificador | `com.lucasyemz.iptvkz` (não muda) | `com.kazamastudios.iptvkz` (aprovado em 10/11/2026) |
| Assinatura | chave própria (`ANDROID_KEYSTORE`) | chave de upload; a chave final fica com a Play (Play App Signing) |
| Atualização | sozinho, pelo GitHub Releases (pacote assinado + APK com confirmação) | só pela Play |
| `REQUEST_INSTALL_PACKAGES` | sim | não |
| Baixa código de fora | sim (pacote `src/` assinado) | não |
| Aparelhos | Android TV, Google TV, celulares e tablets | só Android TV / Google TV (`leanback` obrigatório) |
| `versionCode` | `nativeVersion` | `playVersionCode` |

Onde fica cada coisa:

- `app/src/main/`: tudo o que é comum (Activity, WebView, Node embutido, `Bundles.java`).
- `app/src/developer/`: o atualizador de verdade (`Updater.java`), a chave pública de atualização (`update_key.xml`), o `FileProvider` e a permissão de instalar pacotes.
- `app/src/play/`: um `Updater.java` vazio e o manifesto que exige Android TV.

Nada que baixa código ou instala APK está em `main/` ou `play/`, então o AAB da Play não carrega esse código.

### As duas instaladas juntas

Com identificadores diferentes, o APK Developer e a versão da Play convivem no mesmo aparelho, cada uma com os próprios dados (listas, favoritos, histórico). Os dois servidores internos usam portas diferentes sozinhos (8787, 8788…). Na tela inicial aparecem dois "IPTVKZ"; para diferenciar, dá para trocar o nome do Developer depois (ex.: "IPTVKZ Dev"), mas isso não foi feito para não mudar o app de quem já usa.

**Por que não usar `com.lucasyemz.iptvkz` na Play:** com Play App Signing, a Play assina com uma chave dela. Quem tem o APK atual (assinado com a chave do projeto) não conseguiria atualizar pela Play nem instalar as duas juntas, e a atualização pelo GitHub continuaria chegando ao mesmo pacote. Mudar o identificador do APK Developer quebraria a atualização de quem já tem o app. A saída sem perdas é um identificador novo para a Play.

**Identificador aprovado:** `com.kazamastudios.iptvkz`. Depois do primeiro upload ele não muda nunca mais. Para trocar, edite `play { applicationId ... }` em `app/build.gradle` (ou passe `-PplayApplicationId=...` / `PLAY_APPLICATION_ID`).

## 2. Requisitos da Play conferidos (novembro de 2026)

Fonte: [Target API level requirements](https://developer.android.com/google/play/requirements/target-sdk) e [16 KB page sizes](https://developer.android.com/guide/practices/page-sizes), lidas em 10/11/2026.

- **Target API:** desde 31/08/2026, apps novos e atualizações precisam de API 36, **exceto Android TV, que pode ficar em API 34**. O IPTVKZ está com `targetSdk 34`. Por isso a versão da Play sai **só para TV** (`android.software.leanback` com `required="true"` em `app/src/play/AndroidManifest.xml`). Publicar também para celular exigiria `targetSdk 36` (ver pendências).
- **16 KB:** obrigatório para apps com `targetSdk 35` ou mais (atualizações sem suporte barradas a partir de 01/02/2027). Com `targetSdk 34` não se aplica hoje. A `libnode.so` do nodejs-mobile v18.20.4 (a mais nova publicada) está alinhada em 4 KB; `native-lib` já é compilada com 16 KB. Isso trava subir o `targetSdk` (ver auditoria).
- **Dynamic Code Loading:** a política proíbe baixar código executável de fora da Play e atualizar o app por outro meio. A versão da Play não baixa nada; o `src/` vem dentro do AAB.
- **Permissões:** a versão da Play pede só `INTERNET` e `ACCESS_NETWORK_STATE`.

## 3. Chave de upload (uma vez só)

A Play guarda a chave de assinatura do app. Você guarda só a **chave de upload**, que serve para provar que o AAB veio de você. Se ela vazar ou se perder, dá para pedir outra à Play.

Gere fora do repositório, por exemplo em `~/.iptvkz-android/`, com o `keytool` do JDK 17. Você mesmo digita as senhas quando ele pedir:

```bash
keytool -genkeypair -v -keystore ~/.iptvkz-android/play-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
```

Nunca coloque o `.jks` nem as senhas no Git.

### Secrets do GitHub

Em *Settings → Secrets and variables → Actions*, crie:

| Secret | Conteúdo |
|---|---|
| `PLAY_UPLOAD_KEYSTORE_BASE64` | o `.jks` em base64 (`base64 -w0 play-upload.jks` no Linux; `[Convert]::ToBase64String([IO.File]::ReadAllBytes("play-upload.jks"))` no PowerShell) |
| `PLAY_UPLOAD_KEYSTORE_PASSWORD` | senha do keystore |
| `PLAY_UPLOAD_KEY_ALIAS` | `upload` (ou o alias que você usou) |
| `PLAY_UPLOAD_KEY_PASSWORD` | senha da chave (se for igual à do keystore, repita) |

Os secrets do canal Developer (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_UPDATE_KEY`) continuam os mesmos e não são usados pela Play.

## 4. Gerar o AAB

### Pelo GitHub (recomendado)

1. *Actions → Google Play → Run workflow*. Opcional: um `versionCode` diferente do de `version.properties`.
2. O fluxo roda os testes, compila `bundlePlayRelease`, assina com a chave de upload, valida com o `bundletool` (estrutura, manifesto sem instalação de APK, só TV, não depurável) e mostra o tamanho de download.
3. Baixe o artefato **IPTVKZ-GooglePlay**: o `.aab` e o `.sha256`.

Sem os secrets, o fluxo para com erro em vez de gerar um AAB com a chave de debug. Em pull requests ele gera um AAB **sem assinatura** (`-UNSIGNED` no nome), só para conferir que compila. Esse não pode ir para a Play.

Este fluxo nunca envia nada à Play e não interfere no `build.yml`: se ele falhar, o APK Developer, os instaladores e a Release seguem normais.

### Na sua máquina

Precisa de JDK 17, Android SDK com plataforma 34, NDK `26.3.11579264` e CMake `3.22.1`, e `gh` (para baixar o Node do Android uma vez). No Linux/macOS também `zip`; no Windows o script usa o `tar` do sistema.

No PC do Lucas já está tudo instalado: JDK em `%LOCALAPPDATA%\Programs\Temurin\jdk-17.0.21+9`, SDK em `%LOCALAPPDATA%\Android\Sdk` (com `JAVA_HOME` e `ANDROID_HOME` configurados no usuário) e o bundletool em `%LOCALAPPDATA%\Android\bundletool\`. As ferramentas novas do SDK (cmdline-tools 23) trocaram o `sdkmanager` por `android sdk install`, com `/` no lugar de `;` (ex.: `android sdk install ndk/26.3.11579264`).

```bash
npm ci
npm run build
npm run vendor
npm run android:play
```

Para assinar, defina antes `PLAY_UPLOAD_KEYSTORE` (caminho do `.jks`), `PLAY_UPLOAD_KEYSTORE_PASSWORD`, `PLAY_UPLOAD_KEY_ALIAS` e `PLAY_UPLOAD_KEY_PASSWORD`. Com `BUNDLETOOL` apontando para o `bundletool-all.jar`, o script também valida o AAB.

O APK Developer continua igual: `npm run android` (saída em `dist/android/`, sem apagar `dist/android/play/`).

## 5. Testar o AAB antes de enviar

Com o [bundletool](https://github.com/google/bundletool/releases) e a TV Mecool com depuração ADB ligada (Configurações → Preferências do dispositivo → Sobre → clique 7 vezes em *Build*; depois *Opções do desenvolvedor → Depuração USB/rede*):

```bash
adb connect IP_DA_TV:5555
```

```bash
java -jar bundletool-all.jar build-apks --bundle=IPTVKZ-play-1.0.5-1.aab --output=iptvkz.apks --connected-device --ks=~/.iptvkz-android/play-upload.jks --ks-key-alias=upload
```

```bash
java -jar bundletool-all.jar install-apks --apks=iptvkz.apks
```

O bundletool pede as senhas no terminal. Isso instala a versão da Play ao lado do APK Developer.

Roteiro de teste na TV (anote o resultado em `RELEASE_AUDIT.md`):

1. Abre pelo launcher da TV (banner aparece) e mostra "Abrindo", **não** "Verificando se há atualizações".
2. Termos de uso (versão 3) aparecem e o aceite funciona com o controle.
3. Adicionar lista: por link M3U, por arquivo e Xtream (com uma lista sua ou licenciada); pelo celular via QR Code.
4. Navegar com o D-pad em todas as telas; Voltar fecha modais, volta de tela e, na tela inicial, sai.
5. Busca com o teclado do sistema e com voz.
6. Ao vivo: troca rápida de canais, guia (EPG), favoritos.
7. Filmes/séries: tocar, pausar, avançar, áudio e legendas, retomar de onde parou.
8. Controle parental (PIN).
9. Baixar lista pelo celular e carregar em outro aparelho.
10. Desligar o Wi-Fi no meio de um canal e religar: o app se recupera.
11. Apertar Home com um vídeo tocando, voltar depois de alguns minutos e depois de a TV dormir: o app volta sem tela preta.
12. Confirmar em *Configurações → Apps → IPTVKZ → Permissões* que não há "Instalar apps desconhecidos".

## 6. Play Console

### Conta

- A conta precisa ser de **Kazama Studios**. Conta de organização pede D-U-N-S e dados da empresa; conta pessoal criada depois de novembro de 2023 precisa de **teste fechado com pelo menos 12 testadores por 14 dias** antes da produção. Decida qual (pendência legal/empresarial).
- Nome do desenvolvedor, e-mail e site públicos na ficha: dados da Kazama Studios (pendente).

### Criar o app

1. *Criar app*: nome **IPTVKZ**, idioma português (Brasil), **App**, **Gratuito**.
2. *Configuração → Assinatura de apps*: aceite o **Play App Signing** (a Play gera a chave do app) e registre a chave de upload enviando o primeiro AAB.
3. *Configuração → Configurações avançadas → Formatos*: adicione **Android TV** e aceite as diretrizes de qualidade para TV. Sem isso o app não passa pela revisão de TV.

### Ficha da loja

- **Ícone** 512×512 (de `assets/brand/icon-1024.png`), **banner de TV** 1280×720 e **capturas de TV** 1920×1080. As capturas devem usar só conteúdo fictício ou seu (como as de `docs/screenshots/tv-*.webp`, feitas com dados gerados). Nada de logotipos de canais, filmes ou séries de terceiros.
- **Descrição curta** (até 80 caracteres), sugestão:
  > Player para as suas listas M3U e Xtream na TV. Não inclui canais nem conteúdo.
- **Descrição completa**, sugestão:
  > O IPTVKZ é um reprodutor de mídia para Android TV e Google TV. Você adiciona as listas de reprodução que já tem (M3U, M3U8 ou Xtream Codes) e o guia de programação (XMLTV), e o IPTVKZ organiza tudo em canais ao vivo, filmes e séries, com navegação pelo controle remoto.
  >
  > O IPTVKZ NÃO fornece, vende nem indica canais, listas ou qualquer conteúdo. Ele vem sem nenhuma lista. Use apenas listas e conteúdos que você tem o direito de acessar.
  >
  > Recursos: guia de programação, favoritos, histórico e "continuar assistindo", busca com voz, controle parental com PIN, escolha de áudio e legendas, cadastro da lista pelo celular via QR Code (direto pela rede de casa), sem anúncios e sem conta.
- Evite palavras como "grátis", "todos os canais", "filmes de lançamento", nomes de canais, de emissoras ou de serviços de streaming, e qualquer captura com conteúdo de terceiros.
- **Categoria:** Players de vídeo e editores (Video Players & Editors).

### Conteúdo do app (Política)

- **Política de privacidade:** a Play exige um link público. Texto sugerido na seção 7. Publique em um endereço da Kazama Studios (ou GitHub Pages) e cole o link. **Pendente.**
- **Anúncios:** não contém anúncios.
- **Acesso ao app:** o app não tem login próprio, mas sem uma lista não mostra nada. Informe aos revisores um link M3U de teste **seu ou licenciado** (por exemplo, um stream que você mesmo gera) com instruções: "Adicionar lista → Link M3U → colar o link". **Pendente: não use listas de terceiros sem licença.**
- **Público-alvo:** 18 anos ou mais (o app reproduz conteúdo escolhido pelo usuário, sem filtro). Não marque como app para crianças.
- **Classificação de conteúdo (IARC):** responda com sinceridade que o app é um player e que o conteúdo vem de fontes escolhidas pelo usuário, sem filtro. A classificação final é da IARC.
- **App de notícias / governo / saúde / financeiro:** não.
- **Segurança dos dados (Data Safety):** seção 8.

### Teste e lançamento

1. *Testes → Teste interno*: envie o AAB, adicione seu e-mail como testador e instale pela Play na TV. Repita o roteiro da seção 5.
2. Se a conta for pessoal: *Teste fechado* com 12+ testadores por 14 dias.
3. *Produção*: escolha os países e envie para revisão. A revisão de Android TV é separada e pode levar mais tempo.

## 7. Política de privacidade (rascunho)

Revise com quem responde pela Kazama Studios antes de publicar. Os trechos entre colchetes dependem de dados que não estão no repositório.

> **Política de privacidade do IPTVKZ**
> Última atualização: [data]. Responsável: Kazama Studios, [contato].
>
> **Dados que o app guarda.** As listas que você adiciona (endereços, usuário e senha de Xtream), o guia de programação, favoritos, histórico de reprodução, preferências e o PIN do controle parental ficam guardados apenas no seu aparelho, na área privada do app. A Kazama Studios não recebe nenhum desses dados.
>
> **Com quem o app se conecta.** Somente: (a) com os servidores das listas, guias, imagens e vídeos que você cadastrou, para mostrar e reproduzir esse conteúdo; esses servidores são de terceiros escolhidos por você e têm as próprias políticas; (b) com serviços públicos de teste de conexão do Google e da Microsoft, para mostrar se há internet, sem enviar dados seus; (c) com o YouTube, só quando você pede um trailer. A versão da Google Play é atualizada só pela loja.
>
> **Na rede de casa.** Para cadastrar uma lista pelo celular, a TV mostra um QR Code com um código de uso único válido por 15 minutos; os dados vão do celular direto para a TV, pela sua rede, sem passar por servidores da Kazama Studios. O arquivo "Baixar lista" contém o usuário e a senha da lista e fica com você.
>
> **O que não fazemos.** Não coletamos dados pessoais, não usamos anúncios, análise de uso, relatórios de erro nem identificadores de publicidade, e não vendemos nem compartilhamos dados.
>
> **Apagar seus dados.** Exclua a lista nas Configurações do app ou desinstale o app: tudo o que ele guardou é apagado do aparelho.
>
> **Crianças.** O app não é destinado a menores de 18 anos.
>
> **Contato.** [e-mail da Kazama Studios].

Os termos de uso do app (`src/web/termos.txt`, versão 3) já descrevem o mesmo comportamento. Se o texto acima mudar, mantenha os dois iguais.

## 8. Segurança dos dados (Data Safety): respostas propostas

Baseadas no que o código faz (servidor local sem telemetria, `allowBackup="false"`, nenhum SDK de terceiros). **Confira antes de enviar; a responsabilidade pela declaração é de quem publica.**

| Pergunta | Resposta proposta | Por quê |
|---|---|---|
| O app coleta ou compartilha algum dos tipos de dados exigidos? | **Não** | Nada vai para a Kazama Studios nem para SDKs. O que sai do aparelho vai para o servidor que o próprio usuário cadastrou, para usar o serviço dele. |
| Os dados são criptografados em trânsito? | (não perguntado se a resposta acima for "Não") | Streams e listas podem ser `http`: depende do provedor do usuário. |
| O usuário pode pedir para apagar os dados? | Sim: excluindo a lista ou desinstalando | Tudo é local. |

Ponto para decidir: a interpretação mais conservadora considera que usuário e senha do Xtream são "coletados" porque saem do aparelho para um terceiro. Se preferir declarar, use *Informações pessoais → IDs de usuário* e *Informações do app → Outro conteúdo*, finalidade "Funcionalidade do app", **não compartilhado**, **coleta obrigatória**, e responda **Não** para criptografia em trânsito (há provedores só `http`). Essa escolha é sua; o código não muda.

## 9. Próximas atualizações na Play

Na Play não existe atualização de `src/` sem loja: **toda mudança, até na interface, precisa de um AAB novo.**

1. Aumente `playVersionCode` em `platforms/android/version.properties` (ou informe o `versionCode` ao rodar o fluxo). Ele nunca pode repetir nem diminuir. O pacote embutido usa esse número, então o `src/` novo é reinstalado na primeira abertura depois da atualização.
2. Se mudou a parte nativa, aumente também `nativeVersion`/`nativeName` (canal Developer) para manter os dois parecidos.
3. Rode *Actions → Google Play*, teste o AAB (seção 5) e envie pela Play Console: teste interno → produção.

O canal Developer segue como antes: tag `v*` → `build.yml` → rascunho de Release → publicar.

## 10. Checklist final antes do primeiro envio

- [x] Identificador da Play aprovado (`com.kazamastudios.iptvkz`) e definido no `build.gradle`.
- [ ] Conta da Play Console da Kazama Studios criada (organização ou pessoal com teste fechado).
- [ ] Chave de upload gerada fora do Git e secrets `PLAY_UPLOAD_*` configurados.
- [ ] Fluxo *Google Play* rodou com sucesso: testes, AAB assinado, `bundletool validate`, manifesto conferido.
- [ ] AAB instalado na TV Mecool via `bundletool` e roteiro da seção 5 aprovado.
- [ ] Mesmo roteiro no APK Developer, para confirmar que nada quebrou (incluindo atualização a partir do APK 1.0.5 publicado).
- [ ] Política de privacidade publicada em um link público e igual aos termos do app.
- [ ] Ficha com ícone, banner de TV, capturas de TV só com conteúdo fictício/próprio e descrições sem nomes de terceiros.
- [ ] Lista de teste própria ou licenciada para os revisores.
- [ ] Data Safety, classificação de conteúdo, público-alvo 18+, sem anúncios.
- [ ] Formato Android TV ativado na Play Console.
- [ ] Teste interno pela própria Play na TV.
