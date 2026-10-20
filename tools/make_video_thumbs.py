"""Video thumbnails for the proposal emails: a play button and running time on each, and an
animated teaser for the Library's premiere video ("Discover the Theodore Roosevelt
Presidential Library", 3:35), built from Library photos.

Usage: python tools/make_video_thumbs.py <photo-dir> <font-dir> <out-dir>
  <photo-dir>: Library photos plus yt-<id>.jpg (YouTube maxresdefault thumbnails)
  <font-dir>:  Oswald.ttf and Alegreya.ttf (Google Fonts, variable)
Email clients can't play video, so the teaser is an animated GIF that links to the video
page (Outlook desktop shows its first frame, which works on its own).
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

PHOTOS, FONTS, OUT = (Path(a) for a in sys.argv[1:4])
OUT.mkdir(parents=True, exist_ok=True)


def font(name, size, weight="Bold"):
    f = ImageFont.truetype(str(FONTS / f"{name}.ttf"), size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def cover(im, w, h, zoom=1.0, cx=0.5, cy=0.5):
    """Crop-to-fill at w x h, optionally zoomed around (cx, cy)."""
    im = im.convert("RGB")
    scale = max(w / im.width, h / im.height) * zoom
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    x = min(max(round(im.width * cx - w / 2), 0), im.width - w)
    y = min(max(round(im.height * cy - h / 2), 0), im.height - h)
    return im.crop((x, y, x + w, y + h))


def shade_bottom(im, strength=170, start=0.45):
    w, h = im.size
    grad = Image.new("L", (1, h))
    for y in range(h):
        t = max(0.0, (y / h - start) / (1 - start))
        grad.putpixel((0, y), int(strength * t ** 1.4))
    grad = grad.resize((w, h))
    black = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(black, im, grad)


def play_button(im, r=None):
    """White ring, dark translucent disc and a white triangle, centred."""
    w, h = im.size
    r = r or round(h * 0.13)
    cx, cy = w // 2, h // 2
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(0, 0, 0, 120), outline=(255, 255, 255, 235), width=max(3, r // 12))
    t = r * 0.42
    d.polygon([(cx - t * 0.75, cy - t), (cx - t * 0.75, cy + t), (cx + t * 1.05, cy)], fill=(255, 255, 255, 245))
    shadow = layer.filter(ImageFilter.GaussianBlur(r // 6))
    base = im.convert("RGBA")
    base.alpha_composite(Image.eval(shadow, lambda a: a // 3))
    base.alpha_composite(layer)
    return base.convert("RGB")


def duration(im, text):
    w, h = im.size
    f = font("Oswald", round(h * 0.055), "SemiBold")
    d = ImageDraw.Draw(im)
    tw = d.textlength(text, font=f)
    pad = round(h * 0.018)
    x1, y1 = w - pad * 2, h - pad * 2
    box = (x1 - tw - pad * 2, y1 - f.size - pad, x1, y1 + pad * 0.2)
    d.rounded_rectangle(box, radius=pad, fill=(0, 0, 0))
    d.text((box[0] + pad, box[1] + pad * 0.35), text, font=f, fill=(255, 255, 255))
    return im


# 1. Play button + running time on the YouTube thumbnails (16:9, 1280 x 720).
for vid, length in [("yEEsRy7sdng", "0:53"), ("zRPJAdE-IBI", "1:34"), ("qrwdZmqFO5A", "1:21")]:
    im = cover(Image.open(PHOTOS / f"yt-{vid}.jpg"), 1280, 720)
    im = duration(play_button(im), length)
    im.save(OUT / f"video-{vid}.jpg", quality=85, optimize=True)

# 2. Teaser for the premiere video: Library photos, title, play button, running time.
SCENES = [  # photo, focus x, focus y
    ("chaney-little-mo-river_016_articlecrop_1.jpg", 0.5, 0.55),
    ("TRPL-MainGuest_Threefold-004.jpg", 0.55, 0.45),
    ("TRPL-Boardwalk_Threefold-037.jpg", 0.35, 0.5),
    ("building-clean-june.jpg", 0.5, 0.45),
]


def teaser_frame(scene, w, h, zoom):
    name, fx, fy = scene
    im = cover(Image.open(PHOTOS / name), w, h, zoom=zoom, cx=fx, cy=fy)
    im = shade_bottom(im, 190, 0.35)
    d = ImageDraw.Draw(im)
    pad = round(w * 0.045)
    kicker = font("Oswald", round(h * 0.055), "Medium")
    title = font("Oswald", round(h * 0.13), "Bold")
    sub = font("Alegreya", round(h * 0.055), "Regular")
    y = h - pad - title.size - kicker.size - sub.size - round(h * 0.04)
    d.text((pad, y), "WATCH THE PREVIEW", font=kicker, fill=(252, 146, 78))  # Sunset Orange
    y += kicker.size + round(h * 0.01)
    d.text((pad, y), "DISCOVER THE LIBRARY", font=title, fill=(255, 255, 255))
    y += title.size + round(h * 0.02)
    d.text((pad, y), "Medora, North Dakota · the galleries, the building and the Badlands", font=sub, fill=(235, 235, 230))
    return duration(play_button(im, round(h * 0.12)), "3:35")


# Static version (first frame quality, 1320 x 743) for clients that don't animate.
teaser_frame(SCENES[0], 1320, 743, 1.0).save(OUT / "video-W9sq8PuGQVo-teaser.jpg", quality=85, optimize=True)

# Animated GIF at 660 x 371: each scene holds, then cross-fades (kept under ~1 MB for email).
W, H, HOLD, FADE = 660, 371, 1, 2
frames, durations = [], []
stills = []
for s in SCENES:
    seq = [teaser_frame(s, W, H, 1.0) for i in range(HOLD)]
    stills.append(seq)
for i, seq in enumerate(stills):
    frames += seq
    durations += [1800] * HOLD
    nxt = stills[(i + 1) % len(stills)][0]
    for k in range(1, FADE + 1):
        frames.append(Image.blend(seq[-1], nxt, k / (FADE + 1)))
        durations.append(110)
pal = [f.quantize(colors=80, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
pal[0].save(OUT / "video-W9sq8PuGQVo-teaser.gif", save_all=True, append_images=pal[1:],
            duration=durations, loop=0, optimize=True, disposal=1)
for p in sorted(OUT.glob("video-*")):
    print(p.name, p.stat().st_size // 1024, "KB")
