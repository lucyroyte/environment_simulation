// 2D polygon helpers on the ground plane. Points are {x, y}; units are feet.

export const EPS = 1e-6;

export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(poly) {
  return Math.abs(signedArea(poly));
}

// Returns the polygon with counter-clockwise winding, so the inward normal of
// every edge is its left-hand normal.
export function toCCW(poly) {
  const pts = poly.map((p) => ({ x: p.x, y: p.y }));
  return signedArea(pts) < 0 ? pts.reverse() : pts;
}

export function centroid(poly) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
    a += f;
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function bbox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

// Ray-casting test; points exactly on the boundary may go either way, so use
// containsPoint() when the boundary should count as inside.
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function closestOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

export function nearestOnBoundary(p, poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const c = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (!best || c.dist < best.dist) best = { ...c, edge: i };
  }
  return best;
}

export function containsPoint(poly, p, tol = 1e-3) {
  return pointInPolygon(p, poly) || nearestOnBoundary(p, poly).dist <= tol;
}

// True only when p is inside and at least `margin` away from the boundary.
export function strictlyInside(p, poly, margin = 1e-4) {
  return pointInPolygon(p, poly) && nearestOnBoundary(p, poly).dist > margin;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Segments cross at a single interior point (touching or collinear does not count).
export function segmentsCross(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
         ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

// Two polygons overlap when their interiors intersect. Sharing an edge or a
// corner is allowed.
export function polygonsOverlap(A, B) {
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      if (segmentsCross(a, b, B[j], B[(j + 1) % B.length])) return true;
    }
  }
  const probes = (P) => {
    const pts = [...P, centroid(P)];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    return pts;
  };
  if (probes(A).some((p) => strictlyInside(p, B))) return true;
  if (probes(B).some((p) => strictlyInside(p, A))) return true;
  return false;
}

// Total length of boundary that two polygons share (collinear, overlapping edges).
export function sharedBoundaryLength(A, B, tol = 1e-3) {
  let total = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < EPS) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    for (let j = 0; j < B.length; j++) {
      const c = B[j], d = B[(j + 1) % B.length];
      const offC = Math.abs((c.x - a.x) * uy - (c.y - a.y) * ux);
      const offD = Math.abs((d.x - a.x) * uy - (d.y - a.y) * ux);
      if (offC > tol || offD > tol) continue;
      const tc = (c.x - a.x) * ux + (c.y - a.y) * uy;
      const td = (d.x - a.x) * ux + (d.y - a.y) * uy;
      const lo = Math.max(0, Math.min(tc, td));
      const hi = Math.min(len, Math.max(tc, td));
      if (hi > lo) total += hi - lo;
    }
  }
  return total;
}

// Closest points between segments ab and cd: s on ab, t on cd (both 0..1).
export function closestBetweenSegments(a, b, c, d) {
  const candidates = [];
  const onCD = (p) => closestOnSegment(p, c, d);
  const onAB = (p) => closestOnSegment(p, a, b);
  let r = onCD(a); candidates.push({ s: 0, t: r.t, dist: r.dist });
  r = onCD(b); candidates.push({ s: 1, t: r.t, dist: r.dist });
  r = onAB(c); candidates.push({ s: r.t, t: 0, dist: r.dist });
  r = onAB(d); candidates.push({ s: r.t, t: 1, dist: r.dist });
  if (segmentsCross(a, b, c, d)) {
    const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
    const s = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
    const t = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
    candidates.push({ s, t, dist: 0 });
  }
  return candidates.reduce((m, x) => (x.dist < m.dist ? x : m));
}

