#!/usr/bin/env python3
"""
Concatena las curvas individuales en 4 trayectorias continuas (PAN→OBS y OBS→PAN
para NM16 y NM22). Cierra los micro-gaps en estaciones con segmentos v=0.

Uso:
    python3 stitch.py <directorio_curvas_individuales>

Salidas en el mismo directorio:
    NM16_V1_PAN-OBS_stitched.json    Curva continua NM16 PAN→OBS (todas las V1)
    NM16_V2_OBS-PAN_stitched.json    Curva continua NM16 OBS→PAN (todas las V2)
    NM22_V1_PAN-OBS_stitched.json    Curva continua NM22 PAN→OBS
    NM22_V2_OBS-PAN_stitched.json    Curva continua NM22 OBS→PAN
    NM16_V1_PAN-OBS_STITCH.png       Render de validación
    NM16_V2_OBS-PAN_STITCH.png       ...
    NM22_V1_PAN-OBS_STITCH.png
    NM22_V2_OBS-PAN_STITCH.png
"""
import argparse
import glob
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont


# PKs OFICIALES del plano de via (mismo sistema que el diagrama de hilo)
STATIONS = [
    ('PAN',  0.650),    ('ZAR',  2.117798), ('GOM',  3.029863), ('BPA',  3.790228), ('BAL',  4.535736),
    ('MOC',  5.389045), ('SLA',  6.015849), ('CAN',  7.036776), ('MER',  7.881872), ('PIN',  8.776772),
    ('ISA',  9.309249), ('SAL',  9.902240), ('BAD', 10.512010), ('CUA', 11.070800), ('INS', 12.013590),
    ('SEV', 12.808040), ('CHP', 13.458740), ('JNA', 14.583120), ('TCY', 15.890670), ('OBS', 17.300600),
]
STATION_PK = {c: p for c, p in STATIONS}


def stitch_curves(curves, dx=0.001):
    """Concatena lista de curvas (cada una con 'curve': [{pk_km, v_kmh, ...}]) en una sola.

    Estrategia:
    - Sort por pk_first ascendente
    - En cada borde, fuerza v=0 en el extremo de cada curva
    - Si hay gap entre prev.last_pk y next.first_pk, rellena con v=0 cada dx
    - Si hay overlap, toma el midpoint y trunca cada lado
    """
    # Sort
    curves_sorted = sorted(curves, key=lambda c: c['curve'][0]['pk_km'])

    # Cada segmento individual YA termina en v=0 (batch_extract.py extiende los extremos).
    # Al unir: para cada par adyacente, definir station_pk = (A.end + B.start)/2 y
    # mapear ambos endpoints a station_pk, evitando duplicar el v=0 o crear gap.
    all_pts: list[tuple[float, float]] = []
    for ci, cur in enumerate(curves_sorted):
        pts = [(p['pk_km'], p['v_kmh']) for p in cur['curve']]
        if ci == 0:
            all_pts.extend(pts); continue
        prev_pk = all_pts[-1][0]
        next_pk = pts[0][0]
        # Estación = midpoint entre el fin del segmento anterior y el inicio del nuevo
        station_pk = round((prev_pk + next_pk) / 2.0, 5)
        # Reescalar suavemente las ÚLTIMAS PK del segmento anterior para que termine en station_pk
        # (sólo si difieren). Estiramos los últimos ~30 puntos linealmente.
        if abs(prev_pk - station_pk) > dx / 2:
            # buscar el ultimo bloque de puntos cerca del prev_pk (ultimos 30)
            N = min(30, len(all_pts) - 1)
            if N >= 2:
                anchor_idx = len(all_pts) - N
                anchor_pk = all_pts[anchor_idx][0]
                # nuevo target end: station_pk
                old_span = prev_pk - anchor_pk
                new_span = station_pk - anchor_pk
                if old_span > 1e-9 and new_span > 0:
                    for j in range(anchor_idx, len(all_pts)):
                        pk_j, v_j = all_pts[j]
                        ratio = (pk_j - anchor_pk) / old_span
                        new_pk = anchor_pk + ratio * new_span
                        all_pts[j] = (round(new_pk, 5), v_j)
        # Reescalar primeros 30 puntos del nuevo segmento para que arranque en station_pk
        if abs(next_pk - station_pk) > dx / 2:
            N = min(30, len(pts) - 1)
            if N >= 2:
                anchor_pk = pts[N][0]
                old_span = anchor_pk - next_pk
                new_span = anchor_pk - station_pk
                if old_span > 1e-9 and new_span > 0:
                    for j in range(0, N + 1):
                        pk_j, v_j = pts[j]
                        ratio = (anchor_pk - pk_j) / old_span
                        new_pk = anchor_pk - ratio * new_span
                        pts[j] = (round(new_pk, 5), v_j)
        # Eliminar el primer punto del nuevo (duplica el station_pk v=0)
        if pts and all_pts and abs(pts[0][0] - all_pts[-1][0]) < dx / 2:
            pts = pts[1:]
        all_pts.extend(pts)
    return all_pts


