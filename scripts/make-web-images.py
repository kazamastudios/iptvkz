# Versões leves dos logos que a interface mostra a toda hora (barra lateral, carregamento do player, boas-vindas):
# WebP e no tamanho em que aparecem (o PNG da barra lateral tinha 900 px para aparecer com uns 200).
# Rode depois de trocar um logo ou de scripts/make-beta-icons.py: python scripts/make-web-images.py
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
IMG = os.path.join(ROOT, "src", "web", "img")

# (origem, destino, largura): 480 px cobre a barra lateral em tela 2x e a TV com zoom
JOBS = [
    ("logo-sidebar.png", "logo-sidebar.webp", 480),
    ("logo-sidebar-beta.png", "logo-sidebar-beta.webp", 480),
    ("icon.png", "icon-256.webp", 256),
    ("icon-beta.png", "icon-256-beta.webp", 256),
]

for src, dst, width in JOBS:
    im = Image.open(os.path.join(IMG, src)).convert("RGBA")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    path = os.path.join(IMG, dst)
    im.save(path, "WEBP", quality=90, method=6)
    print(f"ok src/web/img/{dst} {im.size} {os.path.getsize(path) // 1024} KB (antes {os.path.getsize(os.path.join(IMG, src)) // 1024} KB)")
