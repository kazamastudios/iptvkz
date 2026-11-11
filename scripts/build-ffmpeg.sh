#!/usr/bin/env bash
# Compila o FFmpeg reduzido do componente opcional do PC: só lê o vídeo (MKV, MP4, TS, AVI...), copia a imagem
# como está e converte o áudio (AC3, E-AC3, DTS, TrueHD...) para AAC, que o navegador toca. Nada de converter vídeo.
# Os arquivos vêm pelo servidor do próprio app (http://127.0.0.1), então não precisa de TLS.
# Uso: scripts/build-ffmpeg.sh <win-x64|mac-arm64|mac-x64|linux-x64>   →   dist/desktop/componentes/
set -euo pipefail

TARGET="${1:?alvo: win-x64, mac-arm64, mac-x64 ou linux-x64}"
VERSION=7.1.1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/ffmpeg-build-$TARGET"
OUT="$ROOT/dist/desktop/componentes"
mkdir -p "$WORK" "$OUT"
cd "$WORK"

if [ ! -d "ffmpeg-$VERSION" ]; then
  curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz" -o ffmpeg.tar.xz
  tar -xf ffmpeg.tar.xz
fi
cd "ffmpeg-$VERSION"

FLAGS=(
  --disable-everything --disable-autodetect --disable-doc --disable-debug --enable-small
  --disable-ffplay --disable-ffprobe --disable-avdevice --disable-swscale --disable-postproc
  --enable-swresample --enable-network
  --enable-protocol=http,tcp,file,pipe
  --enable-demuxer=matroska,mov,mpegts,avi,flv,asf,mpegps,aac,ac3,eac3,dts,truehd,mp3,flac,ogg,wav
  --enable-parser=h264,hevc,av1,vp9,mpeg4video,mpegvideo,aac,aac_latm,ac3,dca,mlp,mpegaudio,opus,vorbis,flac
  --enable-decoder=ac3,eac3,dca,truehd,mlp,aac,aac_latm,mp2,mp3,flac,opus,vorbis,pcm_s16le,pcm_s24le,pcm_s16be,pcm_bluray,pcm_dvd
  --enable-encoder=aac
  --enable-muxer=mp4
  --enable-bsf=aac_adtstoasc,extract_extradata,h264_mp4toannexb,hevc_mp4toannexb,vp9_superframe,av1_frame_merge
  --enable-filter=aresample,aformat,anull,null,abuffer,abuffersink
)

EXE=ffmpeg
case "$TARGET" in
  win-x64)
    FLAGS+=(--target-os=mingw32 --arch=x86_64 --cross-prefix=x86_64-w64-mingw32- --pkg-config=false
      --extra-ldflags=-static --enable-w32threads)
    EXE=ffmpeg.exe ;;
  mac-arm64) FLAGS+=(--arch=arm64 --extra-cflags=-mmacosx-version-min=11.0 --extra-ldflags=-mmacosx-version-min=11.0) ;;
  mac-x64) FLAGS+=(--arch=x86_64 --extra-cflags=-mmacosx-version-min=10.15 --extra-ldflags=-mmacosx-version-min=10.15) ;;
  linux-x64) FLAGS+=(--extra-ldflags=-static-libgcc) ;;
  *) echo "alvo desconhecido: $TARGET" >&2; exit 1 ;;
esac

./configure "${FLAGS[@]}"
make -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" ffmpeg
case "$TARGET" in win-x64) x86_64-w64-mingw32-strip "$EXE" ;; *) strip "$EXE" ;; esac

# O app baixa um .zip só com o executável e confere o SHA-256 gravado em src/server/ffmpeg.json.
NAME="iptvkz-ffmpeg-$VERSION-$TARGET"
rm -f "$OUT/$NAME.zip"
(cd "$(pwd)" && zip -q -9 "$OUT/$NAME.zip" "$EXE")
ls -l "$EXE" "$OUT/$NAME.zip"
