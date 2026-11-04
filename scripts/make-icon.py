#!/usr/bin/env python3
"""
Готовит логотип Raut из присланного изображения:
  assets/Raut-logo-source.png  ->  client/assets/logo.png (256x256)
                              ->  installer/Raut.ico (7 размеров, DIB/PNG-совместимые)

Только стандартная библиотека Python: свой декодер PNG (8-bit RGB/RGBA,
не интерлейсный), свой ресемплер и свой писатель PNG/ICO.

    python3 scripts/make-icon.py
"""
import math
import os
import struct
import zlib

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(BASE, 'assets', 'Raut-logo-source.png')
OUT_DIR = os.path.join(BASE, 'client', 'assets')
ICO_DIR = os.path.join(BASE, 'installer')
SIZE = 256


# --------------------------------------------------------------- PNG input
def read_png(path):
    d = open(path, 'rb').read()
    if d[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('не PNG')
    off, idat = 8, bytearray()
    w = h = bd = ct = il = None
    while off + 8 <= len(d):
        ln = struct.unpack_from('>I', d, off)[0]
        typ = d[off + 4:off + 8]
        data = d[off + 8:off + 8 + ln]
        off += 12 + ln
        if typ == b'IHDR':
            w, h, bd, ct, cm, fl, il = struct.unpack('>IIBBBBB', data)
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
    if not (w and h and bd == 8 and ct in (2, 6) and il == 0):
        raise ValueError('поддерживается только 8-битный RGB/RGBA PNG без интерлейса')
    bpp = 3 if ct == 2 else 4
    stride = w * bpp
    raw = zlib.decompress(bytes(idat))
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xff
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xff
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xff
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xff
        elif f != 0:
            raise ValueError('неизвестный PNG-фильтр %d' % f)
        for x in range(w):
            o = (y * w + x) * 4
            if bpp == 4:
                out[o:o + 4] = line[x * 4:x * 4 + 4]
            else:
                out[o:o + 3] = line[x * 3:x * 3 + 3]
                out[o + 3] = 255
        prev = line
    return w, h, bytes(out)


def crop_square(rgba, sw, sh):
    """Центральная квадратная обрезка без искажения пропорций."""
    if sw == sh:
        return rgba, sw
    side = min(sw, sh)
    x0, y0 = (sw - side) // 2, (sh - side) // 2
    out = bytearray(side * side * 4)
    for y in range(side):
        s = ((y + y0) * sw + x0) * 4
        out[y * side * 4:(y + 1) * side * 4] = rgba[s:s + side * 4]
    return bytes(out), side


def scale(rgba, src, dst):
    """Усредняющий ресемплер (box filter) — достаточно для логотипа."""
    if src == dst:
        return rgba
    out = bytearray(dst * dst * 4)
    for y in range(dst):
        y0 = y * src // dst
        y1 = max(y0 + 1, (y + 1) * src // dst)
        for x in range(dst):
            x0 = x * src // dst
            x1 = max(x0 + 1, (x + 1) * src // dst)
            r = g = b = a = n = 0
            for yy in range(y0, min(y1, src)):
                for xx in range(x0, min(x1, src)):
                    o = (yy * src + xx) * 4
                    r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; a += rgba[o + 3]
                    n += 1
            o = (y * dst + x) * 4
            out[o:o + 4] = bytes((r // n, g // n, b // n, a // n))
    return bytes(out)


# -------------------------------------------------------------- PNG output
def write_png(path, rgba, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw += rgba[y * size * 4:(y + 1) * size * 4]

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)


# -------------------------------------------------------------- ICO output
def ico_entry(rgba, size):
    """Классическая DIB-запись ICO (32-бит BGRA + AND-маска)."""
    dib = bytearray()
    mask_row = ((size + 31) // 32) * 4
    image_size = size * size * 4 + mask_row * size
    dib += struct.pack('<IiiHHIIiiII', 40, size, size * 2, 1, 32, 0, image_size, 0, 0, 0, 0)
    for y in range(size - 1, -1, -1):
        for x in range(size):
            o = (y * size + x) * 4
            r, g, b, a = rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]
            dib += bytes((b, g, r, a))
    dib += bytes(mask_row * size)
    return bytes(dib)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(ICO_DIR, exist_ok=True)
    if not os.path.exists(SOURCE):
        raise SystemExit('Нет исходного логотипа: ' + SOURCE)

    w, h, rgba = read_png(SOURCE)
    rgba, side = crop_square(rgba, w, h)
    print('Исходник: %dx%d, обрезка %dx%d' % (w, h, side, side))
    master = scale(rgba, side, SIZE)

    png_path = os.path.join(OUT_DIR, 'logo.png')
    write_png(png_path, master, SIZE)
    print('PNG:', png_path, os.path.getsize(png_path), 'байт')

    sizes = [16, 24, 32, 48, 64, 128, 256]
    entries = [(s, ico_entry(master if s == SIZE else scale(master, SIZE, s), s)) for s in sizes]
    offset = 6 + 16 * len(entries)
    directory, body = bytearray(), bytearray()
    for s, data in entries:
        directory += struct.pack('<BBBBHHII', s if s < 256 else 0, s if s < 256 else 0,
                                 0, 0, 1, 32, len(data), offset)
        body += data
        offset += len(data)
    ico_path = os.path.join(ICO_DIR, 'Raut.ico')
    open(ico_path, 'wb').write(struct.pack('<HHH', 0, 1, len(entries)) + directory + body)
    print('ICO:', ico_path, os.path.getsize(ico_path), 'байт')


if __name__ == '__main__':
    main()
