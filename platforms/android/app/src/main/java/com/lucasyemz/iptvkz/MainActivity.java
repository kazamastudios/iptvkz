package com.lucasyemz.iptvkz;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.File;

/** Inicia o servidor embutido e mostra a interface do IPTVKZ em tela cheia. */
public class MainActivity extends Activity {
    private static final String TAG = "IPTVKZ";
    private static final long START_TIMEOUT_MS = 45000;
    private static boolean nodeStarted;

    static {
        System.loadLibrary("native-lib");
        System.loadLibrary("node");
    }

    private static native int startNode(String[] args);

    private final Handler main = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private View fullscreen;
    private Updater updater;
    private boolean ready;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        createWebView();
        updater = new Updater(this);
        new Thread(this::boot, "boot").start();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " SmartTV IPTVKZ-Android");
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void exit() { main.post(MainActivity.this::quit); }
        }, "IPTVKZAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return false; }

            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript("window.close=function(){IPTVKZAndroid.exit()}", null);
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

    private void boot() {
        File port = new File(getFilesDir(), "port");
        try {
            synchronized (MainActivity.class) {
                if (!nodeStarted) {
                    port.delete();
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
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
