// The semantic model of the park: entities (Lawn, Path, User), their
// relationships, the rules that constrain them and the actions that change them.
// This module has no rendering code.

import * as G from './geometry.js';

export const ACTIVITIES = ['walking', 'standing', 'sitting'];
export const GRASS_MIN = 2;
export const GRASS_MAX = 20;
export const MOW_HEIGHT = 5;
export const NEEDS_MOWING_ABOVE = 15;
export const MIN_PATH_WIDTH = 1.5;
export const SQFT_PER_USER = 10;

const USER_SPACING = 2; // ft between people placed on a lawn
const LAWN_MARGIN = 1; // ft clearance from a lawn edge when placing people

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pt = (x, y) => ({ x, y });

// A path is described by its centerline and width; the boundary is the
// rectangle the centerline sweeps out.
function makePath(id, name, a, b, width) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  const hw = width / 2;
  const boundary = G.toCCW([
    pt(a.x - n.x * hw, a.y - n.y * hw),
    pt(b.x - n.x * hw, b.y - n.y * hw),
    pt(b.x + n.x * hw, b.y + n.y * hw),
    pt(a.x + n.x * hw, a.y + n.y * hw),
  ]);
  return {
    kind: 'path', id, name, width, a, b, len, u, n, boundary,
    bordersLawns: [], connectsTo: [], junctions: [], range: [0, 1],
  };
}

function makeLawn(id, name, boundary, grassHeight, status, growth) {
  const poly = G.toCCW(boundary);
  const area = G.polygonArea(poly);
  return {
    kind: 'lawn', id, name, boundary: poly, area,
    capacity: Math.floor(area / SQFT_PER_USER),
    grassHeight, status, growth, borderedBy: [],
  };
}

export class Park {
  constructor(seed = 7) {
    this.reset(seed);
  }

  reset(seed = 7) {
    this.rng = mulberry32(seed);
    this.day = 0;
    this.nextUserId = 1;
    this.users = [];
    this.log = [];

    // Park footprint: 80 ft x 50 ft, ringed by a 4 ft loop of paths with a
    // 4 ft path crossing through the middle.
    this.paths = [
      makePath('north', 'North Walk', pt(-40, 23), pt(40, 23), 4),
      makePath('south', 'South Walk', pt(-40, -23), pt(40, -23), 4),
      makePath('west', 'West Walk', pt(-38, -21), pt(-38, 21), 4),
      makePath('east', 'East Walk', pt(38, -21), pt(38, 21), 4),
      makePath('middle', 'Center Walk', pt(0, -21), pt(0, 21), 4),
    ];

    this.lawns = [
      makeLawn('A', 'Great Lawn',
        [pt(-36, -21), pt(-2, -21), pt(-2, 21), pt(-28, 21), pt(-36, 13)], 7, 'open', 0.8),
      makeLawn('B', 'East Meadow',
        [pt(2, -3), pt(36, -3), pt(36, 21), pt(2, 21)], 17, 'open', 1.1),
      makeLawn('C', 'Rose Corner',
        [pt(2, -21), pt(15, -21), pt(15, -15), pt(10, -11), pt(2, -11)], 13, 'closed', 1.4),
    ];

    this.computeRelationships();

    // Example population: 6 walking, 3 sitting, 1 standing.
    const walkers = [
      ['north', 0.30, 1], ['south', 0.62, -1], ['west', 0.45, 1],
      ['east', 0.55, -1], ['middle', 0.25, 1], ['middle', 0.78, -1],
    ];
    for (const [pathId, t, dir] of walkers) this.spawnWalker(pathId, t, dir);
    this.spawnOnLawn('A', 'sitting', pt(-21, 6));
    this.spawnOnLawn('A', 'sitting', pt(-14, -9));
    this.spawnOnLawn('B', 'sitting', pt(21, 11));
    this.spawnOnLawn('B', 'standing', pt(12, 4));

    this.note('Park opened with 10 visitors.');
  }

  // ---- lookups ---------------------------------------------------------

  path(id) { return this.paths.find((p) => p.id === id); }
  lawn(id) { return this.lawns.find((l) => l.id === id); }
  user(id) { return this.users.find((u) => u.id === id); }
  usersOnLawn(id) { return this.users.filter((u) => u.locationType === 'lawn' && u.locationId === id); }
  usersOnPath(id) { return this.users.filter((u) => u.locationType === 'path' && u.locationId === id); }
  needsMowing(lawn) { return lawn.grassHeight > NEEDS_MOWING_ABOVE; }

  note(message, level = 'info') {
    this.log.push({ day: this.day, message, level });
    if (this.log.length > 200) this.log.shift();
  }

  // ---- relationships ---------------------------------------------------

