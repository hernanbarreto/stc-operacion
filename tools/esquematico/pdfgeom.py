"""Utilidades geométricas para leer planos AutoCAD exportados a PDF (vectoriales)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import pymupdf


def rgb(c):
    return tuple(round(v, 2) for v in c) if c else None


@dataclass
class Seg:
    x0: float
    y0: float
    x1: float
    y1: float
    color: tuple | None
    width: float
    fill: tuple | None = None

    @property
    def length(self) -> float:
        return math.hypot(self.x1 - self.x0, self.y1 - self.y0)

    @property
    def mid(self):
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)

    def is_vertical(self, tol=0.3):
        return abs(self.x1 - self.x0) < tol * max(self.length, 1e-9)

    def is_horizontal(self, tol=0.05):
        return abs(self.y1 - self.y0) <= max(tol, 0.02 * self.length)


@dataclass
class Text:
    t: str
    x0: float
    y0: float
    x1: float
    y1: float
    color: str
    size: float
    dir: tuple

    @property
    def cx(self):
        return (self.x0 + self.x1) / 2

    @property
    def cy(self):
        return (self.y0 + self.y1) / 2

    @property
    def horizontal(self):
        return abs(self.dir[0] - 1.0) < 0.05 and abs(self.dir[1]) < 0.05

    @property
    def vertical(self):
        return abs(self.dir[0]) < 0.05 and abs(self.dir[1] + 1.0) < 0.05


@dataclass
class Page:
    segs: list[Seg] = field(default_factory=list)
    fills: list[dict] = field(default_factory=list)
    texts: list[Text] = field(default_factory=list)
    width: float = 0
    height: float = 0


def load_page(path: str, pno: int) -> Page:
    doc = pymupdf.open(path)
    p = doc[pno]
    page = Page(width=p.rect.width, height=p.rect.height)
    for d in p.get_drawings():
        col = rgb(d.get('color'))
        fill = rgb(d.get('fill'))
        w = round(d.get('width') or 0, 2)
        if fill is not None:
            r = d['rect']
            page.fills.append(dict(fill=fill, color=col, x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1))
        for it in d['items']:
            if it[0] == 'l':
                a, b = it[1], it[2]
                page.segs.append(Seg(a.x, a.y, b.x, b.y, col, w, fill))
            elif it[0] == 'c':
                a, b = it[1], it[4]
                page.segs.append(Seg(a.x, a.y, b.x, b.y, col, w, fill))
    td = p.get_text('dict')
    for b in td['blocks']:
        for line in b.get('lines', []):
            for s in line['spans']:
                t = s['text'].strip()
                if not t:
                    continue
                x0, y0, x1, y1 = s['bbox']
                page.texts.append(Text(t, x0, y0, x1, y1, '%06x' % s['color'], round(s['size'], 2),
                                       (round(line['dir'][0], 2), round(line['dir'][1], 2))))
    return page


def point_seg_dist(px, py, x0, y0, x1, y1):
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return math.hypot(px - x0, py - y0), 0.0
    t = ((px - x0) * dx + (py - y0) * dy) / L2
    tc = min(1.0, max(0.0, t))
    qx, qy = x0 + tc * dx, y0 + tc * dy
    return math.hypot(px - qx, py - qy), t


def seg_intersection(a, b):
    """Intersección de dos segmentos (x0,y0,x1,y1). Devuelve (x,y,ta,tb) o None."""
    x1, y1, x2, y2 = a
    x3, y3, x4, y4 = b
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(den) < 1e-9:
        return None
    ta = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    tb = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
    return (x1 + ta * (x2 - x1), y1 + ta * (y2 - y1), ta, tb)


def parse_pk(s: str) -> float | None:
    """'17+213.650' -> 17213.65 (m). Admite '-0+000.903' y coma decimal."""
    import re
    m = re.match(r'^(-?)(\d+)\+(\d+(?:[.,]\d+)?)', s.strip())
    if not m:
        return None
    sign = -1 if m.group(1) else 1
    km = int(m.group(2))
    mm = float(m.group(3).replace(',', '.'))
    return sign * (km * 1000 + mm)
