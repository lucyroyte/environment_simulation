#!/usr/bin/env python3
"""Builds data/central-park.geojson from OpenStreetMap.

The app never calls a map API at runtime: it loads the GeoJSON this script
writes. Re-run it only to refresh the extract.

    python3 -m pip install shapely
    python3 scripts/build_central_park.py            # downloads into .osm-cache/
    python3 scripts/build_central_park.py --cache DIR

Data (c) OpenStreetMap contributors, ODbL 1.0. The OSM editing API's /map call
is used because Overpass is often unreachable from sandboxed environments; it
caps each request at 50,000 nodes, so the area is fetched as a grid of tiles.
"""

import argparse
import json
import math
import os
import subprocess
import xml.etree.ElementTree as ET

from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping
from shapely.ops import unary_union

BBOX = (-73.9830, 40.7630, -73.9480, 40.8015)  # W, S, E, N
TILES = (4, 5)
API = 'https://www.openstreetmap.org/api/0.6/map?bbox={:.5f},{:.5f},{:.5f},{:.5f}'

# Local frame: feet, origin at the middle of the Great Lawn, rotated so the
# Manhattan street grid runs along the axes (+y is "Manhattan north", which is
# about 29 degrees east of true north).
ORIGIN = (-73.96690, 40.78145)
GRID_ROTATION_DEG = 29.0
FT_PER_M = 3.28084

CENTRAL_PARK_WAY = 427818536
EAST_MEADOW_REL = 7896090

# Named lawns that become simulation lawns, keyed by OSM way (or relation).
LAWNS = {
    290827260: 'Sheep Meadow',
    255971446: 'Great Lawn',
    EAST_MEADOW_REL: 'East Meadow',
    37183476: 'North Meadow',
    385883936: 'Cedar Hill',
    393449121: 'Pilgrim Hill',
    431046991: 'Great Hill',
    385460493: 'East Green',
    426373513: 'Frisbee Hill',
    1120460620: 'Dene Slope',
    431046993: "Children's Glade",
}

# Walkable ways inside the park, with a nominal width in feet.
PATH_WIDTH = {
    'footway': 8, 'path': 5, 'steps': 6, 'bridleway': 10, 'cycleway': 8,
    'track': 8, 'service': 14, 'unclassified': 16, 'pedestrian': 12,
}
DRIVE_WIDTH = 30  # West, East and Center Drive are car-free loop drives
STREET_WIDTH = {
    'motorway': 60, 'primary': 70, 'secondary': 55, 'tertiary': 45,
    'residential': 32, 'unclassified': 32, 'living_street': 24,
}
STREET_REACH_FT = 450     # streets this close to the park are kept (about a block)
BUILDING_REACH_FT = 400   # buildings whose centroid is this close are kept


def fetch(cache):
    os.makedirs(cache, exist_ok=True)
    w, s, e, n = BBOX
    nx, ny = TILES
    files = []
    for i in range(nx):
        for j in range(ny):
            path = os.path.join(cache, f't{i}{j}.osm')
            files.append(path)
            if os.path.exists(path) and os.path.getsize(path) > 1000:
                continue
            url = API.format(w + (e - w) * i / nx, s + (n - s) * j / ny,
                             w + (e - w) * (i + 1) / nx, s + (n - s) * (j + 1) / ny)
            print('fetching', url)
            subprocess.run(['curl', '-sSf', '-m', '180', '-o', path, url], check=True)
    return files


def load(files):
    nodes, ways, rels = {}, {}, {}
    for f in files:
        for _, el in ET.iterparse(f):
            if el.tag == 'node':
                nodes[int(el.get('id'))] = (float(el.get('lon')), float(el.get('lat')))
            elif el.tag == 'way':
                ways[int(el.get('id'))] = (
                    [int(nd.get('ref')) for nd in el.findall('nd')],
                    {t.get('k'): t.get('v') for t in el.findall('tag')})
            elif el.tag == 'relation':
                rels[int(el.get('id'))] = (
                    [(m.get('type'), int(m.get('ref')), m.get('role')) for m in el.findall('member')],
                    {t.get('k'): t.get('v') for t in el.findall('tag')})
            if el.tag in ('node', 'way', 'relation'):
                el.clear()
    return nodes, ways, rels