  computeRelationships() {
    for (const lawn of this.lawns) {
      lawn.borderedBy = this.paths
        .filter((p) => G.sharedBoundaryLength(lawn.boundary, p.boundary) > 0.01)
        .map((p) => p.id);
    }
    for (const p of this.paths) {
      p.bordersLawns = this.lawns.filter((l) => l.borderedBy.includes(p.id)).map((l) => l.id);
      p.connectsTo = this.paths
        .filter((q) => q !== p && G.sharedBoundaryLength(p.boundary, q.boundary) > 0.01)
        .map((q) => q.id);
      p.junctions = [];
    }
    // Junctions are where walkers can step from one path's centerline onto
    // another's.
    for (const p of this.paths) {
      for (const qid of p.connectsTo) {
        const q = this.path(qid);
        const c = G.closestBetweenSegments(p.a, p.b, q.a, q.b);
        p.junctions.push({ s: c.s, other: q.id, otherS: c.t });
      }
      p.junctions.sort((x, y) => x.s - y.s);
      // Walkers turn around (or turn off) at the junction nearest each end
      // rather than walking into the corner square owned by the other path.
      const nearEnd = p.width / p.len;
      const margin = 0.5 / p.len;
      const startJ = p.junctions.filter((j) => j.s <= nearEnd);
      const endJ = p.junctions.filter((j) => j.s >= 1 - nearEnd);
      p.range = [
        startJ.length ? Math.min(...startJ.map((j) => j.s)) : margin,
        endJ.length ? Math.max(...endJ.map((j) => j.s)) : 1 - margin,
      ];
    }
  }

  // ---- positions -------------------------------------------------------

  pathPoint(path, t, lane = 0) {
    return pt(
      path.a.x + path.u.x * path.len * t + path.n.x * lane,
      path.a.y + path.u.y * path.len * t + path.n.y * lane,
    );
  }

  // Which lawn or path contains p (lawns first; boundaries count as inside).
  locate(p) {
    for (const l of this.lawns) if (G.containsPoint(l.boundary, p)) return { type: 'lawn', id: l.id };
    for (const q of this.paths) if (G.containsPoint(q.boundary, p)) return { type: 'path', id: q.id };
    return null;
  }

  randomLane(path) {
    return (this.rng() * 2 - 1) * path.width * 0.32;
  }

  // Free spot on a lawn near `near`, keeping people apart.
  findLawnSpot(lawn, near) {
    const others = this.usersOnLawn(lawn.id);
    const clear = (p) => others.every((o) => Math.hypot(o.position.x - p.x, o.position.y - p.y) >= USER_SPACING);
    const base = G.pushInside(near, lawn.boundary, LAWN_MARGIN);
    if (clear(base)) return base;
    for (let r = 1.5; r < 40; r += 1.5) {
      for (let k = 0; k < 10; k++) {
        const ang = this.rng() * Math.PI * 2;
        const p = pt(base.x + Math.cos(ang) * r, base.y + Math.sin(ang) * r);
        if (G.strictlyInside(p, lawn.boundary, LAWN_MARGIN) && clear(p)) return p;
      }
    }
    return G.randomPointInPolygon(lawn.boundary, LAWN_MARGIN, this.rng);
  }

  // ---- creation helpers ------------------------------------------------

  newUser(activity, position, location, walk = null) {
    const id = this.nextUserId++;
    const user = {
      id, name: `Visitor ${id}`, activity, position,
      locationType: location.type, locationId: location.id,
      walk, speed: 8 + this.rng() * 5,
    };
    this.users.push(user);
    return user;
  }

  spawnWalker(pathId, t, dir) {
    const path = this.path(pathId);
    const [lo, hi] = path.range;
    const tt = Math.max(lo, Math.min(hi, t));
    const lane = this.randomLane(path);
    return this.newUser('walking', this.pathPoint(path, tt, lane), { type: 'path', id: pathId },
      { pathId, t: tt, dir, lane });
  }

  spawnOnLawn(lawnId, activity, near) {
    const lawn = this.lawn(lawnId);
    return this.newUser(activity, this.findLawnSpot(lawn, near), { type: 'lawn', id: lawnId });
  }

  // ---- rules used by actions ---------------------------------------------

  canEnterLawn(lawn) {
    if (lawn.status !== 'open') return { ok: false, reason: `${lawn.name} is closed` };
    const n = this.usersOnLawn(lawn.id).length;
    if (n + 1 > lawn.capacity) {
      return { ok: false, reason: `${lawn.name} is full (${n}/${lawn.capacity})` };
    }
    return { ok: true };
  }

  canMow(lawn) {
    const n = this.usersOnLawn(lawn.id).length;
    if (n > 0) return { ok: false, reason: `${lawn.name} has ${n} ${n === 1 ? 'person' : 'people'} on it` };
    return { ok: true };
  }

