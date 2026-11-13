package com.lucasyemz.iptvkz;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.File;
import java.io.InputStream;
import java.net.Inet4Address;
import java.util.concurrent.atomic.AtomicLong;

/** Inicia o servidor embutido e mostra a interface do IPTVKZ em tela cheia. */
public class MainActivity extends Activity {
    private static final String TAG = "IPTVKZ";
    private static final long START_TIMEOUT_MS = 45000;
    private static final long CHECK_LIMIT_MS = 8000;
    private static final long STALL_LIMIT_MS = 45000;
    private static boolean nodeStarted;

    static {
        System.loadLibrary("native-lib");
        System.loadLibrary("node");
    }

    private static native int startNode(String[] args);

    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean isTv;
    private FrameLayout root;
    private WebView web;
    private View fullscreen;
    private NativeVideo video;
    private Updater updater;
    private boolean ready;
    private View splash;
    private ProgressBar bar;
    private TextView message;
    private volatile boolean keyboardVisible;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Celular: a página encolhe para o campo não ficar atrás do teclado (e, antes do Android 11, é assim que o app
        // fica sabendo que o teclado abriu). TV: o teclado fica por cima e a página mantém o tamanho; encolhida, a
        // barra lateral não cabia, ganhava barra de rolagem e a tela inteira se mexia.
        boolean tv = getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
        isTv = tv;
        // Como os apps de streaming: na TV, sempre deitado; no celular, as telas em pé e o vídeo deitado
        // (setVideoLandscape, chamado pelo player); no tablet, gira à vontade.
        setRequestedOrientation(baseOrientation());
        getWindow().setSoftInputMode(tv && Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
                : WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        watchKeyboard();
        createWebView();
        createSplash();
        updater = new Updater(this);
        new Thread(this::boot, "boot").start();
    }

    /** Fundo igual ao da splash da interface (.tv #splash em app.css). */
    private Drawable splashBackground(int width) {
        GradientDrawable top = new GradientDrawable();
        top.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        // Beta: âmbar no lugar do vermelho, igual ao tema do app (html.beta em app.css)
        int[] c1 = BuildConfig.IS_BETA ? new int[] {77, 50, 8} : new int[] {77, 13, 18};
        int[] c2 = BuildConfig.IS_BETA ? new int[] {58, 36, 6} : new int[] {58, 7, 22};
        top.setColors(new int[] {Color.rgb(c1[0], c1[1], c1[2]), Color.argb(0, c1[0], c1[1], c1[2])});
        top.setGradientCenter(0.2f, 0f);
        top.setGradientRadius(width * 0.55f);
        GradientDrawable bottom = new GradientDrawable();
        bottom.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        bottom.setColors(new int[] {Color.rgb(c2[0], c2[1], c2[2]), Color.argb(0, c2[0], c2[1], c2[2])});
        bottom.setGradientCenter(0.9f, 1f);
        bottom.setGradientRadius(width * 0.5f);
        return new LayerDrawable(new Drawable[] {new ColorDrawable(Color.rgb(6, 6, 9)), top, bottom});
    }

    /**
     * Abertura: mesma logo, barra e posição da splash da interface, para a troca não aparecer.
     * Sai quando a interface termina de carregar.
     */
    private void createSplash() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        float dp = getResources().getDisplayMetrics().density;
        int width = getResources().getDisplayMetrics().widthPixels;
        box.setBackground(splashBackground(width));
        // Mesmas medidas da abertura da LG e da interface (em fração da largura, referência 1920px): logo 39,4%,
        // barra 25%. O texto fica abaixo da barra; o espaço igual em cima mantém logo e barra no centro exato.
        int textHeight = Math.round(width * 0.03229f);
        box.addView(new View(this), new LinearLayout.LayoutParams(1, textHeight));
        ImageView logo = new ImageView(this);
        int logoWidth = Math.round(width * 0.39375f);
        int logoHeight = logoWidth / 3;
        try (InputStream in = getAssets().open("logo-horizontal.webp")) {
            Bitmap image = BitmapFactory.decodeStream(in);
            logo.setImageBitmap(image);
            logoHeight = logoWidth * image.getHeight() / image.getWidth();
        } catch (Exception e) {
            Log.w(TAG, "Logo da abertura indisponível", e);
        }
        box.addView(logo, new LinearLayout.LayoutParams(logoWidth, logoHeight));
        ColorStateList red = ColorStateList.valueOf(BuildConfig.IS_BETA ? Color.rgb(255, 181, 71) : Color.rgb(255, 42, 42));
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setIndeterminate(true);
        bar.setProgressTintList(red);
        bar.setIndeterminateTintList(red);
        bar.setProgressBackgroundTintList(ColorStateList.valueOf(Color.argb(31, 255, 255, 255)));
        LinearLayout.LayoutParams barSize = new LinearLayout.LayoutParams(Math.round(width * 0.25f), Math.max(2, Math.round(width * 0.003125f)));
        barSize.topMargin = Math.round(width * 0.025f);
        box.addView(bar, barSize);
        message = new TextView(this);
        message.setTextColor(Color.rgb(201, 201, 216));
        message.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, width * 0.01458f);
        message.setPadding(0, Math.round(width * 0.01146f), 0, 0);
        message.setGravity(Gravity.CENTER);
        message.setText(Updater.ENABLED ? "Verificando se há atualizações" : "Abrindo");
        box.addView(message, new LinearLayout.LayoutParams(-1, textHeight));
        splash = box;
        root.addView(splash, new ViewGroup.LayoutParams(-1, -1));
    }

    private void showStep(String text, int percent) {
        main.post(() -> {
            if (splash == null) return;
            message.setText(text);
            bar.setIndeterminate(percent < 0);
            if (percent >= 0) bar.setProgress(percent);
        });
    }

    private void hideSplash() {
        if (splash != null) root.removeView(splash);
        splash = null;
    }

    /** Sem internet ou com o GitHub fora, desiste logo e abre com a versão que já tem. */
    private void updateAtBoot() throws InterruptedException {
        if (!Updater.ENABLED) return;
        AtomicLong limit = new AtomicLong(System.currentTimeMillis() + CHECK_LIMIT_MS);
        Thread t = new Thread(() -> {
            try {
                updater.atBoot(new Updater.Progress() {
                    @Override
                    public void download(int percent) {
                        limit.set(System.currentTimeMillis() + STALL_LIMIT_MS);
                        showStep("Baixando atualização " + percent + "%", percent);
                    }

                    @Override
                    public void installing() {
                        limit.set(System.currentTimeMillis() + STALL_LIMIT_MS);
                        showStep("Instalando atualização", 100);
                    }
                });
            } catch (Exception e) {
                Log.w(TAG, "Atualização na abertura", e);
            }
        }, "boot-update");
        t.start();
        while (t.isAlive() && System.currentTimeMillis() < limit.get()) Thread.sleep(100);
    }

    /** Endereço na rede de casa, para o QR Code. O Node não consegue ler isso no Android 11+. */
    private String lanAddress() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            Network net = cm.getActiveNetwork();
            LinkProperties props = net == null ? null : cm.getLinkProperties(net);
            if (props == null) return "";
            for (LinkAddress a : props.getLinkAddresses()) {
                if (a.getAddress() instanceof Inet4Address && a.getAddress().isSiteLocalAddress()) {
                    return a.getAddress().getHostAddress();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Endereço de rede indisponível", e);
        }
        return "";
    }

    /**
     * Avisa a interface quando o teclado do sistema abre ou fecha, com o mesmo evento da LG
     * (keyboardStateChange). Assim a busca por voz funciona igual nos dois.
     */
    private void watchKeyboard() {
        View decor = getWindow().getDecorView();
        decor.setOnApplyWindowInsetsListener((v, insets) -> {
            fitSystemBars(insets);
            boolean visible;
            if (Build.VERSION.SDK_INT >= 30) {
                visible = insets.isVisible(WindowInsets.Type.ime());
            } else {
                visible = insets.getSystemWindowInsetBottom() > v.getHeight() * 0.15f;
            }
            if (visible != keyboardVisible) {
                keyboardVisible = visible;
                if (web != null) {
                    web.evaluateJavascript("document.dispatchEvent(new CustomEvent('keyboardStateChange',"
                            + "{detail:{visibility:" + visible + "}}))", null);
                }
            }
            return v.onApplyWindowInsets(insets);
        });
    }

    /** Abre o teclado do sistema no campo que a interface acabou de focar. */
    private void showKeyboard() {
        // Só pede o foco se o WebView ainda não tem: com ele já focado, o pedido faz a página "entrar de novo" e o
        // foco pula para o primeiro item (o logo do menu); o campo perde o foco e o teclado, recém-aberto, fecha.
        if (!web.hasFocus()) web.requestFocus();
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) imm.showSoftInput(web, 0);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    /**
     * Vídeo deitado no celular: usa a tela inteira, sem a barra de navegação e também na área do recorte da câmera,
     * para o vídeo ficar o maior possível sem cortar nada (ele continua inteiro, só ganha o espaço das barras).
     * As barras voltam deslizando da borda. Ao sair, a barra de navegação volta.
     */
    @SuppressWarnings("deprecation")
    private void immersive(boolean on) {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = on ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            w.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c == null) return;
            if (on) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.navigationBars() | WindowInsets.Type.statusBars());
            } else c.show(WindowInsets.Type.navigationBars());
        } else {
            w.getDecorView().setSystemUiVisibility(on
                    ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
                    : View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    /**
     * Android 15+ (targetSdk 35 ou mais): o app desenha por baixo das barras do sistema e o teclado não encolhe
     * mais a janela sozinho. O app reserva esse espaço: as barras e o recorte da câmera nas bordas, e embaixo
     * o maior entre a barra de navegação e o teclado (no celular; na TV o teclado fica por cima, como antes).
     * No vídeo em tela cheia as barras somem e o espaço volta para o vídeo.
     */
    private void fitSystemBars(WindowInsets insets) {
        if (Build.VERSION.SDK_INT < 35 || root == null) return;
        android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        int bottom = bars.bottom;
        if (!isTv) bottom = Math.max(bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
        root.setPadding(bars.left, bars.top, bars.right, bottom);
    }

    private int baseOrientation() {
        if (isTv) return ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        return getResources().getConfiguration().smallestScreenWidthDp >= 600
                ? ActivityInfo.SCREEN_ORIENTATION_FULL_USER
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
    }

    private void createWebView() {
        // app Beta (build no PC): a página pode ser inspecionada pelo PC (chrome://inspect), para testar no aparelho
        if (getPackageName().endsWith(".beta")) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // sem zoom de pinça nem de toque duplo: um zoom sem querer bagunçava a tela
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // A interface vem toda do servidor local; o WebView não precisa ler arquivos do aparelho.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // só a TV se apresenta como TV: no celular a página usa o modo de toque
        s.setUserAgentString(s.getUserAgentString() + (isTv ? " SmartTV" : "") + " IPTVKZ-Android");
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void exit() { main.post(MainActivity.this::quit); }

            @JavascriptInterface
            public String lanAddress() { return MainActivity.this.lanAddress(); }

            // Espera o foco do campo chegar ao WebView antes de pedir o teclado.
            @JavascriptInterface
            public void showKeyboard() { main.postDelayed(MainActivity.this::showKeyboard, 150); }

            @JavascriptInterface
            public boolean isKeyboardVisible() { return keyboardVisible; }

            // vídeo em tela cheia (filme, série, canal ampliado): deita a tela; ao sair, volta ao normal do aparelho
            @JavascriptInterface
            public void setVideoLandscape(boolean on) {
                main.post(() -> {
                    if (isTv) return;
                    setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : baseOrientation());
                    immersive(on);
                });
            }
        }, "IPTVKZAndroid");
        video = new NativeVideo(this, root, web);
        web.addJavascriptInterface(video, "IPTVKZVideo");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                // A tela principal fica no servidor local, que é quem tem acesso à ponte IPTVKZAndroid.
                // Quadros internos (trailer do YouTube) seguem livres.
                return r.isForMainFrame() && !isLocalPage(r.getUrl());
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript("window.close=function(){IPTVKZAndroid.exit()}", null);
                hideSplash();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                fullscreen = view;
                root.addView(view, new ViewGroup.LayoutParams(-1, -1));
            }

            @Override
            public void onHideCustomView() {
                if (fullscreen != null) root.removeView(fullscreen);
                fullscreen = null;
            }
        });
        root.addView(web, new ViewGroup.LayoutParams(-1, -1));
        web.requestFocus();
    }

    /** Endereço do próprio servidor embutido (http://127.0.0.1:porta). */
    private static boolean isLocalPage(Uri u) {
        return "http".equals(u.getScheme()) && "127.0.0.1".equals(u.getHost());
    }

    private void boot() {
        File port = new File(getFilesDir(), "port");
        try {
            synchronized (MainActivity.class) {
                if (!nodeStarted) {
                    port.delete();
                    updateAtBoot();
                    Bundles.prepare(this);
                    String entry = new File(Bundles.dir(this), "main.js").getAbsolutePath();
                    String base = getFilesDir().getAbsolutePath();
                    new Thread(null, () -> {
                        int code = startNode(new String[]{"node", entry, base});
                        Log.e(TAG, "Node encerrou: " + code);
                    }, "node", 16 * 1024 * 1024).start();
                    nodeStarted = true;
                }
            }
            long limit = System.currentTimeMillis() + START_TIMEOUT_MS;
            while (!port.exists() && System.currentTimeMillis() < limit) Thread.sleep(100);
            if (!port.exists()) throw new IllegalStateException("O servidor não iniciou");
            int p = Bundles.readInt(port);
            showStep("Abrindo", 100);
            main.post(() -> {
                ready = true;
                web.loadUrl("http://127.0.0.1:" + p + "/");
                updater.checkIfDue();
            });
        } catch (Exception e) {
            Log.e(TAG, "Falha ao iniciar", e);
            if (Bundles.rollback(this)) {
                main.post(this::restart);
            } else {
                main.post(() -> showError());
            }
        }
    }

    private void showError() {
        hideSplash();
        TextView t = new TextView(this);
        t.setTextColor(Color.WHITE);
        t.setTextSize(22);
        t.setPadding(80, 80, 80, 80);
        t.setText("Não foi possível iniciar o IPTVKZ. Feche e abra o aplicativo de novo.");
        root.addView(t);
    }

    private void restart() {
        Intent i = new Intent(this, MainActivity.class);
        PendingIntent p = PendingIntent.getActivity(this, 1, i,
                PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        ((AlarmManager) getSystemService(ALARM_SERVICE)).set(AlarmManager.RTC, System.currentTimeMillis() + 400, p);
        android.os.Process.killProcess(android.os.Process.myPid());
    }

    /** Encerra o processo: o Node só inicia uma vez por processo e a próxima abertura aplica atualizações. */
    private void quit() {
        finishAndRemoveTask();
        main.postDelayed(() -> android.os.Process.killProcess(android.os.Process.myPid()), 300);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK && ready) {
            // O botão Voltar segue para o app web, que decide entre voltar de tela e sair.
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                web.evaluateJavascript("(document.activeElement||document).dispatchEvent("
                        + "new KeyboardEvent('keydown',{key:'GoBack',keyCode:461,which:461,bubbles:true,cancelable:true}))", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    protected void onStart() {
        super.onStart();
        web.onResume();
        if (ready) updater.checkIfDue();
    }

    @Override
    protected void onStop() {
        web.evaluateJavascript("document.querySelectorAll('video').forEach(function(v){v.pause()})", null);
        web.onPause();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        video.release();
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
