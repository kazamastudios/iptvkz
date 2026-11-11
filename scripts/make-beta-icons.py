# Gera os ícones do app de testes "IPTVKZ Beta" a partir dos originais: o vermelho vira âmbar (a cor do selo
# "Beta" do app) e entra uma faixa diagonal BETA no canto. Rode de novo se o ícone original mudar: python scripts/make-beta-icons.py
# Saídas: assets/brand/*-beta*, platforms/windows/iptvkz-beta.ico, platforms/android/app/src/beta/res/,
# platforms/webos/beta/. Só os builds de teste usam (scripts/build-desktop.js, build-ipk.js, build.gradle).
import colorsys
import os
from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
P = lambda *a: os.path.join(ROOT, *a)
AMBER = (255, 181, 71, 255)
DARK = (24, 14, 4, 255)
FONT = next(f for f in ["C:/Windows/Fonts/seguibl.ttf", "C:/Windows/Fonts/arialbd.ttf",
                        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"] if os.path.exists(f))


def amber(im):
    """Vermelhos viram âmbar; o resto (branco, preto) fica igual."""
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s > 0.35 and (h < 0.08 or h > 0.92):
                r2, g2, b2 = colorsys.hsv_to_rgb(0.105, s, v)
                px[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
    return im


def ribbon(im, band_ratio=0.14, offset_ratio=0.19):
    """Faixa diagonal BETA no canto de cima à direita, recortada no formato do ícone."""
    im = im.copy()
    W, H = im.size
    S = max(W, H)
    band = round(S * band_ratio)
    layer = Image.new("RGBA", (S * 2, S * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle((0, S - band // 2, S * 2, S + band // 2), fill=AMBER)
    edge = max(1, round(band / 14))  # filetes escuros: a faixa não some no brilho âmbar do ícone
    d.rectangle((0, S - band // 2, S * 2, S - band // 2 + edge), fill=DARK)
    d.rectangle((0, S + band // 2 - edge, S * 2, S + band // 2), fill=DARK)
    f = ImageFont.truetype(FONT, round(band * 0.62))
    d.text((S, S + band * 0.02), "BETA", font=f, fill=DARK, anchor="mm")
    layer = layer.rotate(-45, resample=Image.BICUBIC)
    off = round(S * offset_ratio)
    # o centro da faixa (o meio da camada girada) cai em (W - off, off): perto do canto de cima à direita
    region = layer.crop((S + off - W, S - off, S + off, S - off + H))
    mask = ImageChops.multiply(region.getchannel("A"), im.getchannel("A"))
    region.putalpha(mask)
    im.alpha_composite(region)
    return im


def square(src, size, with_badge=True):
    """Ícone quadrado: âmbar em alta resolução, faixa BETA no canto, depois reduz (o texto sai nítido)."""
    big = amber(Image.open(src))
    W = big.width
    if with_badge:
        big = ribbon(big)
    return big.resize((size, size), Image.LANCZOS)


def save(im, *path):
    os.makedirs(os.path.dirname(P(*path)), exist_ok=True)
    im.save(P(*path))
    print("ok", os.path.join(*path), im.size)


master = P("assets", "brand", "icon-1024.png")
save(square(master, 1024), "assets", "brand", "icon-beta-1024.png")
save(square(P("assets", "brand", "icon-mac-1024.png"), 1024), "assets", "brand", "icon-mac-beta-1024.png")
save(square(master, 64, with_badge=False), "assets", "brand", "icon-small-beta-64.png")  # bandeja: pequeno demais para texto

# Windows: tamanhos grandes com o selo, os pequenos (barra de tarefas) só na cor
ico_big = square(master, 256)
ico_small = square(master, 48, with_badge=False)
os.makedirs(P("platforms", "windows"), exist_ok=True)
ico_big.save(P("platforms", "windows", "iptvkz-beta.ico"), sizes=[(256, 256), (128, 128), (64, 64)],
             append_images=[ico_small.resize((s, s), Image.LANCZOS) for s in (48, 32, 24, 16)])
print("ok platforms/windows/iptvkz-beta.ico")

# Android TV: ícone e banner
save(square(master, 192), "platforms", "android", "app", "src", "beta", "res", "mipmap-xxxhdpi", "ic_launcher.png")
for dens, (bw, bh) in (("xhdpi", (320, 180)), ("xxxhdpi", (640, 360))):
    src = P("platforms", "android", "app", "src", "main", "res", "drawable-xxxhdpi", "banner.png")
    ban = amber(Image.open(src)).resize((bw * 2, bh * 2), Image.LANCZOS)
    ban = ribbon(ban, band_ratio=0.10, offset_ratio=0.11)
    save(ban.resize((bw, bh), Image.LANCZOS), "platforms", "android", "app", "src", "beta", "res", f"drawable-{dens}", "banner.png")

# LG: 80x80 e 130x130
save(square(master, 130), "platforms", "webos", "beta", "largeIcon.png")
save(square(master, 80), "platforms", "webos", "beta", "icon.png")
