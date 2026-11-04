#!/usr/bin/env python3
"""
Генерирует логотип Raut (PNG) и многоразмерную иконку Windows (ICO)
только средствами стандартной библиотеки Python.

    python3 scripts/make-icon.py
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'client', 'assets')
ICO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'installer')
SIZE = 256
SS = 3  # суперсэмплинг для сглаживания


def clamp(v, a=0.0, b=1.0):
    return max(a, min(b, v))


def smoothstep(edge0, edge1, x):
    t = clamp((x - edge0) / (edge1 - edge0))
    return t * t * (3 - 2 * t)


def rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return 0.0
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    d = math.hypot(x - cx, y - cy)
    return 1.0 - smoothstep(r - 0.7, r + 0.7, d)


def rect(x, y, x0, y0, x1, y1, r=0):
    return rounded_rect(x, y, x0, y0, x1, y1, r)


def ring(x, y, cx, cy, ro, ri, xmin=None, ymax=None):
    if xmin is not None and x < xmin:
        return 0.0
    if ymax is not None and y > ymax:
        return 0.0
    d = math.hypot(x - cx, y - cy)
    a = 1.0 - smoothstep(ro - 0.8, ro + 0.8, d)
    b = 1.0 - smoothstep(ri - 0.8, ri + 0.8, d)
    return clamp(a - b)


def seg(x, y, ax, ay, bx, by, width):
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = clamp(((x - ax) * dx + (y - ay) * dy) / l2)
    d = math.hypot(x - (ax + t * dx), y - (ay + t * dy))
    return 1.0 - smoothstep(width / 2 - 0.8, width / 2 + 0.8, d)


def arc(x, y, cx, cy, r, width, deg0, deg1):
    ang = math.degrees(math.atan2(y - cy, x - cx))
    if not (deg0 <= ang <= deg1):
        return 0.0
    d = abs(math.hypot(x - cx, y - cy) - r)
    return 1.0 - smoothstep(width / 2 - 0.8, width / 2 + 0.8, d)


def mix(a, b, t):
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


def render():
    """Возвращает RGBA-список пикселей SIZE×SIZE."""
    n = SIZE * SS
    hi = bytearray(n * n * 4)
    c1 = (108, 122, 250)   # светлый индиго
    c2 = (74, 62, 190)     # глубокий синий
    c3 = (160, 76, 220)    # фиолетовый акцент

    for py in range(n):
        y = py / SS
        for px in range(n):
            x = px / SS
            u, v = x / SIZE, y / SIZE
            # фон: диагональный градиент + мягкое свечение
            t = clamp((u * 0.65 + v * 0.55))
            bg = mix(c1, c2, t)
            glow = max(0.0, 1.0 - math.hypot(u - 0.22, v - 0.18) / 0.85)
            bg = mix(bg, c3, glow * 0.45)
            cover = rounded_rect(x, y, 6, 6, 250, 250, 58)
            if cover <= 0:
                continue

            # Буква R и звуковые волны
            shape = 0.0
            shape = max(shape, rect(x, y, 62, 58, 88, 198, 8))                    # стойка
            shape = max(shape, rect(x, y, 62, 58, 132, 84, 8))                    # верхняя перекладина
            shape = max(shape, ring(x, y, 112, 106, 44, 19, xmin=88, ymax=132))   # полукруг
            shape = max(shape, seg(x, y, 118, 138, 176, 198, 25))                  # ножка
            # Волны справа сверху
            for i, r in enumerate((22, 34, 46)):
                shape = max(shape, arc(x, y, 180, 88, r, 7, -62, 62))
            # Маленькая точка-«микрофон» внизу справа
            d = math.hypot(x - 190, y - 176)
            shape = max(shape, 1.0 - smoothstep(8, 9.5, d))

            alpha = int(round(255 * cover))
            k = clamp(shape)
            r = int(round(bg[0] + (255 - bg[0]) * k))
            g = int(round(bg[1] + (255 - bg[1]) * k))
            b = int(round(bg[2] + (255 - bg[2]) * k))
            o = (py * n + px) * 4
            hi[o], hi[o + 1], hi[o + 2], hi[o + 3] = r, g, b, alpha

    # Усреднение 3×3 -> итоговый RGBA
    out = bytearray(SIZE * SIZE * 4)
    for y in range(SIZE):
        for x in range(SIZE):
            rr = gg = bb = aa = 0
            for dy in range(SS):
                for dx in range(SS):
                    o = ((y * SS + dy) * n + (x * SS + dx)) * 4
                    a = hi[o + 3]
                    rr += hi[o] * a; gg += hi[o + 1] * a; bb += hi[o + 2] * a; aa += a
            if aa:
                rr //= aa; gg //= aa; bb //= aa
                aa //= SS * SS
            o = (y * SIZE + x) * 4
            out[o], out[o + 1], out[o + 2], out[o + 3] = rr, gg, bb, aa
    return bytes(out)


def write_png(path, rgba, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw += rgba[y * size * 4:(y + 1) * size * 4]

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def resize(rgba, size):
    if size == SIZE:
        return rgba
    out = bytearray(size * size * 4)
    scale = SIZE / size
    for y in range(size):
        for x in range(size):
            x0, x1 = int(x * scale), max(int(x * scale) + 1, int((x + 1) * scale))
            y0, y1 = int(y * scale), max(int(y * scale) + 1, int((y + 1) * scale))
            r = g = b = a = cnt = 0
            for yy in range(y0, min(y1, SIZE)):
                for xx in range(x0, min(x1, SIZE)):
                    o = (yy * SIZE + xx) * 4
                    r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; a += rgba[o + 3]
                    cnt += 1
            o = (y * size + x) * 4
            out[o:o + 4] = bytes((r // cnt, g // cnt, b // cnt, a // cnt))
    return bytes(out)


def ico_entry(rgba, size):
    """Классическая DIB-запись ICO (32-бит BGRA + AND-маска) — понимается всеми версиями Windows и NSIS."""
    dib = bytearray()
    mask_row = ((size + 31) // 32) * 4
    image_size = size * size * 4 + mask_row * size
    dib += struct.pack('<IiiHHIIiiII', 40, size, size * 2, 1, 32, 0, image_size, 0, 0, 0, 0)
    for y in range(size - 1, -1, -1):
        for x in range(size):
            o = (y * size + x) * 4
            r, g, b, a = rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]
            dib += bytes((b, g, r, a))
    dib += bytes(mask_row * size)  # AND-маска: полностью непрозрачно
    return bytes(dib)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(ICO_DIR, exist_ok=True)
    rgba = render()
    png_path = os.path.join(OUT_DIR, 'logo.png')
    write_png(png_path, rgba, SIZE)
    print('PNG:', png_path, os.path.getsize(png_path), 'bytes')

    sizes = [16, 24, 32, 48, 64, 128, 256]
    entries = [(s, ico_entry(resize(rgba, s), s)) for s in sizes]
    header = struct.pack('<HHH', 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory = bytearray()
    body = bytearray()
    for s, data in entries:
        directory += struct.pack('<BBBBHHII', s if s < 256 else 0, s if s < 256 else 0, 0, 0, 1, 32, len(data), offset)
        body += data
        offset += len(data)
    ico_path = os.path.join(ICO_DIR, 'Raut.ico')
    with open(ico_path, 'wb') as f:
        f.write(header + directory + body)
    print('ICO:', ico_path, os.path.getsize(ico_path), 'bytes')


if __name__ == '__main__':
    main()