// Moves p to the closest spot that lies inside a CCW polygon with at least
// `margin` clearance from its boundary.
export function pushInside(p, poly, margin) {
  let q = { x: p.x, y: p.y };
  for (let i = 0; i < 8; i++) {
    const nb = nearestOnBoundary(q, poly);
    if (pointInPolygon(q, poly) && nb.dist >= margin - 1e-6) return q;
    const a = poly[nb.edge], b = poly[(nb.edge + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const base = pointInPolygon(q, poly) ? q : nb.point;
    const need = pointInPolygon(q, poly) ? margin - nb.dist + 1e-3 : margin + 1e-3;
    q = { x: base.x + n.x * need, y: base.y + n.y * need };
  }
  // Fall back to sliding toward the centroid.
  const c = centroid(poly);
  for (let k = 1; k <= 20; k++) {
    const f = k / 20;
    const r = { x: q.x + (c.x - q.x) * f, y: q.y + (c.y - q.y) * f };
    if (pointInPolygon(r, poly) && nearestOnBoundary(r, poly).dist >= margin) return r;
  }
  return c;
}

export function randomPointInPolygon(poly, margin, rng = Math.random) {
  const bb = bbox(poly);
  for (let i = 0; i < 400; i++) {
    const p = {
      x: bb.minX + (bb.maxX - bb.minX) * rng(),
      y: bb.minY + (bb.maxY - bb.minY) * rng(),
    };
    if (pointInPolygon(p, poly) && nearestOnBoundary(p, poly).dist >= margin) return p;
  }
  return centroid(poly);
}

// Distance from p to a polygon (0 when inside).
export function distanceToPolygon(p, poly) {
  return pointInPolygon(p, poly) ? 0 : nearestOnBoundary(p, poly).dist;
}

// ---- polylines ------------------------------------------------------------

// Cumulative length at each vertex of an open polyline.
export function polylineLengths(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return cum;
}

// Point `d` ft along a polyline, with the unit direction u and left normal n
// of the segment it falls on.
export function pointOnPolyline(points, cum, d) {
  const total = cum[cum.length - 1];
  d = Math.max(0, Math.min(total, d));
  let i = 1;
  while (i < points.length - 1 && cum[i] < d) i++;
  const a = points[i - 1], b = points[i];
  const len = cum[i] - cum[i - 1];
  const k = len > 0 ? (d - cum[i - 1]) / len : 0;
  const u = len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
  return { point: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, u, n: { x: -u.y, y: u.x }, seg: i - 1 };
}

// Closest point on a polyline to p; d is the distance along the polyline.
export function closestOnPolyline(p, points, cum) {
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const c = closestOnSegment(p, points[i - 1], points[i]);
    if (!best || c.dist < best.dist) {
      best = { point: c.point, dist: c.dist, d: cum[i - 1] + c.t * (cum[i] - cum[i - 1]) };
    }
  }
  return best;
}

// Whether a polyline's centerline enters a polygon's interior.
export function polylineEntersPolygon(points, poly, margin = 1e-3) {
  for (let i = 1; i < points.length; i++) {
    for (let j = 0; j < poly.length; j++) {
      if (segmentsCross(points[i - 1], points[i], poly[j], poly[(j + 1) % poly.length])) return true;
    }
  }
  return points.some((p) => strictlyInside(p, poly, margin));
}

// Smallest distance between a polyline and a polygon (0 when they touch).
export function polylineToPolygonDistance(points, poly, cum = polylineLengths(points)) {
  let best = Infinity;
  for (const p of points) best = Math.min(best, distanceToPolygon(p, poly));
  for (const q of poly) best = Math.min(best, closestOnPolyline(q, points, cum).dist);
  return best;
}

export function bboxOverlap(a, b, pad = 0) {
  return a.minX - pad <= b.maxX && b.minX - pad <= a.maxX && a.minY - pad <= b.maxY && b.minY - pad <= a.maxY;
}

// Uniform grid of items by bounding box, for "what is near this point".
export class GridIndex {
  constructor(cell = 120) {
    this.cell = cell;
    this.cells = new Map();
  }

  key(i, j) { return i * 100003 + j; }

  insert(item, box) {
    const c = this.cell;
    for (let i = Math.floor(box.minX / c); i <= Math.floor(box.maxX / c); i++) {
      for (let j = Math.floor(box.minY / c); j <= Math.floor(box.maxY / c); j++) {
        const k = this.key(i, j);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(item);
      }
    }
  }

  // Items whose boxes come within r of p (a superset; callers measure exactly).
  near(p, r) {
    const c = this.cell;
    const out = new Set();
    for (let i = Math.floor((p.x - r) / c); i <= Math.floor((p.x + r) / c); i++) {
      for (let j = Math.floor((p.y - r) / c); j <= Math.floor((p.y + r) / c); j++) {
        for (const item of this.cells.get(this.key(i, j)) || []) out.add(item);
      }
    }
    return [...out];
  }

  inBox(box) {
    const out = new Set();
    const c = this.cell;
    for (let i = Math.floor(box.minX / c); i <= Math.floor(box.maxX / c); i++) {
      for (let j = Math.floor(box.minY / c); j <= Math.floor(box.maxY / c); j++) {
        for (const item of this.cells.get(this.key(i, j)) || []) out.add(item);
      }
    }
    return [...out];
  }
}
