# Teste de formatos em cada aparelho

A lista `public/teste/formatos.m3u` é a mesma em todo aparelho. Adicione no app Beta pelo link:

```
https://raw.githubusercontent.com/kazamastudios/iptvkz/main/public/teste/formatos.m3u
```

Antes de juntar a branch, use o mesmo endereço com o nome da branch no lugar de `main`.

Os vídeos "Sintel" têm 30 s. São o trailer de Sintel, (c) Blender Foundation, licença CC BY 3.0, convertido em cada formato por `scripts/build-test-media.sh`. A conversão roda no CI (`.github/workflows/test-media.yml`), e os arquivos ficam na release `teste-formatos`.

## Como conferir cada item

Abra o item e espere uns 10 s. No botão de áudio (onda sonora), a última linha, "Reprodução", mostra quem está tocando e o formato. Marque assim:

- **ok:** imagem e som certos;
- **mudo:** imagem sem som;
- **erro:** mensagem de formato;
- **trava:** imagem engasgando.

| Onde | Quem toca o vídeo |
|---|---|
| Android (Mecool, celular) | Filmes e séries: player do Android. Áudio AC3, E-AC3, DTS e TrueHD pelo decodificador do app |
| LG | Player da própria TV |
| PC (app ou navegador) | Navegador. MKV/AVI com áudio que o navegador não toca passam pelo componente de vídeo opcional |

## O que se espera hoje

| Item | Android | LG | PC |
|---|---|---|---|
| MP4, MOV · H.264 · AAC | ok | ok | ok |
| MKV · H.264 · AAC | ok | ok | ok |
| TS · H.264 · AAC (aparece em TV ao Vivo, como os canais .ts das listas) | ok | ok | ok |
| FLV, AVI, MPG | ok | depende do modelo | componente |
| WebM · VP9 · Opus | ok | ok | ok |
| H.265 (MP4, MKV, 4K 10-bit) | ok se o aparelho decodifica H.265 | ok | depende da placa de vídeo |
| AV1 | depende do aparelho | depende do modelo | ok |
| H.264 4K | ok (o app prefere Full HD numa tela Full HD) | ok | ok |
| AC3, E-AC3 | ok | ok | componente |
| DTS, TrueHD | ok | depende do modelo | componente |
| FLAC, Opus | ok | depende do modelo | ok |
| 2 áudios e 2 legendas (MKV) | troca áudio e legenda no menu | áudio da TV | componente; legenda por arquivo |
| Legenda mov_text (MP4) | aparece no menu | ? | ? |
| HLS com vários áudios e legendas | ok | ok | ok |
| HLS H.265, Dolby Vision e Atmos | depende do aparelho | depende do modelo | depende da placa |
| Ao vivo HLS | ok | ok | ok |

Onde está "?" ou "depende", o teste diz como fica. Anote o modelo do aparelho junto do resultado.