  // Puts a user on the path nearest their position, walking.
  moveToNearestPath(user) {
    let best = null;
    for (const path of this.paths) {
      const c = G.closestOnSegment(user.position, path.a, path.b);
      if (!best || c.dist < best.dist) best = { path, t: c.t, dist: c.dist };
    }
    const { path } = best;
    const [lo, hi] = path.range;
    const t = Math.max(lo, Math.min(hi, best.t));
    const lane = this.randomLane(path);
    user.activity = 'walking';
    user.walk = { pathId: path.id, t, dir: this.rng() < 0.5 ? 1 : -1, lane };
    user.position = this.pathPoint(path, t, lane);
    user.locationType = 'path';
    user.locationId = path.id;
    return path;
  }

  // ---- actions -----------------------------------------------------------

  addUser() {
    const path = this.paths[Math.floor(this.rng() * this.paths.length)];
    const [lo, hi] = path.range;
    const user = this.spawnWalker(path.id, lo + (hi - lo) * this.rng(), this.rng() < 0.5 ? 1 : -1);
    this.note(`${user.name} arrived on ${path.name}, walking.`);
    return { ok: true, user };
  }

  removeUser(id) {
    const user = this.user(id);
    if (!user) return { ok: false, reason: 'Select a user first' };
    this.users = this.users.filter((u) => u.id !== id);
    this.note(`${user.name} left the park.`);
    return { ok: true };
  }

  // walking -> standing -> sitting -> walking
  changeActivity(id) {
    const user = this.user(id);
    if (!user) return { ok: false, reason: 'Select a user first' };

    if (user.activity === 'walking') {
      // Standing happens on a lawn: step onto the nearest open lawn bordering
      // the current path that still has room.
      const path = this.path(user.locationId);
      const candidates = path.bordersLawns
        .map((lid) => this.lawn(lid))
        .map((l) => ({ l, d: G.distanceToPolygon(user.position, l.boundary), check: this.canEnterLawn(l) }))
        .sort((x, y) => x.d - y.d);
      const target = candidates.find((c) => c.check.ok);
      if (!target) {
        const why = candidates.length
          ? candidates.map((c) => c.check.reason).join('; ')
          : `${path.name} borders no lawn`;
        return this.refuse(`${user.name} can't stop to stand: ${why}.`);
      }
      user.position = this.findLawnSpot(target.l, user.position);
      user.activity = 'standing';
      user.walk = null;
      user.locationType = 'lawn';
      user.locationId = target.l.id;
      this.note(`${user.name} stepped onto ${target.l.name} and is standing.`);
      return { ok: true };
    }

    if (user.activity === 'standing') {
      user.activity = 'sitting';
      this.note(`${user.name} sat down on ${this.lawn(user.locationId).name}.`);
      return { ok: true };
    }

    // sitting -> walking: walking must happen on a path.
    const path = this.moveToNearestPath(user);
    this.note(`${user.name} got up and is walking on ${path.name}.`);
    return { ok: true };
  }

  mowLawn(id) {
    const lawn = this.lawn(id);
    if (!lawn) return { ok: false, reason: 'Select a lawn first' };
    const check = this.canMow(lawn);
    if (!check.ok) return this.refuse(`Can't mow: ${check.reason}.`);
    const before = lawn.grassHeight;
    lawn.grassHeight = MOW_HEIGHT;
    this.note(`${lawn.name} mowed from ${before.toFixed(1)}″ to ${MOW_HEIGHT}″.`);
    return { ok: true };
  }

  toggleLawn(id) {
    const lawn = this.lawn(id);
    if (!lawn) return { ok: false, reason: 'Select a lawn first' };
    if (lawn.status === 'open') {
      lawn.status = 'closed';
      const evicted = this.usersOnLawn(lawn.id);
      for (const u of evicted) this.moveToNearestPath(u);
      this.note(`${lawn.name} closed.` +
        (evicted.length ? ` ${evicted.length} ${evicted.length === 1 ? 'person moved' : 'people moved'} to the nearest path.` : ''));
    } else {
      lawn.status = 'open';
      this.note(`${lawn.name} reopened.`);
    }
    return { ok: true };
  }

  // Moves walkers along their paths and grows the grass. Returns, per user,
  // the waypoints walked so the view can animate along them.
  advanceTime() {
    this.day += 1;
    for (const lawn of this.lawns) {
      lawn.grassHeight = Math.min(GRASS_MAX, lawn.grassHeight + lawn.growth);
    }
    const trails = new Map();
    for (const user of this.users) {
      if (user.activity === 'walking') trails.set(user.id, this.walk(user, user.speed));
    }
    const due = this.lawns.filter((l) => this.needsMowing(l)).map((l) => l.name);
    this.note(`Day ${this.day}: grass grew.` + (due.length ? ` Needs mowing: ${due.join(', ')}.` : ''));
    return trails;
  }

