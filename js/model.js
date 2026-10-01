// The semantic model of the park: entities (Lawn, Path, Bench, User), their
// relationships, the rules that constrain them and the actions that change
// them. Users are people or dogs. This module has no rendering code.

import * as G from './geometry.js';

export const ACTIVITIES = ['walking', 'standing', 'sitting', 'playing'];
export const GRASS_MIN = 2;
export const GRASS_MAX = 20;
export const MOW_HEIGHT = 5;
export const NEEDS_MOWING_ABOVE = 15;
export const MIN_PATH_WIDTH = 1.5;
export const SQFT_PER_USER = 10;
export const BENCH_SEATS = 3;
export const LEASH_LENGTH = 6; // ft

const PERSON_SPACING = 2; // ft between people placed on a lawn
const DOG_SPACING = 1.2;
const LAWN_MARGIN = 1; // ft clearance from a lawn edge when placing users
const DOG_NAMES = ['Biscuit', 'Luna', 'Max', 'Pepper', 'Rex', 'Daisy', 'Milo', 'Ziggy', 'Olive', 'Bruno', 'Pickles', 'Nala'];

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
    bordersLawns: [], connectsTo: [], benches: [], junctions: [], range: [0, 1],
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

// A bench stands just off one side of a path (side +1 or -1 along the path's
// normal), parallel to it and facing it.
function makeBench(id, name, path, s, side) {
  const length = 5;
  const depth = 1.6;
  const off = side * (path.width / 2 + 0.35 + depth / 2);
  const along = path.len * s;
  const center = pt(path.a.x + path.u.x * along + path.n.x * off, path.a.y + path.u.y * along + path.n.y * off);
  const corner = (k, m) => pt(
    center.x + path.u.x * (length / 2) * k + path.n.x * (depth / 2) * m,
    center.y + path.u.y * (length / 2) * k + path.n.y * (depth / 2) * m,
  );
  return {
    kind: 'bench', id, name, pathId: path.id, s, side, center, length, depth,
    u: path.u, facing: pt(-side * path.n.x, -side * path.n.y),
    boundary: G.toCCW([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]),
    seats: BENCH_SEATS,
    seatPoints: [-1.6, 0, 1.6].map((k) => pt(center.x + path.u.x * k, center.y + path.u.y * k)),
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
    this.dogNameIndex = 0;
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

    const p = (id) => this.path(id);
    this.benches = [
      makeBench('b1', 'North Bench 1', p('north'), 0.30, 1),
      makeBench('b2', 'North Bench 2', p('north'), 0.72, 1),
      makeBench('b3', 'South Bench', p('south'), 0.35, -1),
      makeBench('b4', 'Center Bench', p('middle'), 0.333, -1),
      makeBench('b5', 'Pond Bench', p('east'), 0.31, 1),
    ];

    this.computeRelationships();

    // Example population: 6 people walking, 3 sitting on lawns, 1 standing,
    // 1 resting on a bench, plus two dogs.
    const walkers = [
      ['north', 0.30, 1], ['south', 0.62, -1], ['west', 0.45, 1],
      ['east', 0.55, -1], ['middle', 0.25, 1], ['middle', 0.78, -1],
    ];
    const people = walkers.map(([pathId, t, dir]) => this.spawnWalker(pathId, t, dir));
    const sitterA = this.spawnOnLawn('A', 'sitting', pt(-21, 6));
    this.spawnOnLawn('A', 'sitting', pt(-14, -9));
    this.spawnOnLawn('B', 'sitting', pt(21, 11));
    this.spawnOnLawn('B', 'standing', pt(12, 4));
    this.seatOnBench(this.newPerson('sitting', pt(0, 0), { type: 'bench', id: 'b1' }), this.bench('b1'));

    this.attachDog(people[2]);
    const luna = this.attachDog(sitterA);
    this.unleash(luna, true);

    this.note('Park opened with 11 visitors and 2 dogs.');
  }

  // ---- lookups ---------------------------------------------------------

  path(id) { return this.paths.find((p) => p.id === id); }
  lawn(id) { return this.lawns.find((l) => l.id === id); }
  bench(id) { return this.benches.find((b) => b.id === id); }
  user(id) { return this.users.find((u) => u.id === id); }
  usersAt(type, id) { return this.users.filter((u) => u.locationType === type && u.locationId === id); }
  usersOnLawn(id) { return this.usersAt('lawn', id); }
  usersOnPath(id) { return this.usersAt('path', id); }
  usersOnBench(id) { return this.usersAt('bench', id); }
  dogsOf(person) { return this.users.filter((u) => u.type === 'dog' && u.ownerId === person.id); }
  owner(dog) { return this.user(dog.ownerId); }
  needsMowing(lawn) { return lawn.grassHeight > NEEDS_MOWING_ABOVE; }
  locationName(u) {
    const where = u.locationType === 'lawn' ? this.lawn(u.locationId)
      : u.locationType === 'bench' ? this.bench(u.locationId) : this.path(u.locationId);
    return where ? where.name : '—';
  }

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
      p.benches = this.benches.filter((b) => b.pathId === p.id).map((b) => b.id);
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

  // Which lawn, path or bench contains p (boundaries count as inside).
  locate(p) {
    for (const l of this.lawns) if (G.containsPoint(l.boundary, p)) return { type: 'lawn', id: l.id };
    for (const q of this.paths) if (G.containsPoint(q.boundary, p)) return { type: 'path', id: q.id };
    for (const b of this.benches) if (G.containsPoint(b.boundary, p)) return { type: 'bench', id: b.id };
    return null;
  }

  randomLane(path) {
    return (this.rng() * 2 - 1) * path.width * 0.32;
  }

  // A dog walks half a step to the side of its owner, inside the path.
  dogLane(ownerLane, path) {
    const lane = ownerLane + (ownerLane >= 0 ? -1.3 : 1.3);
    const max = path.width * 0.42;
    return Math.max(-max, Math.min(max, lane));
  }

  // Free spot on a lawn near `near`, keeping users apart.
  findLawnSpot(lawn, near, spacing = PERSON_SPACING, ignore = null) {
    const others = this.usersOnLawn(lawn.id).filter((u) => u !== ignore);
    const clear = (p) => others.every((o) => Math.hypot(o.position.x - p.x, o.position.y - p.y) >= spacing);
    const base = G.pushInside(near, lawn.boundary, LAWN_MARGIN);
    if (clear(base)) return base;
    for (let r = 1; r < 40; r += 1) {
      for (let k = 0; k < 10; k++) {
        const ang = this.rng() * Math.PI * 2;
        const p = pt(base.x + Math.cos(ang) * r, base.y + Math.sin(ang) * r);
        if (G.strictlyInside(p, lawn.boundary, LAWN_MARGIN) && clear(p)) return p;
      }
    }
    return G.randomPointInPolygon(lawn.boundary, LAWN_MARGIN, this.rng);
  }

  // ---- creation helpers ------------------------------------------------

  newUser(type, activity, position, location, extra = {}) {
    const id = this.nextUserId++;
    const user = {
      id, type, activity, position,
      name: type === 'dog' ? DOG_NAMES[this.dogNameIndex++ % DOG_NAMES.length] : `Visitor ${id}`,
      locationType: location.type, locationId: location.id,
      walk: null, speed: 8 + this.rng() * 5, ...extra,
    };
    this.users.push(user);
    return user;
  }

  newPerson(activity, position, location) {
    return this.newUser('person', activity, position, location);
  }

  spawnWalker(pathId, t, dir) {
    const path = this.path(pathId);
    const [lo, hi] = path.range;
    const tt = Math.max(lo, Math.min(hi, t));
    const lane = this.randomLane(path);
    const user = this.newPerson('walking', this.pathPoint(path, tt, lane), { type: 'path', id: pathId });
    user.walk = { pathId, t: tt, dir, lane };
    return user;
  }

  spawnOnLawn(lawnId, activity, near) {
    const lawn = this.lawn(lawnId);
    return this.newPerson(activity, this.findLawnSpot(lawn, near), { type: 'lawn', id: lawnId });
  }

  attachDog(owner) {
    const dog = this.newUser('dog', owner.activity, { ...owner.position },
      { type: owner.locationType, id: owner.locationId }, { ownerId: owner.id, leashed: true });
    this.followOwner(dog);
    return dog;
  }

  // ---- placement -----------------------------------------------------------

  // Puts a leashed dog beside its owner, matching what the owner is doing.
  followOwner(dog) {
    const owner = this.owner(dog);
    dog.leashed = true;
    if (owner.locationType === 'path') {
      const path = this.path(owner.locationId);
      dog.walk = { ...owner.walk, lane: this.dogLane(owner.walk.lane, path) };
      dog.position = this.pathPoint(path, dog.walk.t, dog.walk.lane);
      dog.activity = 'walking';
      dog.locationType = 'path';
      dog.locationId = path.id;
    } else if (owner.locationType === 'lawn') {
      const lawn = this.lawn(owner.locationId);
      const near = pt(owner.position.x + 1.6, owner.position.y - 0.8);
      dog.walk = null;
      dog.position = this.findLawnSpot(lawn, near, DOG_SPACING, dog);
      dog.activity = owner.activity;
      dog.locationType = 'lawn';
      dog.locationId = lawn.id;
    } else {
      // Owner on a bench: the dog sits on the path at their feet.
      const bench = this.bench(owner.locationId);
      const path = this.path(bench.pathId);
      const along = (owner.position.x - path.a.x) * path.u.x + (owner.position.y - path.a.y) * path.u.y;
      dog.walk = null;
      dog.position = this.pathPoint(path, along / path.len, bench.side * (path.width / 2 - 0.7));
      dog.activity = 'sitting';
      dog.locationType = 'path';
      dog.locationId = path.id;
    }
  }

  // Leashed dogs follow; unleashed dogs are leashed up first.
  bringDogs(person) {
    for (const dog of this.dogsOf(person)) this.followOwner(dog);
  }

  // Puts a person on the path nearest their position, walking.
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
    this.bringDogs(user);
    return path;
  }

  seatOnBench(person, bench) {
    const taken = this.usersOnBench(bench.id).filter((u) => u !== person).map((u) => u.seat);
    const seat = [1, 0, 2].find((s) => !taken.includes(s));
    person.activity = 'sitting';
    person.walk = null;
    person.seat = seat;
    person.position = { ...bench.seatPoints[seat] };
    person.locationType = 'bench';
    person.locationId = bench.id;
    this.bringDogs(person);
  }

  unleash(dog, quiet = false) {
    const owner = this.owner(dog);
    if (owner.locationType !== 'lawn') {
      return this.refuse(`${dog.name} can only be let off the leash on a lawn, and ${owner.name} is on ${this.locationName(owner)}.`);
    }
    const lawn = this.lawn(owner.locationId);
    const ang = this.rng() * Math.PI * 2;
    const near = pt(owner.position.x + Math.cos(ang) * 5, owner.position.y + Math.sin(ang) * 5);
    dog.leashed = false;
    dog.activity = 'playing';
    dog.walk = null;
    dog.position = this.findLawnSpot(lawn, near, DOG_SPACING, dog);
    if (!quiet) this.note(`${owner.name} let ${dog.name} off the leash on ${lawn.name}.`);
    return { ok: true };
  }

  // ---- rules used by actions ---------------------------------------------

  // Whether `count` more users (a person plus their dogs) may enter a lawn.
  canEnterLawn(lawn, count = 1) {
    if (lawn.status !== 'open') return { ok: false, reason: `${lawn.name} is closed` };
    const n = this.usersOnLawn(lawn.id).length;
    if (n + count > lawn.capacity) {
      return { ok: false, reason: `${lawn.name} is full (${n}/${lawn.capacity})` };
    }
    return { ok: true };
  }

  canMow(lawn) {
    const n = this.usersOnLawn(lawn.id).length;
    if (n > 0) return { ok: false, reason: `${lawn.name} has ${n} ${n === 1 ? 'user' : 'users'} on it` };
    return { ok: true };
  }

  // ---- actions -----------------------------------------------------------

  addUser() {
    const path = this.paths[Math.floor(this.rng() * this.paths.length)];
    const [lo, hi] = path.range;
    const user = this.spawnWalker(path.id, lo + (hi - lo) * this.rng(), this.rng() < 0.5 ? 1 : -1);
    this.note(`${user.name} arrived on ${path.name}, walking.`);
    return { ok: true, user };
  }

  // Gives the selected person a dog on a leash, or brings a new visitor with
  // a dog when no person is selected.
  addDog(ownerId) {
    let owner = ownerId ? this.user(ownerId) : null;
    if (owner && owner.type !== 'person') owner = this.owner(owner);
    if (owner?.locationType === 'lawn') {
      const check = this.canEnterLawn(this.lawn(owner.locationId));
      if (!check.ok) return this.refuse(`No room for a dog: ${check.reason}.`);
    }
    if (!owner) owner = this.addUser().user;
    const dog = this.attachDog(owner);
    this.note(`${owner.name} brought ${dog.name} the dog, on a leash.`);
    return { ok: true, user: dog };
  }

  removeUser(id) {
    const user = this.user(id);
    if (!user) return { ok: false, reason: 'Select a user first' };
    const gone = [user, ...(user.type === 'person' ? this.dogsOf(user) : [])];
    this.users = this.users.filter((u) => !gone.includes(u));
    this.note(`${gone.map((u) => u.name).join(' and ')} left the park.`);
    return { ok: true };
  }

  changeActivity(id) {
    const user = this.user(id);
    if (!user) return { ok: false, reason: 'Select a user first' };
    return user.type === 'dog' ? this.changeDogActivity(user) : this.changePersonActivity(user);
  }

  // walking -> standing -> sitting -> walking
  changePersonActivity(user) {
    const dogs = this.dogsOf(user);

    if (user.activity === 'walking') {
      // Standing happens on a lawn: step onto the nearest open lawn bordering
      // the current path that has room for this person and their dogs.
      const path = this.path(user.locationId);
      const candidates = path.bordersLawns
        .map((lid) => this.lawn(lid))
        .map((l) => ({ l, d: G.distanceToPolygon(user.position, l.boundary), check: this.canEnterLawn(l, 1 + dogs.length) }))
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
      this.bringDogs(user);
      this.note(`${user.name} stepped onto ${target.l.name} and is standing.`);
      return { ok: true };
    }

    if (user.activity === 'standing') {
      user.activity = 'sitting';
      for (const dog of dogs) if (dog.leashed) dog.activity = 'sitting';
      this.note(`${user.name} sat down on ${this.lawn(user.locationId).name}.`);
      return { ok: true };
    }

    // sitting -> walking: walking must happen on a path.
    const path = this.moveToNearestPath(user);
    this.note(`${user.name} got up and is walking on ${path.name}` +
      (dogs.length ? `, with ${dogs.map((d) => d.name).join(' and ')} on the leash.` : '.'));
    return { ok: true };
  }

  // A leashed dog does what its owner does, except it may stand or sit when
  // the owner is stopped. An unleashed dog cycles playing -> standing -> sitting.
  changeDogActivity(dog) {
    const owner = this.owner(dog);
    if (dog.leashed) {
      if (owner.activity === 'walking') return this.refuse(`${dog.name} is on the leash and walks with ${owner.name}.`);
      if (owner.locationType === 'bench') return this.refuse(`${dog.name} is resting at ${owner.name}'s feet by the bench.`);
      dog.activity = dog.activity === 'standing' ? 'sitting' : 'standing';
    } else {
      dog.activity = { playing: 'standing', standing: 'sitting', sitting: 'playing' }[dog.activity];
    }
    this.note(`${dog.name} is now ${dog.activity}.`);
    return { ok: true };
  }

  sitOnBench(id) {
    const user = this.user(id);
    if (!user) return { ok: false, reason: 'Select a person first' };
    if (user.type !== 'person') return this.refuse(`Dogs don't sit on benches.`);
    if (user.locationType === 'bench') return this.refuse(`${user.name} is already on ${this.locationName(user)}.`);
    const free = this.benches
      .filter((b) => this.usersOnBench(b.id).length < b.seats)
      .sort((a, b) => Math.hypot(a.center.x - user.position.x, a.center.y - user.position.y) -
                      Math.hypot(b.center.x - user.position.x, b.center.y - user.position.y));
    if (!free.length) return this.refuse('Every bench is full.');
    this.seatOnBench(user, free[0]);
    this.note(`${user.name} sat down on ${free[0].name}.`);
    return { ok: true };
  }

  toggleLeash(id) {
    const dog = this.user(id);
    if (!dog || dog.type !== 'dog') return { ok: false, reason: 'Select a dog first' };
    if (!dog.leashed) {
      this.followOwner(dog);
      this.note(`${this.owner(dog).name} put ${dog.name} back on the leash.`);
      return { ok: true };
    }
    return this.unleash(dog);
  }

  // The owner throws a ball; the dog runs out for it and brings it back.
  // Returns the dog's run so the view can animate it.
  fetch(id) {
    const dog = this.user(id);
    if (!dog || dog.type !== 'dog') return { ok: false, reason: 'Select a dog first' };
    if (dog.leashed) return this.refuse(`${dog.name} needs to be off the leash to play fetch.`);
    const owner = this.owner(dog);
    const lawn = this.lawn(dog.locationId);
    const ball = G.randomPointInPolygon(lawn.boundary, LAWN_MARGIN, this.rng);
    const start = { ...dog.position };
    dog.position = this.findLawnSpot(lawn, pt(owner.position.x + 1.5, owner.position.y + 1), DOG_SPACING, dog);
    dog.activity = 'playing';
    this.note(`${owner.name} threw a ball and ${dog.name} fetched it.`);
    return { ok: true, run: [start, ball, { ...dog.position }], ball };
  }

  // Sends everyone on a lawn (people and dogs) to the nearest path so it can
  // be mowed. Returns how many users left.
  clearLawn(id, quiet = false) {
    const lawn = this.lawn(id);
    if (!lawn) return { ok: false, reason: 'Select a lawn first' };
    const here = this.usersOnLawn(lawn.id);
    const people = here.filter((u) => u.type === 'person');
    for (const p of people) this.moveToNearestPath(p);
    // Dogs whose owner is elsewhere are fetched back to their owner too.
    for (const d of here.filter((u) => u.type === 'dog' && u.locationType === 'lawn')) this.followOwner(d);
    if (!quiet) {
      this.note(here.length
        ? `Cleared ${lawn.name}: ${people.length} ${people.length === 1 ? 'person' : 'people'}` +
          (here.length > people.length ? ` and ${here.length - people.length} dog${here.length - people.length === 1 ? '' : 's'}` : '') +
          ' moved to the nearest path.'
        : `${lawn.name} is already empty.`);
    }
    return { ok: true, count: here.length };
  }

  mowLawn(id) {
    const lawn = this.lawn(id);
    if (!lawn) return { ok: false, reason: 'Select a lawn first' };
    const check = this.canMow(lawn);
    if (!check.ok) return this.refuse(`Can't mow: ${check.reason}. Clear the lawn first.`);
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
      const { count } = this.clearLawn(lawn.id, true);
      this.note(`${lawn.name} closed.` +
        (count ? ` ${count} ${count === 1 ? 'user moved' : 'users moved'} to the nearest path.` : ''));
    } else {
      lawn.status = 'open';
      this.note(`${lawn.name} reopened.`);
    }
    return { ok: true };
  }

  // Moves walkers along their paths (leashed dogs alongside), lets unleashed
  // dogs roam and grows the grass. Returns, per user, the waypoints travelled
  // so the view can animate along them.
  advanceTime() {
    this.day += 1;
    for (const lawn of this.lawns) {
      lawn.grassHeight = Math.min(GRASS_MAX, lawn.grassHeight + lawn.growth);
    }
    const trails = new Map();
    for (const user of this.users) {
      if (user.type !== 'person' || user.activity !== 'walking') continue;
      const stops = this.walk(user, user.speed);
      trails.set(user.id, this.trailPoints(stops, user.walk.lane));
      for (const dog of this.dogsOf(user)) {
        this.followOwner(dog);
        trails.set(dog.id, this.trailPoints(stops, dog.walk.lane));
      }
    }
    for (const dog of this.users) {
      if (dog.type !== 'dog' || dog.leashed || dog.activity !== 'playing') continue;
      const lawn = this.lawn(dog.locationId);
      const start = { ...dog.position };
      const ang = this.rng() * Math.PI * 2;
      dog.position = this.findLawnSpot(lawn, pt(start.x + Math.cos(ang) * 6, start.y + Math.sin(ang) * 6), DOG_SPACING, dog);
      trails.set(dog.id, [start, { ...dog.position }]);
    }
    const due = this.lawns.filter((l) => this.needsMowing(l)).map((l) => l.name);
    this.note(`Day ${this.day}: grass grew.` + (due.length ? ` Needs mowing: ${due.join(', ')}.` : ''));
    return trails;
  }

  trailPoints(stops, lane) {
    return stops.map((s) => {
      const path = this.path(s.pathId);
      const max = path.width * 0.42;
      return this.pathPoint(path, s.t, Math.max(-max, Math.min(max, lane)));
    });
  }

  // Walks a person `distance` ft along the path network. Returns the stops
  // passed through as {pathId, t}.
  walk(user, distance) {
    const stops = [{ pathId: user.walk.pathId, t: user.walk.t }];
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
        stops.push({ pathId: path.id, t: w.t });
        break;
      }
      w.t = stopS;
      remaining -= span;
      stops.push({ pathId: path.id, t: w.t });

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
        stops.push({ pathId: next.id, t: w.t });
      }
    }
    user.position = this.pathPoint(this.path(user.walk.pathId), user.walk.t, user.walk.lane);
    user.locationType = 'path';
    user.locationId = user.walk.pathId;
    return stops;
  }

  refuse(reason) {
    this.note(reason, 'warn');
    return { ok: false, reason };
  }

  // ---- full rule check -------------------------------------------------

  validate() {
    const results = [];
    const add = (rule, violations) => results.push({ rule, ok: violations.length === 0, violations });
    const people = this.users.filter((u) => u.type === 'person');
    const dogs = this.users.filter((u) => u.type === 'dog');

    add('Every user is on a path, lawn or bench', this.users
      .filter((u) => !this.locate(u.position))
      .map((u) => `${u.name} is off the grounds`));

    add('Walking users are on a path', this.users
      .filter((u) => u.activity === 'walking' && u.locationType !== 'path')
      .map((u) => `${u.name} is walking off-path`));

    add('People stand on a lawn and sit on a lawn or bench', people
      .filter((u) => (u.activity === 'standing' && u.locationType !== 'lawn') ||
                     (u.activity === 'sitting' && u.locationType === 'path'))
      .map((u) => `${u.name} is ${u.activity} on ${this.locationName(u)}`));

    add(`Only people sit on benches, at most ${BENCH_SEATS} per bench`, [
      ...this.users.filter((u) => u.locationType === 'bench' && (u.type !== 'person' || u.activity !== 'sitting'))
        .map((u) => `${u.name} is on ${this.locationName(u)}`),
      ...this.benches.filter((b) => this.usersOnBench(b.id).length > b.seats)
        .map((b) => `${b.name}: ${this.usersOnBench(b.id).length}/${b.seats}`),
    ]);

    add('Users are only on open lawns', this.lawns
      .filter((l) => l.status !== 'open' && this.usersOnLawn(l.id).length)
      .map((l) => `${l.name} is closed but occupied`));

    add(`Users per lawn ≤ area ÷ ${SQFT_PER_USER} ft²`, this.lawns
      .filter((l) => this.usersOnLawn(l.id).length > l.capacity)
      .map((l) => `${l.name}: ${this.usersOnLawn(l.id).length}/${l.capacity}`));

    add(`Leashed dogs stay within ${LEASH_LENGTH} ft of their owner`, dogs
      .filter((d) => d.leashed)
      .filter((d) => {
        const o = this.owner(d);
        return !o || Math.hypot(o.position.x - d.position.x, o.position.y - d.position.y) > LEASH_LENGTH;
      })
      .map((d) => `${d.name} has wandered off`));

    add('Unleashed dogs are on a lawn with their owner', dogs
      .filter((d) => !d.leashed)
      .filter((d) => {
        const o = this.owner(d);
        return d.locationType !== 'lawn' || !o || o.locationType !== 'lawn' || o.locationId !== d.locationId;
      })
      .map((d) => `${d.name} is loose`));

    add('Only unleashed dogs play', this.users
      .filter((u) => u.activity === 'playing' && (u.type !== 'dog' || u.leashed))
      .map((u) => `${u.name} is playing on the leash`));

    const shapes = [...this.lawns, ...this.paths, ...this.benches];
    const overlaps = [];
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        if (G.polygonsOverlap(shapes[i].boundary, shapes[j].boundary)) {
          overlaps.push(`${shapes[i].name} overlaps ${shapes[j].name}`);
        }
      }
    }
    add('Lawn, path and bench boundaries do not overlap', overlaps);

    add('Every lawn and bench borders a path', [
      ...this.lawns.filter((l) => l.borderedBy.length === 0).map((l) => `${l.name} borders no path`),
      ...this.benches.filter((b) => !this.paths.some((p) =>
        Math.min(...b.boundary.map((c) => G.distanceToPolygon(c, p.boundary))) <= 0.5))
        .map((b) => `${b.name} is away from any path`),
    ]);

    add(`Path width ≥ ${MIN_PATH_WIDTH} ft`, this.paths
      .filter((p) => p.width < MIN_PATH_WIDTH)
      .map((p) => `${p.name} is ${p.width} ft wide`));

    add(`Grass height between ${GRASS_MIN}″ and ${GRASS_MAX}″`, this.lawns
      .filter((l) => l.grassHeight < GRASS_MIN || l.grassHeight > GRASS_MAX)
      .map((l) => `${l.name} is ${l.grassHeight.toFixed(1)}″`));

    return results;
  }
}
