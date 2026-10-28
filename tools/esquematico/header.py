"""Lectura del encabezado de PK (textos verticales) de los planos de línea.

En los planos de distribución, cada elemento de vía tiene en la franja superior una
columna de texto vertical con su PK y su nombre. Las columnas están ordenadas por PK
y separadas ~2.9 pt; la x de la columna es aproximada (±6 pt) a la del elemento.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from pdfgeom import Text, parse_pk

PK_RE = re.compile(r'^-?\d+\+\d+(?:[.,]\d+)?')
ABS_RE = re.compile(r'\(ABS\s*(-?\d+\+\d+(?:[.,]\d+)?)\)')


@dataclass
class HeaderEntry:
    name: str
    x: float
    color: str
    pk: float | None = None          # PK principal (columna de la misma x o la izquierda)
    pk_text: str | None = None
    pk_aux: float | None = None      # PK auxiliar (columna derecha): cadenamiento local, lado L/R, etc.
    pk_aux_text: str | None = None
    pk_abs: float | None = None      # PK absoluto informado como (ABS ...)
    extra: list[str] = field(default_factory=list)

    @property
    def pk_best(self) -> float | None:
        """PK absoluto del elemento: (ABS) si existe, si no el principal."""
        return self.pk_abs if self.pk_abs is not None else self.pk


def read_header(texts: list[Text], y_max: float = 96.0) -> list[HeaderEntry]:
    vert = [t for t in texts if t.vertical and t.y1 <= y_max]
    nums = [t for t in vert if PK_RE.match(t.t)]
    absl = [t for t in vert if ABS_RE.search(t.t)]
    names = [t for t in vert if not PK_RE.match(t.t) and not ABS_RE.search(t.t)]
    out: list[HeaderEntry] = []
    for n in names:
        e = HeaderEntry(name=n.t, x=n.cx, color=n.color)
        same = [t for t in nums if abs(t.cx - n.cx) < 0.6]
        left = [t for t in nums if -1.9 < t.cx - n.cx <= -0.6]
        right = [t for t in nums if 0.6 <= t.cx - n.cx < 1.9]
        main = same[0] if same else (left[0] if left else None)
        if main is not None:
            e.pk_text = main.t
            e.pk = parse_pk(main.t)
        aux = right[0] if (right and main is not None and main not in right) else None
        if aux is None and same and left:
            aux = left[0]
        if aux is not None:
            e.pk_aux_text = aux.t
            e.pk_aux = parse_pk(aux.t)
        a = [t for t in absl if abs(t.cx - n.cx) < 0.6]
        if a:
            m = ABS_RE.search(a[0].t)
            e.pk_abs = parse_pk(m.group(1))
        out.append(e)
    out.sort(key=lambda e: e.x)
    return out