  walk(user, distance) {
    const trail = [{ ...user.position }];
    let remaining = distance;
    for (let guard = 0; remaining > 1e-6 && guard < 24; guard++) {
      const w = user.walk;
      const path = this.path(w.pathId);
      const [lo, hi] = path.range;
      const end = w.dir > 0 ? hi : lo;
      const ahead = path.junctions
        .filter((j) => (w.dir > 0 ? j.s > w.t + 1e-6 && j.s <= hi + 1e-9 : j.s < w.t - 1e-6 && j.s >= lo - 1e-9))
        .sort((x, y) => Math.abs(x.s - w.t) - Math.abs(y.s - w.t));
      const stopS = ahead.length ? ahead[0].s : end;
      const span = Math.abs(stopS - w.t) * path.len;

      if (span > remaining) {
        w.t += (w.dir * remaining) / path.len;
        remaining = 0;
        trail.push(this.pathPoint(path, w.t, w.lane));
        break;
      }
      w.t = stopS;
      remaining -= span;
      trail.push(this.pathPoint(path, w.t, w.lane));

      const here = path.junctions.filter((j) => Math.abs(j.s - stopS) < 1e-6);
      const atEnd = Math.abs(stopS - end) < 1e-9;
      if (atEnd && here.length === 0) {
        w.dir = -w.dir;
      } else if (here.length && (atEnd || this.rng() < 0.4)) {
        const j = here[Math.floor(this.rng() * here.length)];
        const next = this.path(j.other);
        const [nlo, nhi] = next.range;
        w.pathId = next.id;
        w.t = Math.max(nlo, Math.min(nhi, j.otherS));
        if (w.t <= nlo + 1e-6) w.dir = 1;
        else if (w.t >= nhi - 1e-6) w.dir = -1;
        else w.dir = this.rng() < 0.5 ? 1 : -1;
        w.lane = Math.max(-next.width * 0.32, Math.min(next.width * 0.32, w.lane));
        trail.push(this.pathPoint(next, w.t, w.lane));
      }
    }
    user.position = this.pathPoint(this.path(user.walk.pathId), user.walk.t, user.walk.lane);
    user.locationType = 'path';
    user.locationId = user.walk.pathId;
    return trail;
  }

  refuse(reason) {
    this.note(reason, 'warn');
    return { ok: false, reason };
  }

  // ---- full rule check -------------------------------------------------

  validate() {
    const results = [];
    const add = (rule, violations) => results.push({ rule, ok: violations.length === 0, violations });

    add('Every user is on a path or a lawn', this.users
      .filter((u) => !this.locate(u.position))
      .map((u) => `${u.name} is off the grounds`));

    add('Walking users are on a path', this.users
      .filter((u) => u.activity === 'walking' && u.locationType !== 'path')
      .map((u) => `${u.name} is walking off-path`));

    add('Sitting and standing users are on a lawn', this.users
      .filter((u) => u.activity !== 'walking' && u.locationType !== 'lawn')
      .map((u) => `${u.name} is ${u.activity} off-lawn`));

    add('Users are only on open lawns', this.lawns
      .filter((l) => l.status !== 'open' && this.usersOnLawn(l.id).length)
      .map((l) => `${l.name} is closed but occupied`));

    add(`Users per lawn ≤ area ÷ ${SQFT_PER_USER} ft²`, this.lawns
      .filter((l) => this.usersOnLawn(l.id).length > l.capacity)
      .map((l) => `${l.name}: ${this.usersOnLawn(l.id).length}/${l.capacity}`));

    const shapes = [...this.lawns, ...this.paths];
    const overlaps = [];
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        if (G.polygonsOverlap(shapes[i].boundary, shapes[j].boundary)) {
          overlaps.push(`${shapes[i].name} overlaps ${shapes[j].name}`);
        }
      }
    }
    add('Lawn and path boundaries do not overlap', overlaps);

    add('Every lawn borders a path', this.lawns
      .filter((l) => l.borderedBy.length === 0)
      .map((l) => `${l.name} borders no path`));

    add(`Path width ≥ ${MIN_PATH_WIDTH} ft`, this.paths
      .filter((p) => p.width < MIN_PATH_WIDTH)
      .map((p) => `${p.name} is ${p.width} ft wide`));

    add(`Grass height between ${GRASS_MIN}″ and ${GRASS_MAX}″`, this.lawns
      .filter((l) => l.grassHeight < GRASS_MIN || l.grassHeight > GRASS_MAX)
      .map((l) => `${l.name} is ${l.grassHeight.toFixed(1)}″`));

    return results;
  }
}
