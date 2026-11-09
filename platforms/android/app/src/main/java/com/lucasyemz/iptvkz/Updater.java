package com.lucasyemz.iptvkz;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.function.IntConsumer;

/**
 * Atualização pelo GitHub Releases. O manifesto é assinado com a chave do projeto.
 * Mudanças na interface/servidor chegam em silêncio e valem na próxima abertura;
 * mudanças no app Android baixam o APK e pedem a confirmação do sistema.
 */
final class Updater {
    private static final String TAG = "IPTVKZ-update";
    private static final String BASE = BuildConfig.UPDATE_BASE;
    private static final long CHECK_EVERY_MS = 6 * 60 * 60 * 1000L;
    private static final int BOOT_TIMEOUT_MS = 4000;
    private static long lastCheck;
    private static boolean running;

    private final Activity activity;

    Updater(Activity activity) { this.activity = activity; }

    /** Etapas mostradas na abertura. */
    interface Progress {
        void download(int percent);
        void installing();
    }

    /** Na abertura, antes do servidor: baixa o pacote novo, que o Bundles.prepare aplica em seguida. */
    void atBoot(Progress p) throws Exception {
        byte[] body = fetch(BASE + "android-update.json", BOOT_TIMEOUT_MS);
        byte[] sig = Base64.decode(fetch(BASE + "android-update.json.sig", BOOT_TIMEOUT_MS), Base64.DEFAULT);
        if (!verified(body, sig)) throw new SecurityException("Assinatura do manifesto inválida");
        JSONObject m = new JSONObject(new String(body, StandardCharsets.UTF_8));
        // APK novo precisa da confirmação do sistema: fica para o checkIfDue, com o app já aberto
        if (m.getInt("nativeVersion") != BuildConfig.VERSION_CODE) return;
        synchronized (Updater.class) { lastCheck = System.currentTimeMillis(); }
        int bundle = m.getInt("bundleVersion");
        if (bundle <= Bundles.newest(activity) || bundle <= Bundles.rejected(activity)) return;
        p.download(0);
        stage(bundle, download(m.getString("bundle"), m.getString("bundleSha256"), "bundle.zip", p::download));
        p.installing();
    }

    private void stage(int bundle, File tmp) throws IOException {
        File versionTmp = new File(activity.getCacheDir(), "bundle.version");
        Files.write(versionTmp.toPath(), String.valueOf(bundle).getBytes(StandardCharsets.UTF_8));
        if (!tmp.renameTo(Bundles.staged(activity)) || !versionTmp.renameTo(Bundles.stagedVersion(activity))) {
            throw new IOException("Não foi possível guardar a atualização");
        }
    }

    void checkIfDue() {
        long now = System.currentTimeMillis();
        synchronized (Updater.class) {
            if (running || now - lastCheck < CHECK_EVERY_MS) return;
            running = true;
            lastCheck = now;
        }
        new Thread(() -> {
            try {
                check();
            } catch (Exception e) {
                Log.w(TAG, "Falha ao verificar atualização", e);
            } finally {
                synchronized (Updater.class) { running = false; }
            }
        }, "updater").start();
    }

    private void check() throws Exception {
        byte[] body = fetch(BASE + "android-update.json");
        byte[] sig = Base64.decode(fetch(BASE + "android-update.json.sig"), Base64.DEFAULT);
        if (!verified(body, sig)) throw new SecurityException("Assinatura do manifesto inválida");
        JSONObject m = new JSONObject(new String(body, StandardCharsets.UTF_8));

        int nativeVersion = m.getInt("nativeVersion");
        if (nativeVersion > BuildConfig.VERSION_CODE) {
            String name = m.optString("nativeName", "");
            activity.runOnUiThread(() -> offerApk(name, m.optString("apk"), m.optString("apkSha256")));
            return;
        }
        if (nativeVersion < BuildConfig.VERSION_CODE) return;

        int bundle = m.getInt("bundleVersion");
        if (bundle <= Bundles.newest(activity) || bundle <= Bundles.rejected(activity)) return;
        stage(bundle, download(m.getString("bundle"), m.getString("bundleSha256"), "bundle.zip", null));
        activity.runOnUiThread(() -> Toast.makeText(activity,
                "Atualização pronta: vale na próxima vez que abrir o IPTVKZ", Toast.LENGTH_LONG).show());
    }

    private void offerApk(String name, String file, String sha) {
        if (activity.isFinishing()) return;
        new AlertDialog.Builder(activity)
                .setTitle("Nova versão do IPTVKZ")
                .setMessage("A versão " + name + " está disponível. Deseja atualizar agora?")
                .setPositiveButton("Atualizar", (d, w) -> installApk(file, sha))
                .setNegativeButton("Depois", null)
                .show();
    }

    private void installApk(String file, String sha) {
        Toast.makeText(activity, "Baixando atualização…", Toast.LENGTH_LONG).show();
        new Thread(() -> {
            try {
                File apk = download(file, sha, "IPTVKZ.apk", null);
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", apk);
                Intent i = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.runOnUiThread(() -> activity.startActivity(i));
            } catch (Exception e) {
                Log.w(TAG, "Falha ao baixar o APK", e);
                activity.runOnUiThread(() -> Toast.makeText(activity,
                        "Não foi possível baixar a atualização", Toast.LENGTH_LONG).show());
            }
        }, "updater-apk").start();
    }

    private boolean verified(byte[] body, byte[] signature) throws Exception {
        byte[] der = Base64.decode(activity.getString(R.string.update_public_key), Base64.DEFAULT);
        PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
        Signature s = Signature.getInstance("SHA256withRSA");
        s.initVerify(key);
        s.update(body);
        return s.verify(signature);
    }

    private static HttpURLConnection open(String url) throws IOException {
        return open(url, 15000);
    }

    private static HttpURLConnection open(String url, int timeoutMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(timeoutMs);
        c.setReadTimeout(2 * timeoutMs);
        c.setRequestProperty("User-Agent", "IPTVKZ-Android");
        if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode() + " em " + url);
        return c;
    }

    private static byte[] fetch(String url) throws IOException {
        return fetch(url, 15000);
    }

    private static byte[] fetch(String url, int timeoutMs) throws IOException {
        HttpURLConnection c = open(url, timeoutMs);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    private File download(String name, String sha256, String localName, IntConsumer onPercent) throws Exception {
        File dir = new File(activity.getCacheDir(), "updates");
        dir.mkdirs();
        File target = new File(dir, localName);
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        HttpURLConnection c = open(BASE + name);
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(target)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            long got = 0;
            int total = c.getContentLength();
            int last = -1;
            while ((n = in.read(buf)) > 0) {
                md.update(buf, 0, n);
                out.write(buf, 0, n);
                got += n;
                int percent = total > 0 ? (int) (got * 100 / total) : 0;
                if (onPercent != null && percent != last) {
                    last = percent;
                    onPercent.accept(percent);
                }
            }
        } finally {
            c.disconnect();
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : md.digest()) hex.append(String.format("%02x", b));
        if (!hex.toString().equalsIgnoreCase(sha256)) {
            target.delete();
            throw new SecurityException("Arquivo baixado não confere");
        }
        return target;
    }
}
