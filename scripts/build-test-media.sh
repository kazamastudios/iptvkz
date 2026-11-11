#!/usr/bin/env bash
# Gera os vídeos da lista de teste de formatos (public/teste/formatos.m3u): 30 s do trailer do Sintel
# (c) Blender Foundation, CC BY 3.0, em cada combinação de contêiner, vídeo, áudio e legenda que as listas
# IPTV costumam trazer. Roda no CI (.github/workflows/test-media.yml) com o FFmpeg completo do Ubuntu.
# Uso: scripts/build-test-media.sh <pasta de saída>
set -euo pipefail

OUT="${1:?pasta de saída}"
mkdir -p "$OUT"
WORK="$(mktemp -d)"
SRC="$WORK/sintel.mp4"
curl -fsSL https://download.blender.org/durian/trailer/sintel_trailer-1080p.mp4 -o "$SRC"

# Legendas de teste (pt e en), texto próprio
cat > "$WORK/pt.srt" <<'SRT'
1
00:00:01,000 --> 00:00:06,000
Legenda de teste em português

2
00:00:08,000 --> 00:00:14,000
Se você lê isto, a legenda embutida funciona
SRT
cat > "$WORK/en.srt" <<'SRT'
1
00:00:01,000 --> 00:00:06,000
English test subtitle

2
00:00:08,000 --> 00:00:14,000
If you can read this, embedded subtitles work
SRT

IN=(-hide_banner -loglevel error -y -ss 4 -t 30 -i "$SRC")
H264=(-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p)
SURR=(-af "pan=5.1|FL=FL|FR=FR|FC=0.5*FL+0.5*FR|LFE=0.1*FL+0.1*FR|SL=FL|SR=FR")
n=0
make() { # make <arquivo> <args...>
  local name="$1"; shift
  n=$((n + 1))
  echo "[$n] $name"
  ffmpeg "${IN[@]}" "$@" "$OUT/$name"
}

# --- contêineres (H.264 + áudio comum de cada um) ---
make 01-mp4-h264-aac.mp4            "${H264[@]}" -c:a aac -b:a 160k -movflags +faststart
make 02-mkv-h264-aac.mkv            "${H264[@]}" -c:a aac -b:a 160k
make 03-mov-h264-aac.mov            "${H264[@]}" -c:a aac -b:a 160k -movflags +faststart
make 04-ts-h264-aac.ts              "${H264[@]}" -c:a aac -b:a 160k -f mpegts
make 05-flv-h264-aac.flv            "${H264[@]}" -vf scale=-2:720 -c:a aac -b:a 128k
make 06-avi-mpeg4-mp3.avi           -c:v mpeg4 -vtag xvid -q:v 4 -vf scale=-2:720 -c:a libmp3lame -b:a 160k
make 07-mpg-mpeg2-mp2.mpg           -c:v mpeg2video -q:v 4 -vf scale=-2:720 -c:a mp2 -b:a 192k -f vob
make 08-webm-vp9-opus.webm          -c:v libvpx-vp9 -b:v 2M -deadline realtime -cpu-used 8 -row-mt 1 -vf scale=-2:720 -c:a libopus -b:a 128k

# --- vídeo ---
make 10-mp4-h265-aac.mp4            -c:v libx265 -preset fast -crf 26 -tag:v hvc1 -c:a aac -b:a 160k -movflags +faststart
make 11-mkv-h265-10bit-4k-aac.mkv   -c:v libx265 -preset ultrafast -crf 26 -pix_fmt yuv420p10le -vf scale=3840:-2 -c:a aac -b:a 160k
make 12-mp4-av1-aac.mp4             -c:v libsvtav1 -preset 10 -crf 35 -vf scale=-2:720 -c:a aac -b:a 160k -movflags +faststart
make 13-mp4-h264-4k-aac.mp4         "${H264[@]}" -vf scale=3840:-2 -c:a aac -b:a 160k -movflags +faststart

