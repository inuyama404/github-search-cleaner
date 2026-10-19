from PIL import Image, ImageDraw
import numpy as np
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extension", "icons")
os.makedirs(OUT, exist_ok=True)

S = 1024  # supersampled master
R = 230   # corner radius

# vertical gradient background
top = np.array([22, 27, 34], dtype=np.float32)     # #161b22
bottom = np.array([13, 17, 23], dtype=np.float32)  # #0d1117
t = np.linspace(0.0, 1.0, S, dtype=np.float32)[:, None, None]
rgb = (top[None, None, :] * (1 - t) + bottom[None, None, :] * t).astype(np.uint8)
rgb = np.repeat(rgb, S, axis=1)

img = Image.fromarray(rgb, "RGB").convert("RGBA")
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=R, fill=255)
img.putalpha(mask)

d = ImageDraw.Draw(img)

# subtle top highlight
d.rounded_rectangle([8, 8, S - 8, S - 8], radius=R - 8, outline=(48, 54, 61, 160), width=4)

blue = (88, 166, 255, 255)
blue_dark = (56, 139, 253, 255)

# magnifier lens
cx, cy, r = 440, 430, 220
for w, color in [(58, blue_dark), (44, blue)]:
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=w)

# handle
d.line([(cx + 155, cy + 155), (cx + 300, cy + 300)], fill=blue, width=70)
d.ellipse([(cx + 265, cy + 265), (cx + 335, cy + 335)], fill=blue)

# glass shine
d.arc([cx - 150, cy - 150, cx + 150, cy + 150], start=200, end=255, fill=(205, 226, 255, 255), width=22)

# red "clear" badge
bx, by, br = 760, 240, 150
d.ellipse([bx - br - 14, by - br - 14, bx + br + 14, by + br + 14], fill=(13, 17, 23, 255))
d.ellipse([bx - br, by - br, bx + br, by + br], fill=(248, 81, 73, 255))

# white x
xw = 26
off = 54
d.line([(bx - off, by - off), (bx + off, by + off)], fill=(255, 255, 255, 255), width=xw)
d.line([(bx + off, by - off), (bx - off, by + off)], fill=(255, 255, 255, 255), width=xw)
for px, py in [(bx - off, by - off), (bx + off, by + off), (bx + off, by - off), (bx - off, by + off)]:
    d.ellipse([px - xw // 2, py - xw // 2, px + xw // 2, py + xw // 2], fill=(255, 255, 255, 255))

master = img.resize((512, 512), Image.LANCZOS)

for size in (16, 32, 48, 128):
    icon = master.resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, f"icon{size}.png")
    icon.save(path, "PNG", optimize=True)
    print(path, icon.size)
