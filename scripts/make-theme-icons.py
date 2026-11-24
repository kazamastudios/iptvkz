# Gera o ícone e o banner da TV do Android em cada cor de tema (IPTVKZ+), para o app trocar o ícone quando a pessoa
# pedir (activity-alias em platforms/android/app/src/main/AndroidManifest.xml). A cor sai da mesma conta do CSS
# (hue-rotate e brightness de html[data-accent] em src/web/css/app.css): o vermelho do original gira para a cor do tema.
# Beta: parte dos ícones âmbar (src/beta/res, de make-beta-icons.py), com o giro do Beta e brilho 1.
# Rode de novo se o ícone original ou as cores mudarem: python scripts/make-theme-icons.py
import math
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RES = os.path.join(ROOT, "platforms", "android", "app", "src")
# cor: (giro, brilho) na versão publicada; giro do Beta (que já começa âmbar, 36° adiante)
THEMES = {
    "blue": (216, 1.15, 180),
    "green": (142, 1.3, 106),
    "purple": (268, 1.25, 228),
    "pink": (322, 1.2, 295),
    "cyan": (190, 1.9, 152),
}
FILES = ["mipmap-xxxhdpi/ic_launcher", "drawable-xhdpi/banner", "drawable-xxxhdpi/banner"]


def tint(im, deg, bright):
    """O filtro hue-rotate do navegador seguido de brightness: o branco e o preto ficam iguais."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    m = [.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928,
         .213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283,
         .213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072]
    m = [v * bright for v in m]
    r, g, b, alpha = im.convert("RGBA").split()
    rgb = Image.merge("RGB", (r, g, b)).convert("RGB", (m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0))
    return Image.merge("RGBA", (*rgb.split(), alpha))


def main():
    for variant in ("main", "beta"):
        for f in FILES:
            src = os.path.join(RES, variant, "res", f + ".png")
            im = Image.open(src)
            for name, (deg, bright, beta_deg) in THEMES.items():
                out = os.path.join(RES, variant, "res", f"{f}_{name}.webp")
                img = tint(im, beta_deg, 1) if variant == "beta" else tint(im, deg, bright)
                # WebP sem perda visível: metade do tamanho do PNG
                img.save(out, "WEBP", quality=90, method=6)
                print(os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
