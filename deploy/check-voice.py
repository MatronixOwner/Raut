#!/usr/bin/env python3
"""Проверка, что на сервере Raut работают И текст, И голос.

    python3 deploy/check-voice.py chat.example.ru
    python3 deploy/check-voice.py chat.example.ru https://raut.1-2-3-4.sslip.io

Проверяет:
  1. /api/health                         — сервер жив
  2. /api/config → iceServers            — свой STUN и TURN прописаны с креденшелами
  3. UDP 3478 STUN Binding Request       — порт реально открыт, coturn отвечает
  4. TCP 3478                            — TURN по TCP тоже доступен

Только стандартная библиотека. Код завершения 0 = всё хорошо, 1 = есть проблемы.
"""
import json
import os
import socket
import ssl
import struct
import sys
import urllib.request

MAGIC = 0x2112A442
OK, BAD = '✓', '✗'
problems = []


def note(ok, text, detail=''):
    print(f'  {OK if ok else BAD}  {text}' + (f' — {detail}' if detail else ''))
    if not ok:
        problems.append(text)
    return ok


def get_json(url, timeout=8):
    ctx = ssl.create_default_context()
    if os.environ.get('RAUT_INSECURE') == '1':
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={'User-Agent': 'raut-voice-check'})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.load(r)


def stun_probe(host, port=3478, timeout=4):
    """Отправляет RFC 5389 Binding Request и разбирает Binding Success Response."""
    tid = os.urandom(12)
    packet = struct.pack('!HHI12s', 0x0001, 0, MAGIC, tid)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(packet, (host, port))
        data, _ = s.recvfrom(2048)
    finally:
        s.close()
    if len(data) < 20:
        raise ValueError('ответ короче 20 байт')
    kind, length, cookie, rid = struct.unpack('!HHI12s', data[:20])
    if kind != 0x0101 or cookie != MAGIC or rid != tid:
        raise ValueError(f'не STUN Binding Response (type=0x{kind:04x})')
    # Ищем XOR-MAPPED-ADDRESS (0x0020) — доказательство, что NAT пробивается.
    pos, mapped = 20, None
    while pos + 4 <= len(data) and pos < 20 + length:
        atype, alen = struct.unpack_from('!HH', data, pos)
        value = data[pos + 4:pos + 4 + alen]
        if atype == 0x0020 and len(value) >= 8:
            _reserved, family, xport, xaddr = struct.unpack_from('!BBHI', value, 0)
            if family == 0x01:  # IPv4
                port_out = xport ^ (MAGIC >> 16)
                ip_int = xaddr ^ MAGIC
                mapped = socket.inet_ntoa(struct.pack('!I', ip_int)) + f':{port_out}'
        pos += 4 + alen + (4 - alen % 4) % 4
    return mapped


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else ''
    if not host:
        print('Использование: python3 deploy/check-voice.py <домен или IP> [https://url]')
        return 2
    if host.startswith('http'):
        host = host.split('//', 1)[-1].split('/', 1)[0]
    base = (sys.argv[2] if len(sys.argv) > 2 else 'https://' + host).rstrip('/')

    print(f'Проверка Raut → {base} (STUN/TURN: {host}:3478)\n')

    try:
        h = get_json(base + '/api/health')
        note(h.get('ok') is True, '/api/health', f"v{h.get('version', '?')}, {h.get('name', '')}")
    except Exception as e:
        note(False, '/api/health', str(e))

    ice = []
    try:
        cfg = get_json(base + '/api/config')
        ice = cfg.get('iceServers') or []
        urls = [u for entry in ice for u in ([entry['urls']] if isinstance(entry.get('urls'), str) else entry.get('urls', []))]
        note(any(u.startswith('stun:') for u in urls), 'свой STUN прописан в /api/config', ', '.join(u for u in urls if u.startswith('stun:')))
        turns = [u for u in urls if u.startswith('turn')]
        note(bool(turns), 'свой TURN прописан в /api/config', ', '.join(turns))
        def entry_urls(e):
            u = e.get('urls', [])
            return [u] if isinstance(u, str) else u
        turn_entries = [e for e in ice if any(str(u).startswith('turn') for u in entry_urls(e))]
        note(bool(turn_entries) and all(e.get('username') and e.get('credential') for e in turn_entries),
             'у TURN есть логин и пароль')
    except Exception as e:
        note(False, '/api/config', str(e))

    try:
        ip = socket.gethostbyname(host)
        mapped = stun_probe(ip)
        note(True, 'UDP 3478 отвечает (STUN Binding)', f'видит нас как {mapped or "?"}')
    except Exception as e:
        note(False, 'UDP 3478 отвечает (STUN Binding)', f'{e} — откройте порт в файрволе VPS и в панели хостера')

    try:
        with socket.create_connection((host, 3478), timeout=3):
            pass
        note(True, 'TCP 3478 доступен (TURN по TCP)')
    except Exception as e:
        note(False, 'TCP 3478 доступен (TURN по TCP)', str(e))

    print()
    if problems:
        print(f'ПРОБЛЕМЫ ({len(problems)}): ' + '; '.join(problems))
        print('Голос между разными сетями может не работать. См. deploy/voice-hosting.md')
        return 1
    print('ГОТОВО: текст (HTTPS/WSS) и голос (свой STUN/TURN по UDP) работают.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
