package com.lucasyemz.iptvkz;

import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.SurfaceView;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/**
 * Player nativo (Media3) para o que o WebView não toca: MKV, áudio AC3/E-AC3/DTS, H.265 sem suporte no navegador.
 * O vídeo fica numa SurfaceView atrás do WebView, que fica transparente só na área do player:
 * os controles continuam sendo os do app (HTML). A interface web fala com ele por IPTVKZVideo e recebe
 * os eventos em window.__exo(json).
 */
final class NativeVideo implements Player.Listener {
    private static final long TICK_MS = 250;

    private final Context ctx;
    private final FrameLayout root;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private FrameLayout box;
    private SurfaceView surface;
    private float rx, ry, rw = 1, rh = 1; // área do player na tela, em frações
    private int vw, vh;
    private float par = 1;
    private boolean sentMeta;
    private String lastCue = "";

    NativeVideo(Context ctx, FrameLayout root, WebView web) {
        this.ctx = ctx;
        this.root = root;
        this.web = web;
    }

    // ---------- chamadas da interface (thread do JavaScript → thread principal) ----------

    @JavascriptInterface
    public void open(String url, String kind, double startAt, double volume, String audioLang) {
        main.post(() -> openNow(url, kind, startAt, (float) volume, audioLang));
    }

    @JavascriptInterface
    public void play() { main.post(() -> { if (player != null) player.play(); }); }

    @JavascriptInterface
    public void pause() { main.post(() -> { if (player != null) player.pause(); }); }

    @JavascriptInterface
    public void seek(double seconds) {
        main.post(() -> { if (player != null) player.seekTo((long) (seconds * 1000)); });
    }

    @JavascriptInterface
    public void volume(double v) { main.post(() -> { if (player != null) player.setVolume((float) v); }); }

    /** Faixa de áudio ou de legenda: id "grupo:faixa"; "text:off" desliga a legenda. */
    @JavascriptInterface
    public void track(String type, String id) { main.post(() -> selectTrack(type, id)); }

    @JavascriptInterface
    public void rect(double x, double y, double w, double h) {
        main.post(() -> {
            rx = (float) x;
            ry = (float) y;
            rw = (float) w;
            rh = (float) h;
            layout();
        });
    }

    @JavascriptInterface
    public void close() { main.post(this::release); }

    // ---------- player ----------