class Frame:
    def __init__(self):
        lon0, lat0 = ORIGIN
        self.lon0, self.lat0 = lon0, lat0
        m_per_deg_lat = 111132.92 - 559.82 * math.cos(2 * math.radians(lat0))
        m_per_deg_lon = 111412.84 * math.cos(math.radians(lat0))
        self.fx = m_per_deg_lon * FT_PER_M
        self.fy = m_per_deg_lat * FT_PER_M
        a = math.radians(GRID_ROTATION_DEG)
        self.c, self.s = math.cos(a), math.sin(a)

    def to_ft(self, lon, lat):
        e = (lon - self.lon0) * self.fx
        n = (lat - self.lat0) * self.fy
        # Rotate counter-clockwise by the grid angle so avenues point up.
        return (e * self.c - n * self.s, e * self.s + n * self.c)

    def to_lonlat(self, x, y):
        e = x * self.c + y * self.s
        n = -x * self.s + y * self.c
        return (self.lon0 + e / self.fx, self.lat0 + n / self.fy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='.osm-cache')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data', 'central-park.geojson'))
    args = ap.parse_args()

    nodes, ways, rels = load(fetch(args.cache))
    fr = Frame()
    ft = {k: fr.to_ft(*v) for k, v in nodes.items()}

    def has_all(nd):
        return all(i in ft for i in nd)

    def ring(nd):
        return Polygon([ft[i] for i in nd])

    def line(nd):
        return LineString([ft[i] for i in nd])

    park = ring(ways[CENTRAL_PARK_WAY][0]).buffer(0)
    near_streets = park.buffer(STREET_REACH_FT)
    near_buildings = park.buffer(BUILDING_REACH_FT)

    features = []

    def emit(layer, geom, props, digits=6):
        def conv(coords):
            return [[round(c, digits) for c in fr.to_lonlat(x, y)] for x, y in coords]
        if geom.is_empty:
            return
        if hasattr(geom, 'geoms'):
            for part in geom.geoms:
                emit(layer, part, props, digits)
            return
        g = mapping(geom)
        if g['type'] == 'Polygon':
            coords = [conv(r) for r in g['coordinates']]
        elif g['type'] == 'LineString':
            coords = conv(g['coordinates'])
        else:
            raise ValueError(g['type'])
        features.append({'type': 'Feature', 'properties': {'layer': layer, **props},
                         'geometry': {'type': g['type'], 'coordinates': coords}})

    emit('park', Polygon(park.simplify(2).exterior), {'name': 'Central Park'})

    # --- walkable paths, split at junctions so every path is a graph edge ---
    walk = {}
    for wid, (nd, tg) in ways.items():
        hw = tg.get('highway')
        if hw not in PATH_WIDTH or len(nd) < 2 or not has_all(nd):
            continue
        if tg.get('area') == 'yes' or nd[0] == nd[-1] and hw == 'pedestrian':
            continue
        if not park.buffer(20).contains(line(nd).centroid):
            continue
        name = tg.get('name')
        width = DRIVE_WIDTH if name in ('West Drive', 'East Drive', 'Center Drive') else PATH_WIDTH[hw]
        walk[wid] = (nd, name, width, hw)
    uses = {}
    for nd, *_ in walk.values():
        for i in set(nd):
            uses[i] = uses.get(i, 0) + 1
    path_lines = []
    for wid, (nd, name, width, hw) in sorted(walk.items()):
        cuts = [0] + [k for k in range(1, len(nd) - 1) if uses[nd[k]] > 1 or nd.count(nd[k]) > 1] + [len(nd) - 1]
        for a, b in zip(cuts, cuts[1:]):
            piece = nd[a:b + 1]
            geom = line(piece)
            if geom.length < 0.5:
                continue
            simple = geom.simplify(1.0)
            path_lines.append((simple, width))
            emit('path', simple, {
                'id': f'{wid}-{a}', 'name': name, 'kind': hw, 'width': width,
                'from': piece[0], 'to': piece[-1],
            })

    # Water, woods and decorative grass inside the park.
    water = []
    for wid, (nd, tg) in ways.items():
        if len(nd) < 4 or nd[0] != nd[-1] or not has_all(nd):
            continue
        poly = ring(nd).buffer(0)
        if poly.is_empty or not park.contains(poly.representative_point()):
            continue
        if tg.get('natural') == 'water' or tg.get('water'):
            water.append(poly)
            emit('water', poly.simplify(1.5), {'name': tg.get('name')})
        elif tg.get('natural') == 'wood':
            emit('wood', poly.simplify(2), {'name': tg.get('name')})
        elif tg.get('landuse') in ('grass', 'meadow') and wid not in LAWNS and poly.area > 400:
            emit('grass', poly.simplify(1.5), {'name': tg.get('name')})
    water_union = unary_union(water)

    # --- simulation lawns: the real outline minus the paths that cross it ---
    def lawn_polygon(key):
        if key == EAST_MEADOW_REL:
            outer = [ref for kind, ref, role in rels[key][0] if kind == 'way' and role == 'outer']
            return ring(ways[outer[0]][0])
        return ring(ways[key][0])

    path_buffers = unary_union([g.buffer(w / 2 + 0.5, cap_style=2) for g, w in path_lines])
    for key, name in LAWNS.items():
        poly = lawn_polygon(key).buffer(0)
        poly = poly.difference(path_buffers).difference(water_union)
        if isinstance(poly, MultiPolygon):
            poly = max(poly.geoms, key=lambda p: p.area)
        poly = Polygon(poly.exterior).simplify(1.2)
        # Pulling in by a few inches keeps the edge clear of path rounding.
        poly = poly.buffer(-0.3, join_style=2).simplify(0.3)
        if isinstance(poly, MultiPolygon):
            poly = max(poly.geoms, key=lambda p: p.area)
        slug = name.lower().replace("'", '').replace(' ', '-')
        emit('lawn', poly, {'id': slug, 'name': name, 'osm': key})

    # --- the city around the park ---
    for wid, (nd, tg) in ways.items():
        hw = tg.get('highway')
        if hw not in STREET_WIDTH or len(nd) < 2 or not has_all(nd):
            continue
        geom = line(nd)
        if not near_streets.intersects(geom):
            continue
        inside = park.contains(geom.centroid)
        if inside and hw not in ('secondary', 'primary'):
            continue
        width = 30 if inside else STREET_WIDTH[hw]
        layer = 'transverse' if inside else 'street'
        emit(layer, (geom if inside else geom.intersection(near_streets)).simplify(2), {'name': tg.get('name'), 'kind': hw, 'width': width}, digits=6)

    def height_ft(tg):
        try:
            if 'height' in tg:
                return round(float(tg['height'].split()[0].rstrip('m')) * FT_PER_M)
            if 'building:levels' in tg:
                return round(float(tg['building:levels']) * 3.4 * FT_PER_M)
        except ValueError:
            pass
        return 70

    for wid, (nd, tg) in ways.items():
        if 'building' not in tg or len(nd) < 4 or nd[0] != nd[-1] or not has_all(nd):
            continue
        poly = ring(nd).buffer(0)
        if poly.is_empty or not isinstance(poly, Polygon):
            continue
        c = poly.centroid
        if not near_buildings.contains(c) or park.contains(c):
            continue
        emit('building', Polygon(poly.simplify(1.5).exterior), {'height': height_ft(tg)}, digits=6)

    out = {
        'type': 'FeatureCollection',
        'frame': {'origin': list(ORIGIN), 'gridRotationDeg': GRID_ROTATION_DEG, 'units': 'ft'},
        'attribution': '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)',
        'features': [f for f in features if f['geometry']['coordinates']],
    }
    with open(args.out, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    counts = {}
    for f in out['features']:
        counts[f['properties']['layer']] = counts.get(f['properties']['layer'], 0) + 1
    print(os.path.getsize(args.out), 'bytes', counts)


if __name__ == '__main__':
    main()
