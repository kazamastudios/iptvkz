package com.lucasyemz.iptvkz;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Versão da Google Play: quem atualiza é a loja. Não baixa pacote nem APK e não acessa o GitHub
 * (política de Dynamic Code Loading). Só pergunta à Play se há versão nova (In-App Updates) e,
 * se houver, avisa; "Atualizar" abre a atualização da própria Play.
 */
final class Updater {
    /** Sem atualização na abertura: o app abre direto. */
    static final boolean ENABLED = false;
    private static final String TAG = "IPTVKZ-update";
    private static final long CHECK_EVERY_MS = 6 * 60 * 60 * 1000L;
    private static final int REQ_UPDATE = 4301;
    private static long lastCheck;
    /** Versão que a pessoa adiou nesta abertura: não pergunta de novo até reabrir o app. */
    private static int postponed;

    private final Activity activity;

    Updater(Activity activity) { this.activity = activity; }

    interface Progress {
        void download(int percent);
        void installing();
    }

    void atBoot(Progress p) {}

    void checkIfDue() {
        long now = System.currentTimeMillis();
        synchronized (Updater.class) {
            if (now - lastCheck < CHECK_EVERY_MS) return;
            lastCheck = now;
        }
        try {
            AppUpdateManager manager = AppUpdateManagerFactory.create(activity);
            manager.getAppUpdateInfo()
                    .addOnSuccessListener(info -> {
                        if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) return;
                        if (info.availableVersionCode() == postponed) return;
                        offer(manager, info);
                    })
                    // Fora da Play (instalado por adb, sem Play Store): não há o que perguntar.
                    .addOnFailureListener(e -> Log.i(TAG, "Play sem informação de atualização: " + e));
        } catch (Exception e) {
            Log.w(TAG, "Verificar atualização na Play", e);
        }
    }

    private void offer(AppUpdateManager manager, AppUpdateInfo info) {
        if (activity.isFinishing()) return;
        new AlertDialog.Builder(activity)
                .setTitle("Nova versão do IPTVKZ")
                .setMessage("Há uma versão nova na Google Play. Deseja atualizar agora?")
                .setPositiveButton("Atualizar", (d, w) -> update(manager, info))
                .setNegativeButton("Depois", (d, w) -> postponed = info.availableVersionCode())
                .show();
    }

    private void update(AppUpdateManager manager, AppUpdateInfo info) {
        try {
            if (info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)
                    && manager.startUpdateFlowForResult(info, activity, AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE), REQ_UPDATE)) {
                return;
            }
        } catch (Exception e) {
            Log.w(TAG, "Atualização pela Play", e);
        }
        openStore();
    }

    /** Se a Play não abrir a atualização dentro do app (alguns aparelhos de TV), abre a página do app na loja. */
    private void openStore() {
        String id = activity.getPackageName();
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + id)));
        } catch (ActivityNotFoundException e) {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + id)));
        }
    }
}
