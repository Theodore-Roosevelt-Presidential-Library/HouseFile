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
for vid, length in [("yEEsRy7sdng", "0:53"), ("zRPJAdE-IBI", "1:34")]:
    im = cover(Image.open(PHOTOS / f"yt-{vid}.jpg"), 1280, 720)
    im = duration(play_button(im), length)
    im.save(OUT / f"video-{vid}.jpg", quality=85, optimize=True)

# 2. Animated teasers: photos or video frames, a title, a play button and the running time.
def teaser_frame(scene, w, h, text):
    name, fx, fy = scene
    im = cover(Image.open(PHOTOS / name), w, h, cx=fx, cy=fy)
    im = shade_bottom(im, 190, 0.35)
    d = ImageDraw.Draw(im)
    pad = round(w * 0.045)
    kicker = font("Oswald", round(h * 0.055), "Medium")
    title = font("Oswald", round(h * 0.13), "Bold")
    sub = font("Alegreya", round(h * 0.055), "Regular")
    y = h - pad - title.size - kicker.size - sub.size - round(h * 0.04)
    d.text((pad, y), text["kicker"], font=kicker, fill=(252, 146, 78))  # Sunset Orange
    y += kicker.size + round(h * 0.01)
    d.text((pad, y), text["title"], font=title, fill=(255, 255, 255))
    y += title.size + round(h * 0.02)
    d.text((pad, y), text["sub"], font=sub, fill=(235, 235, 230))
    return duration(play_button(im, round(h * 0.12)), text["length"])


def teaser(vid, scenes, text, colors=80, dither=False):
    """Static JPG (1320 x 743) plus an animated GIF (660 x 371, kept near 1 MB): each scene
    holds, then cross-fades into the next."""
    teaser_frame(scenes[0], 1320, 743, text).save(OUT / f"video-{vid}-teaser.jpg", quality=85, optimize=True)
    W, H, FADE = 660, 371, 2
    stills = [teaser_frame(sc, W, H, text) for sc in scenes]
    frames, durations = [], []
    for i, still in enumerate(stills):
        frames.append(still)
        durations.append(1800)
        nxt = stills[(i + 1) % len(stills)]
        for k in range(1, FADE + 1):
            frames.append(Image.blend(still, nxt, k / (FADE + 1)))
            durations.append(110)
    dz = Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE
    pal = [f.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=dz) for f in frames]
    pal[0].save(OUT / f"video-{vid}-teaser.gif", save_all=True, append_images=pal[1:],
                duration=durations, loop=0, optimize=True, disposal=1)


# The premiere: "Discover the Theodore Roosevelt Presidential Library" (3:35), from Library photos.
teaser("W9sq8PuGQVo", [  # photo, focus x, focus y
    ("chaney-little-mo-river_016_articlecrop_1.jpg", 0.5, 0.55),
    ("TRPL-MainGuest_Threefold-004.jpg", 0.55, 0.45),
    ("TRPL-Boardwalk_Threefold-037.jpg", 0.35, 0.5),
    ("building-clean-june.jpg", 0.5, 0.45),
], {"kicker": "WATCH THE PREVIEW", "title": "DISCOVER THE LIBRARY",
    "sub": "Medora, North Dakota · the galleries, the building and the Badlands", "length": "3:35"})

# "Your Journey Starts Here: The Trailblazer" (1:21): two of the video's own frames (YouTube's
# maxres1 / maxres3 auto-frames) and a gallery photo.
teaser("qrwdZmqFO5A", [
    ("yt-qrwdZmqFO5A-1.jpg", 0.45, 0.4),   # tapping a Trailblazer at a gallery station
    ("yt-qrwdZmqFO5A-3.jpg", 0.4, 0.45),   # kids laughing in a gallery
    ("gallery-03363.jpg", 0.5, 0.5),       # the Narrative Galleries
], {"kicker": "WATCH HOW IT WORKS", "title": "YOUR TRAILBLAZER",
    "sub": "Tap in at every stop, then take your photos and journal home", "length": "1:21"},
    colors=160, dither=True)  # indoor light bands badly with fewer colors

for p in sorted(OUT.glob("video-*")):
    print(p.name, p.stat().st_size // 1024, "KB")
