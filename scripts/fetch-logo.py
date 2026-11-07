"""Downloads Rata & Smudge's logo from the business's own website and trims it for the app.
Run by GitHub before each build (see .github/workflows/deploy.yml). The logo itself is not kept in
this repository, so the app always shows the logo currently on rataandsmudge.co.nz.
If the logo moves, update LOGO_URL (right-click the logo on the website → Copy image address)."""
import io, sys, urllib.request
from PIL import Image

LOGO_URL = 'https://www.rataandsmudge.co.nz/cdn/shop/files/ChatGPT_Image_Aug_16_2026_02_09_58_PM.png?width=1600'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/brand-logo.webp'

req = urllib.request.Request(LOGO_URL, headers={'User-Agent': 'rata-smudge-app-build'})
im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGB')
# trim the plain background around the artwork
px = im.load(); w, h = im.size; xs, ys = [], []
for y in range(0, h, 2):
    for x in range(0, w, 2):
        r, g, b = px[x, y]
        if r < 215 or g < 215 or b < 215: xs.append(x); ys.append(y)
pad = 20
box = (max(0, min(xs) - pad), max(0, min(ys) - pad), min(w, max(xs) + pad), min(h, max(ys) + pad))
im = im.crop(box)
im = im.resize((900, round(im.height * 900 / im.width)), Image.LANCZOS)
im.save(OUT, 'WEBP', quality=86)
print('logo saved', OUT, im.size)
