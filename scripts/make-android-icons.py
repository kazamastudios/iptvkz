# Ícone do app Android (celular e TV), versão oficial (vermelha).
# - mipmap-xxxhdpi/ic_launcher.png: quadrado CHEIO, sem cantos transparentes. A Google Play recusa app de Android TV
#   cujo ícone "não preenche todo o espaço" (diretrizes de qualidade para TV).
# - mipmap-xxxhdpi/ic_launcher_fg.png + mipmap-anydpi-v26/ic_launcher*.xml: ícone adaptável do Android 8+. O desenho
#   ocupa a área visível (72 dp de 108 dp) e o fundo é preto, então a forma do launcher (círculo, quadrado) recorta só
#   o brilho das bordas, nunca a TV nem o "KZ".
# O Beta (âmbar, faixa BETA) sai de scripts/make-beta-icons.py; as cores de tema, de scripts/make-theme-icons.py
# (rode este, depois o make-beta-icons.py, depois o make-theme-icons.py).
# Uso: python scripts/make-android-icons.py
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "platforms", "android", "app", "src")
THEMES = ["blue", "green", "purple", "pink", "cyan"]
XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- Gerado por scripts/make-android-icons.py -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@android:color/black" />
    <foreground android:drawable="@mipmap/{fg}" />
</adaptive-icon>
"""


def full_bleed():
    """O desenho de assets/brand/icon-master.png sem a moldura arredondada (o mesmo recorte do ícone da Play)."""
    m = Image.open(os.path.join(ROOT, "assets", "brand", "icon-master.png")).convert("RGBA")
    return m.crop((95, 95, m.width - 95, m.height - 95))


def foreground(full):
    """Camada da frente do ícone adaptável: 108 dp (432 px em xxxhdpi) com o desenho nos 72 dp do meio."""
    fg = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    fg.alpha_composite(full.resize((288, 288), Image.LANCZOS), (72, 72))
    return fg


def write(path, data=None, image=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if image is not None:
        image.save(path, optimize=True)
    else:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(data)
    print(os.path.relpath(path, ROOT))


def main():
    full = full_bleed()
    res = os.path.join(SRC, "main", "res")
    write(os.path.join(res, "mipmap-xxxhdpi", "ic_launcher.png"), image=full.resize((192, 192), Image.LANCZOS).convert("RGB"))
    write(os.path.join(res, "mipmap-xxxhdpi", "ic_launcher_fg.png"), image=foreground(full))
    # XMLs do ícone adaptável: o padrão e uma por cor de tema, no oficial e no Beta (cada um usa a própria camada)
    for variant in ("main", "beta"):
        d = os.path.join(SRC, variant, "res", "mipmap-anydpi-v26")
        write(os.path.join(d, "ic_launcher.xml"), XML.format(fg="ic_launcher_fg"))
        for t in THEMES:
            write(os.path.join(d, f"ic_launcher_{t}.xml"), XML.format(fg=f"ic_launcher_fg_{t}"))


if __name__ == "__main__":
    main()