def write_json(out_path, points, material, via):
    pk_from = points[0][0]; pk_to = points[-1][0]
    if via == 'V2':
        # En V2 train va OBS→PAN, pero datos siguen ordenados por PK asc.
        # Para la lectura time-ordered del tren, pk_from sería el alto (OBS) y pk_to el bajo (PAN).
        # Pero mantenemos PK ascendente en JSON para uso uniforme.
        pass
    data = {
        'meta': {
            'material': material,
            'via': via,
            'stitched': True,
            'pk_min': pk_from,
            'pk_max': pk_to,
            'n_points': len(points),
        },
        'curve': [{'pk_km': pk, 'v_kmh': round(v, 3)} for pk, v in points]
    }
    with open(out_path, 'w') as f:
        json.dump(data, f, ensure_ascii=False)


def render_stitched(points, out_path, material, via, line_pks=None):
    """Render canvas blanco con la curva stitched + marcadores de estación."""
    W, H = 1800, 700
    img = Image.new('RGB', (W, H), 'white')
    draw = ImageDraw.Draw(img)
    try:
        fnt = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 10)
        fbold = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 12)
    except Exception:
        fnt = ImageFont.load_default(); fbold = fnt

    L, R, T, B = 80, 1750, 50, 620
    pks = np.array([p[0] for p in points])
    vs  = np.array([p[1] for p in points])
    pk_min = pks.min(); pk_max = pks.max()
    rng = pk_max - pk_min
    pad = rng * 0.01
    px_min = pk_min - pad; px_max = pk_max + pad
    v_max_plot = max(80, int(vs.max() / 10 + 1) * 10)

    def x(p): return L + (p - px_min)/(px_max - px_min) * (R - L)
    def y(v): return B - v / v_max_plot * (B - T)

    draw.rectangle([L, T, R, B], outline='black')

    # Grid Y
    for vv in range(0, v_max_plot + 1, 10):
        yy = y(vv)
        draw.line([L, yy, R, yy], fill=(225,225,225))
        draw.text((L-30, yy-6), str(vv), fill='black', font=fnt)

    # Grid X cada 1 km
    pk_lab = int(np.floor(pk_min)); pk_end = int(np.ceil(pk_max))
    for pk in np.arange(pk_lab, pk_end + 0.5, 0.5):
        xx = x(pk)
        if L - 1 <= xx <= R + 1:
            draw.line([xx, T, xx, B], fill=(232,232,232))
            draw.text((xx-12, B+5), f'{pk:.1f}', fill='black', font=fnt)

    # Marcadores de estaciones
    for code, pk_st in STATIONS:
        if px_min <= pk_st <= px_max:
            xx = x(pk_st)
            draw.line([xx, T, xx, B], fill=(50,150,50), width=1)
            draw.text((xx-10, T+5), code, fill=(0,100,0), font=fbold)

    # Curva
    prev = None
    for i in range(len(points)):
        xx, yy = x(pks[i]), y(vs[i])
        if prev is not None:
            draw.line([prev, (xx, yy)], fill=(0,80,200), width=2)
        prev = (xx, yy)

    title = f'{material} {via} — curva continua ({"PAN→OBS" if via=="V1" else "OBS→PAN"})'
    draw.text((W//2 - 150, 18), title, fill='black', font=fbold)
    draw.text((W//2 - 30, B+25), 'PK [km]', fill='black', font=fbold)
    draw.text((15, T+30), 'V [km/h]', fill='black', font=fbold)
    img.save(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir', help='Directorio con JSONs individuales producidos por batch_extract.py')
    args = ap.parse_args()
    src = Path(args.dir)

    summary = []
    for material in ['NM16', 'NM22']:
        for via in ['V1', 'V2']:
            files = sorted(glob.glob(str(src / f'{material}_{via}_*.json')))
            # Filtrar los stitched output si quedaron
            files = [f for f in files if '_stitched' not in f]
            if not files:
                print(f'WARN: no curves found for {material} {via}')
                continue
            curves = []
            for fn in files:
                with open(fn) as f: curves.append(json.load(f))
            stitched = stitch_curves(curves)
            out_json = src / f'{material}_{via}_{"PAN-OBS" if via=="V1" else "OBS-PAN"}_stitched.json'
            out_png  = src / f'{material}_{via}_{"PAN-OBS" if via=="V1" else "OBS-PAN"}_STITCH.png'
            write_json(out_json, stitched, material, via)
            render_stitched(stitched, out_png, material, via)
            pk_min = stitched[0][0]; pk_max = stitched[-1][0]
            v_max = max(v for _, v in stitched)
            summary.append({
                'material': material, 'via': via, 'n_segments': len(curves),
                'n_points': len(stitched), 'pk_min': pk_min, 'pk_max': pk_max, 'v_max': v_max,
                'json': out_json.name, 'png': out_png.name,
            })
            print(f'{material} {via}: {len(curves)} segmentos → {len(stitched)} pts | PK [{pk_min:.4f}, {pk_max:.4f}] | V max {v_max:.1f}')
    print()
    print('Salidas:')
    for s in summary:
        print(f'  {s["json"]:40} ({s["n_segments"]} segs, {s["n_points"]} pts)')
        print(f'  {s["png"]:40}')


if __name__ == '__main__':
    main()
