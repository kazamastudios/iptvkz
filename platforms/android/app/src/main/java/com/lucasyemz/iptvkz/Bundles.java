package com.lucasyemz.iptvkz;

import android.content.Context;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Mantém o pacote do servidor e da interface: o que veio no APK ou o baixado por atualização. */
final class Bundles {
    private static final String PREFS = "updates";
    private static final String REJECTED = "rejected_bundle";

    private Bundles() {}

    static File dir(Context c) { return new File(c.getFilesDir(), "bundle"); }
    static File staged(Context c) { return new File(c.getFilesDir(), "bundle-staged.zip"); }
    static File stagedVersion(Context c) { return new File(c.getFilesDir(), "bundle-staged.version"); }

    static int installed(Context c) { return readInt(new File(dir(c), "version.txt")); }

    /** Versão mais nova já disponível no aparelho, aplicada ou aguardando a próxima abertura. */
    static int newest(Context c) {
        return Math.max(Math.max(installed(c), BuildConfig.BUNDLE_VERSION), readInt(stagedVersion(c)));
    }

    static int rejected(Context c) {
        return c.getSharedPreferences(PREFS, 0).getInt(REJECTED, 0);
    }

    /** Antes de iniciar o Node: aplica o pacote baixado ou atualiza a partir do APK. */
    static void prepare(Context c) throws IOException {
        int current = installed(c);
        int builtin = BuildConfig.BUNDLE_VERSION;
        File zip = staged(c);
        int stagedVer = readInt(stagedVersion(c));
        if (zip.exists() && stagedVer > Math.max(current, builtin)) {
            try (InputStream in = new FileInputStream(zip)) {
                install(c, in);
            }
        } else if (current < builtin) {
            try (InputStream in = c.getAssets().open("bundle.zip")) {
                install(c, in);
            }
        }
        zip.delete();
        stagedVersion(c).delete();
    }

    /** O pacote baixado não subiu: volta ao do APK e não tenta essa versão de novo. */
    static boolean rollback(Context c) {
        int current = installed(c);
        if (current <= BuildConfig.BUNDLE_VERSION) return false;
        c.getSharedPreferences(PREFS, 0).edit().putInt(REJECTED, current).commit();
        deleteTree(dir(c));
        return true;
    }

    private static void install(Context c, InputStream source) throws IOException {
        File tmp = new File(c.getFilesDir(), "bundle.tmp");
        deleteTree(tmp);
        unzip(source, tmp);
        if (readInt(new File(tmp, "version.txt")) <= 0) throw new IOException("Pacote inválido");
        File target = dir(c);
        deleteTree(target);
        if (!tmp.renameTo(target)) throw new IOException("Não foi possível instalar o pacote");
    }

    private static void unzip(InputStream source, File into) throws IOException {
        String root = into.getCanonicalPath() + File.separator;
        byte[] buf = new byte[64 * 1024];
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(source))) {
            ZipEntry e;
            while ((e = zip.getNextEntry()) != null) {
                File out = new File(into, e.getName());
                if (!out.getCanonicalPath().startsWith(root)) throw new IOException("Caminho inválido");
                if (e.isDirectory()) {
                    out.mkdirs();
                    continue;
                }
                out.getParentFile().mkdirs();
                try (OutputStream o = new FileOutputStream(out)) {
                    int n;
                    while ((n = zip.read(buf)) > 0) o.write(buf, 0, n);
                }
            }
        }
    }

    static int readInt(File f) {
        try {
            return Integer.parseInt(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim());
        } catch (IOException | NumberFormatException e) {
            return 0;
        }
    }

    static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