    private void openNow(String url, String kind, double startAt, float volume, String audioLang) {
        release();
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(ctx)
                // decodificador do aparelho primeiro; o FFmpeg só entra para o áudio que ele não abre (AC3, DTS...)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
                .setEnableDecoderFallback(true);
        DefaultExtractorsFactory extractors = new DefaultExtractorsFactory()
                .setConstantBitrateSeekingEnabled(true)
                .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES
                        | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS);
        // o link já vem pelo servidor do app, que manda o User-Agent da lista e reescreve o HLS
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(20000);
        player = new ExoPlayer.Builder(ctx, renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(http, extractors))
                .build();
        TrackSelectionParameters.Builder p = player.getTrackSelectionParameters().buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true); // a interface decide a legenda
        if ("pt".equals(audioLang) || "en".equals(audioLang)) p.setPreferredAudioLanguage(audioLang);
        player.setTrackSelectionParameters(p.build());
        player.addListener(this);
        player.setVolume(volume);

        box = new FrameLayout(ctx);
        box.setBackgroundColor(Color.BLACK);
        surface = new SurfaceView(ctx);
        box.addView(surface, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        root.addView(box, 0, new FrameLayout.LayoutParams(-1, -1));
        web.setBackgroundColor(Color.TRANSPARENT);
        player.setVideoSurfaceView(surface);
        vw = vh = 0;
        sentMeta = false;
        lastCue = "";
        layout();

        MediaItem.Builder item = new MediaItem.Builder().setUri(url);
        if ("hls".equals(kind)) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        if (startAt > 1) player.setMediaItem(item.build(), (long) (startAt * 1000));
        else player.setMediaItem(item.build());
        player.setPlayWhenReady(true);
        player.prepare();
        main.removeCallbacks(tick);
        main.postDelayed(tick, TICK_MS);
    }

    void release() {
        main.removeCallbacks(tick);
        if (player != null) {
            player.removeListener(this);
            player.release();
            player = null;
        }
        if (box != null) {
            root.removeView(box);
            box = null;
            surface = null;
        }
        web.setBackgroundColor(Color.BLACK);
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (player == null) return;
            send(state("t"));
            main.postDelayed(this, TICK_MS);
        }
    };

    /** Posiciona a área do vídeo onde está o player do app e encaixa a imagem sem distorcer. */
    private void layout() {
        if (box == null) return;
        int W = web.getWidth(), H = web.getHeight();
        if (W == 0 || H == 0) {
            main.postDelayed(this::layout, 100);
            return;
        }
        FrameLayout.LayoutParams b = new FrameLayout.LayoutParams(Math.round(rw * W), Math.round(rh * H));
        b.leftMargin = Math.round(rx * W);
        b.topMargin = Math.round(ry * H);
        box.setLayoutParams(b);
        int bw = b.width, bh = b.height;
        int sw = bw, sh = bh;
        if (vw > 0 && vh > 0 && bw > 0 && bh > 0) {
            float aspect = vw * par / vh;
            if ((float) bw / bh > aspect) sw = Math.round(bh * aspect);
            else sh = Math.round(bw / aspect);
        }
        surface.setLayoutParams(new FrameLayout.LayoutParams(sw, sh, Gravity.CENTER));
    }

    private void selectTrack(String type, String id) {
        if (player == null) return;
        int kind = "audio".equals(type) ? C.TRACK_TYPE_AUDIO : C.TRACK_TYPE_TEXT;
        TrackSelectionParameters.Builder p = player.getTrackSelectionParameters().buildUpon();
        if ("off".equals(id)) {
            player.setTrackSelectionParameters(p.setTrackTypeDisabled(kind, true).build());
            lastCue = "";
            send(event("cue").put("text", ""));
            return;
        }
        String[] gi = id.split(":");
        List<Tracks.Group> groups = player.getCurrentTracks().getGroups();
        int g = Integer.parseInt(gi[0]), i = Integer.parseInt(gi[1]);
        if (g < 0 || g >= groups.size()) return;
        p.setTrackTypeDisabled(kind, false)
                .setOverrideForType(new TrackSelectionOverride(groups.get(g).getMediaTrackGroup(), i));
        player.setTrackSelectionParameters(p.build());
    }

    // ---------- eventos para a interface ----------

    private Json event(String name) { return new Json().put("e", name); }

    private Json state(String name) {
        Json j = event(name);
        long d = player.getDuration();
        j.put("t", player.getCurrentPosition() / 1000.0)
                .put("d", d == C.TIME_UNSET || player.isCurrentMediaItemLive() ? -1 : d / 1000.0)
                .put("b", player.getBufferedPosition() / 1000.0)
                .put("p", !player.getPlayWhenReady())
                .put("r", player.getPlaybackState() == Player.STATE_READY ? 4 : player.getPlaybackState() == Player.STATE_BUFFERING ? 1 : 0)
                .put("w", vw).put("h", vh);
        return j;
    }

    private void send(Json j) {
        web.evaluateJavascript("window.__exo&&window.__exo(" + j + ")", null);
    }

    @Override
    public void onPlaybackStateChanged(int s) {
        if (player == null) return;
        if (s == Player.STATE_BUFFERING) send(state("waiting"));
        else if (s == Player.STATE_READY) {
            if (!sentMeta) {
                sentMeta = true;
                send(state("loadedmetadata"));
            }
            send(state("canplay"));
            if (player.isPlaying()) send(state("playing"));
        } else if (s == Player.STATE_ENDED) send(state("ended"));
    }

    @Override
    public void onIsPlayingChanged(boolean playing) {
        if (player != null && playing) send(state("playing"));
    }

    @Override
    public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
        if (player != null) send(state(playWhenReady ? "play" : "pause"));
    }

    @Override
    public void onPlayerError(PlaybackException e) {
        if (player == null) return;
        if (e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player.seekToDefaultPosition();
            player.prepare();
            return;
        }
        // 2xxx = rede e servidor; o resto (leitura do arquivo, decodificação) é formato
        boolean network = e.errorCode >= 2000 && e.errorCode < 3000;
        send(event("error").put("kind", network ? "network" : "format").put("code", e.getErrorCodeName()));
    }

    @Override
    public void onVideoSizeChanged(VideoSize s) {
        vw = s.width;
        vh = s.height;
        par = s.pixelWidthHeightRatio > 0 ? s.pixelWidthHeightRatio : 1;
        layout();
        if (player != null) send(state("resize"));
    }

    @Override
    public void onTracksChanged(Tracks tracks) {
        JSONArray audio = new JSONArray(), text = new JSONArray();
        List<Tracks.Group> groups = tracks.getGroups();
        for (int g = 0; g < groups.size(); g++) {
            Tracks.Group group = groups.get(g);
            int type = group.getType();
            if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) continue;
                Format f = group.getTrackFormat(i);
                JSONObject t = new JSONObject();
                try {
                    t.put("id", g + ":" + i);
                    t.put("name", f.label == null ? "" : f.label);
                    t.put("lang", f.language == null ? "" : f.language);
                    t.put("on", group.isTrackSelected(i));
                    if (type == C.TRACK_TYPE_AUDIO && f.channelCount > 0) t.put("ch", f.channelCount);
                } catch (JSONException ignored) {
                }
                (type == C.TRACK_TYPE_AUDIO ? audio : text).put(t);
            }
        }
        send(event("tracks").put("audio", audio).put("text", text));
    }

    @Override
    public void onCues(CueGroup group) {
        StringBuilder sb = new StringBuilder();
        for (Cue c : group.cues) {
            if (c.text == null) continue;
            if (sb.length() > 0) sb.append('\n');
            sb.append(c.text);
        }
        String text = sb.toString();
        if (text.equals(lastCue)) return;
        lastCue = text;
        send(event("cue").put("text", text));
    }

    /** JSONObject sem exceção checada, para encadear. */
    private static final class Json {
        private final JSONObject o = new JSONObject();

        Json put(String k, Object v) {
            try {
                o.put(k, v);
            } catch (JSONException ignored) {
            }
            return this;
        }

        Json put(String k, double v) {
            try {
                o.put(k, Double.isNaN(v) || Double.isInfinite(v) ? 0 : v);
            } catch (JSONException ignored) {
            }
            return this;
        }

        @Override
        public String toString() { return o.toString(); }
    }
}
