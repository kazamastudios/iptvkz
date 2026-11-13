package com.lucasyemz.iptvkz;

import android.app.Activity;

/**
 * Versão da Google Play: quem atualiza é a loja. Não baixa pacote nem APK e não acessa o GitHub
 * (política de Dynamic Code Loading). Mesma interface do Updater do canal Developer.
 */
final class Updater {
    static final boolean ENABLED = false;

    Updater(Activity activity) {}

    interface Progress {
        void download(int percent);
        void installing();
    }

    void atBoot(Progress p) {}

    void checkIfDue() {}
}
