# Glass Shell: makes docs/banner.jpg from preview screenshots.
#   python3 -I tools/banner.py DESKTOP.png QUICK_SETTINGS.jpg OUT.jpg FONT.ttf FONT.ttf
# (DESKTOP from tools/preview.sh, QUICK_SETTINGS = docs/screenshots/quick-settings.jpg;
# Adwaita Sans is a variable font, so the same file gives every weight.)
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont
dark, qs, out, bold, reg = sys.argv[1:6]
W, H = 1600, 560
bg = Image.open(dark).convert('RGB')
# Wallpaper only (no top bar): the area between panel and dock, blurred a bit.
bg = bg.crop((0, 60, 1920, 60 + 672)).resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(6))
# Darken the left side for the text.
shade = Image.new('L', (W, H))
d = ImageDraw.Draw(shade)
for x in range(W):
    d.line([(x, 0), (x, H)], fill=int(150 * max(0, 1 - x / (W * 0.75))))
bg = Image.composite(Image.new('RGB', (W, H), (12, 6, 24)), bg, shade)

def card(img, pos, radius):
    """Paste img with rounded corners and a soft shadow."""
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius, fill=255)
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((pos[0], pos[1] + 14, pos[0] + w, pos[1] + h + 14), radius, fill=120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    bg.paste(Image.new('RGB', (W, H), (0, 0, 0)), (0, 0), shadow)
    bg.paste(img, pos, mask)

q = Image.open(qs).convert('RGB')
# The Quick Settings card inside the crop (see screenshots/quick-settings.jpg).
q = q.crop((192, 46, 550, 282))
q = q.resize((int(q.width * 1.45), int(q.height * 1.45)), Image.LANCZOS)
card(q, (W - q.width - 90, 48), 44)

dock = Image.open(dark).convert('RGB').crop((560 + 80, 970 + 40, 560 + 728, 970 + 108))
k = (q.width + 40) / dock.width
dock = dock.resize((int(dock.width * k), int(dock.height * k)), Image.LANCZOS)
card(dock, (W - dock.width - 90 - (q.width - dock.width) // 2, 48 + q.height + 34), int(34 * k))

d = ImageDraw.Draw(bg)
def font(size, weight):
    f = ImageFont.truetype(reg, size)
    f.set_variation_by_name(weight)
    return f
d.text((96, 170), 'Glass Shell', font=font(104, 'Bold'), fill=(255, 255, 255))
d.text((100, 300), 'A liquid-glass, macOS-style desktop', font=font(38, 'Regular'), fill=(255, 255, 255, 230))
d.text((100, 350), 'for GNOME Shell', font=font(38, 'Regular'), fill=(255, 255, 255))
d.text((100, 430), 'Top bar · Dock · Menus · Quick Settings · Overview blur', font=font(24, 'Medium'), fill=(235, 225, 245))
bg.save(out, quality=90)
