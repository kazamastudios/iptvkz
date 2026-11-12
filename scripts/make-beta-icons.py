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

# Windows: os mesmos 9 tamanhos do ícone oficial. De 32 px para cima, o ícone âmbar com a faixa, reduzido direto
# da imagem de 1024 px. Abaixo disso, o desenho simplificado do oficial (só o "KZ"), em âmbar: o logo inteiro
# encolhido ficava borrado na barra de tarefas.
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
big = square(master, 1024)
official = Image.open(P("platforms", "windows", "iptvkz.ico"))
frames = {}
for n in SIZES:
    if n < 32:
        official.size = (n, n)
        f = amber(official.copy().convert("RGBA"))
        # cantinho âmbar no lugar da faixa (texto não cabe): o Beta se distingue até no menor tamanho
        corner = Image.new("RGBA", f.size, (0, 0, 0, 0))
        ImageDraw.Draw(corner).polygon([(n * 0.55, 0), (n, 0), (n, n * 0.45)], fill=AMBER)
        corner.putalpha(ImageChops.multiply(corner.getchannel("A"), f.getchannel("A")))
        f.alpha_composite(corner)
        frames[n] = f
    else:
        frames[n] = big.resize((n, n), Image.LANCZOS)
frames[256].save(P("platforms", "windows", "iptvkz-beta.ico"), sizes=[(n, n) for n in SIZES],
                 append_images=[frames[n] for n in SIZES if n != 256])
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

def badge(im, cx, cy, height):
    """Selo BETA (pílula âmbar, texto escuro) centrado em (cx, cy)."""
    im = im.copy()
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, round(height * 0.76))
    w = d.textlength("BETA", font=f) + height * 0.7
    d.rounded_rectangle((cx - w / 2, cy - height / 2, cx + w / 2, cy + height / 2), radius=height / 2,
                        fill=AMBER, outline=DARK, width=max(1, round(height / 18)))
    d.text((cx, cy + height * 0.03), "BETA", font=f, fill=DARK, anchor="mm")
    return im


# Logos da interface: âmbar e com a marca BETA em todo lugar onde o logo aparece. O servidor entrega estes no
# lugar dos originais quando o app é Beta (src/server/index.js).
def web(name, mark):
    src = P("src", "web", "img", name)
    base, ext = os.path.splitext(name)
    im = mark(amber(Image.open(src)))
    dst = P("src", "web", "img", f"{base}-beta{ext}")
    im.save(dst, quality=92) if ext == ".webp" else im.save(dst, optimize=True)
    print("ok", f"src/web/img/{base}-beta{ext}", im.size)


def tv_logo(im):
    """Logo da TV (abertura, carregamento): a imagem cresce para baixo e o selo fica centralizado embaixo do logo."""
    W, H = im.size
    extra = round(H * 0.20)
    canvas = Image.new("RGBA", (W, H + extra), (0, 0, 0, 0))
    canvas.alpha_composite(im, (0, 0))
    return badge(canvas, W / 2, H + extra * 0.52, extra * 0.72)


def wide_logo(im):
    """Logo largo da barra lateral: a imagem cresce para baixo e o selo fica embaixo do "KZ", sem cobrir nada."""
    W, H = im.size
    extra = round(H * 0.42)
    canvas = Image.new("RGBA", (W, H + extra), (0, 0, 0, 0))
    canvas.alpha_composite(im, (0, 0))
    return badge(canvas, W * 0.86, H + extra * 0.38, extra * 0.82)


for n in ("logo-horizontal.webp", "logo-horizontal.png"):
    web(n, tv_logo)
web("logo-sidebar.png", wide_logo)
for n in ("icon.png", "icon-192.png", "icon-small.png"):
    web(n, ribbon)

# versões leves (WebP, no tamanho em que aparecem) dos logos da interface, oficial e Beta
import runpy
runpy.run_path(P("scripts", "make-web-images.py"))
