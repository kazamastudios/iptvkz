package com.lucasyemz.iptvkz;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;

/**
 * Cor do tema (IPTVKZ+) na abertura nativa, antes da página carregar. A página avisa a cor que vale
 * (IPTVKZAndroid.setThemeAccent, ver src/web/js/core/theme.js) e ela fica guardada aqui para a próxima abertura.
 * Os valores são os mesmos de html[data-accent] em src/web/css/app.css: cor, fundo da abertura e o giro do tom e o
 * brilho da logo (no Beta a logo já é âmbar: outro giro e brilho 1).
 */
final class ThemeColors {
    private static final String PREFS = "theme";
    private static final String ACCENT = "accent";

    /** Cor de destaque, fundo da abertura (2 cores) e logo (giro, brilho; giro e brilho no Beta). */
    static final class Accent {
        final int[] color, splash1, splash2;
        final float hue, brightness, betaHue;

        Accent(int[] color, int[] splash1, int[] splash2, float hue, float brightness, float betaHue) {
            this.color = color;
            this.splash1 = splash1;
            this.splash2 = splash2;
            this.hue = hue;
            this.brightness = brightness;
            this.betaHue = betaHue;
        }
    }

    static Accent of(String id) {
        if (id == null) return null;
        switch (id) {
            case "blue": return new Accent(new int[] {61, 139, 255}, new int[] {18, 42, 77}, new int[] {14, 32, 59}, 216, 1.15f, 180);
            case "green": return new Accent(new int[] {34, 197, 94}, new int[] {10, 59, 28}, new int[] {8, 45, 22}, 142, 1.3f, 106);
            case "purple": return new Accent(new int[] {169, 112, 255}, new int[] {51, 34, 77}, new int[] {39, 26, 59}, 268, 1.25f, 228);
            case "pink": return new Accent(new int[] {255, 79, 163}, new int[] {77, 24, 49}, new int[] {59, 18, 38}, 322, 1.2f, 295);
            case "cyan": return new Accent(new int[] {34, 211, 238}, new int[] {10, 63, 71}, new int[] {8, 49, 55}, 190, 1.9f, 152);
            default: return null; // vermelho (ou âmbar no Beta): o padrão
        }
    }

    /** A cor guardada da última vez, ou null para o padrão. */
    static Accent saved(Context c) {
        return of(c.getSharedPreferences(PREFS, 0).getString(ACCENT, null));
    }

    static void save(Context c, String id) {
        String v = of(id) == null ? null : id;
        c.getSharedPreferences(PREFS, 0).edit().putString(ACCENT, v).apply();
    }

    /** Mesmo filtro do CSS: hue-rotate(graus) e depois brightness(b), na matriz que o navegador usa. */
    static ColorMatrixColorFilter logoFilter(Accent a, boolean beta) {
        float deg = beta ? a.betaHue : a.hue, b = beta ? 1f : a.brightness;
        double r = Math.toRadians(deg);
        float cos = (float) Math.cos(r), sin = (float) Math.sin(r);
        float[] m = {
                .213f + cos * .787f - sin * .213f, .715f - cos * .715f - sin * .715f, .072f - cos * .072f + sin * .928f, 0, 0,
                .213f - cos * .213f + sin * .143f, .715f + cos * .285f + sin * .140f, .072f - cos * .072f - sin * .283f, 0, 0,
                .213f - cos * .213f - sin * .787f, .715f - cos * .715f + sin * .715f, .072f + cos * .928f + sin * .072f, 0, 0,
                0, 0, 0, 1, 0,
        };
        for (int i = 0; i < 15; i++) if (i % 5 < 3) m[i] *= b;
        return new ColorMatrixColorFilter(new ColorMatrix(m));
    }

    // ---------- ícone do app (atalhos activity-alias do manifesto) ----------

    private static final String[] ICONS = {"blue", "green", "purple", "pink", "cyan"};

    private static ComponentName launcher(Context c, String id) {
        String suffix = id == null ? "" : Character.toUpperCase(id.charAt(0)) + id.substring(1);
        // o nome do atalho segue o namespace do código, não o pacote (o Beta tem outro applicationId)
        return new ComponentName(c.getPackageName(), "com.lucasyemz.iptvkz.Launcher" + suffix);
    }

    /** Cor do ícone que está na tela inicial ("red" para o padrão). */
    static String launcherIcon(Context c) {
        PackageManager pm = c.getPackageManager();
        for (String id : ICONS) {
            if (pm.getComponentEnabledSetting(launcher(c, id)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return id;
        }
        return "red";
    }

    /**
     * Troca o ícone: liga o atalho da cor e desliga os outros. Liga antes de desligar, para nunca ficar sem ícone.
     * Muitos launchers fecham o app nessa hora (a página avisa antes) e atalhos fixados podem sumir.
     */
    static boolean setLauncherIcon(Context c, String id) {
        String want = of(id) == null ? null : id;
        PackageManager pm = c.getPackageManager();
        int on = PackageManager.COMPONENT_ENABLED_STATE_ENABLED, off = PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        int keep = PackageManager.DONT_KILL_APP;
        try {
            pm.setComponentEnabledSetting(launcher(c, want), want == null ? PackageManager.COMPONENT_ENABLED_STATE_DEFAULT : on, keep);
            if (want != null) pm.setComponentEnabledSetting(launcher(c, null), off, keep);
            for (String other : ICONS) {
                if (!other.equals(want)) pm.setComponentEnabledSetting(launcher(c, other), PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, keep);
            }
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private ThemeColors() {
    }
}