# --- áudio (MKV, H.264), os que mais aparecem em filmes de listas ---
make 20-mkv-h264-ac3-5.1.mkv        "${H264[@]}" "${SURR[@]}" -c:a ac3 -b:a 448k
make 21-mkv-h264-eac3-5.1.mkv       "${H264[@]}" "${SURR[@]}" -c:a eac3 -b:a 640k
make 22-mkv-h264-dts-5.1.mkv        "${H264[@]}" "${SURR[@]}" -c:a dca -strict -2 -b:a 1509k
make 23-mkv-h264-truehd.mkv         "${H264[@]}" -c:a truehd -strict -2
make 24-mkv-h264-flac.mkv           "${H264[@]}" -c:a flac
make 25-mkv-h264-opus.mkv           "${H264[@]}" -c:a libopus -b:a 128k
make 26-mp4-h264-eac3.mp4           "${H264[@]}" "${SURR[@]}" -c:a eac3 -b:a 640k -movflags +faststart
make 27-ts-h264-ac3.ts              "${H264[@]}" "${SURR[@]}" -c:a ac3 -b:a 448k -f mpegts

# --- FPS: o mesmo trecho em cada taxa de quadros (o trailer é 24 fps; acima disso os quadros são repetidos,
# o que basta para medir se o aparelho decodifica e mostra todos sem perder nenhum) ---
make 40-fps-23.976-1080p-h264.mp4   "${H264[@]}" -vf fps=24000/1001 -c:a aac -b:a 160k -movflags +faststart
make 41-fps-25-1080p-h264.mp4       "${H264[@]}" -vf fps=25 -c:a aac -b:a 160k -movflags +faststart
make 42-fps-29.97-1080p-h264.mp4    "${H264[@]}" -vf fps=30000/1001 -c:a aac -b:a 160k -movflags +faststart
make 43-fps-50-1080p-h264.mp4       "${H264[@]}" -vf fps=50 -c:a aac -b:a 160k -movflags +faststart
make 44-fps-59.94-1080p-h264.mp4    "${H264[@]}" -vf fps=60000/1001 -c:a aac -b:a 160k -movflags +faststart
make 45-fps-60-1080p-h265.mp4       -c:v libx265 -preset fast -crf 26 -tag:v hvc1 -vf fps=60 -c:a aac -b:a 160k -movflags +faststart
make 46-fps-60-4k-h265.mkv          -c:v libx265 -preset ultrafast -crf 28 -vf "fps=60,scale=3840:-2" -c:a aac -b:a 160k

# --- várias faixas e legendas ---
n=$((n + 1)); echo "[$n] 30-mkv-dois-audios-legendas.mkv"
ffmpeg -hide_banner -loglevel error -y -ss 4 -t 30 -i "$SRC" -i "$WORK/pt.srt" -i "$WORK/en.srt" \
  -map 0:v -map 0:a -map 0:a -map 1 -map 2 "${H264[@]}" \
  -c:a:0 aac -b:a:0 160k -c:a:1 ac3 -b:a:1 384k -c:s srt \
  -metadata:s:a:0 language=por -metadata:s:a:0 title="Português" \
  -metadata:s:a:1 language=eng -metadata:s:a:1 title="English" \
  -metadata:s:s:0 language=por -metadata:s:s:0 title="Português" \
  -metadata:s:s:1 language=eng -metadata:s:s:1 title="English" \
  "$OUT/30-mkv-dois-audios-legendas.mkv"
n=$((n + 1)); echo "[$n] 31-mp4-legenda-mov_text.mp4"
ffmpeg -hide_banner -loglevel error -y -ss 4 -t 30 -i "$SRC" -i "$WORK/pt.srt" -map 0:v -map 0:a -map 1 \
  "${H264[@]}" -c:a aac -b:a 160k -c:s mov_text -metadata:s:s:0 language=por -movflags +faststart \
  "$OUT/31-mp4-legenda-mov_text.mp4"

cat > "$OUT/LEIA-ME.txt" <<'TXT'
Vídeos de teste do IPTVKZ: 30 segundos do trailer de Sintel, (c) Blender Foundation, www.sintel.org,
licença Creative Commons Attribution 3.0 (CC BY 3.0). Convertidos para testar formatos; o conteúdo não mudou.
TXT
(cd "$OUT" && sha256sum * > SHA256SUMS.txt)
ls -lh "$OUT"
rm -rf "$WORK"
