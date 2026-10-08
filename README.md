# Environment Simulation: Neighborhood Park

A single-page web app, written in vanilla JavaScript with three.js, that visualizes a semantic model of a park. The model has lawns, paths, benches and users (people and dogs), the relationships between them, and the rules they must follow.

## Run

The app uses ES modules, so serve the folder over HTTP instead of opening the file directly:

```sh
npx http-server -c-1 .     # or: python3 -m http.server
```

Then open http://localhost:8080 (or :8000). three.js is loaded from the jsDelivr CDN.

## Files

| File | Role |
| --- | --- |
| `js/model.js` | The semantic model: entities, relationships, rules, actions. Has no rendering code. |
| `js/geometry.js` | Polygon helpers: area, containment, overlap, shared edges. |
| `js/view.js` | three.js scene: lawns, paths, users, fences, labels, animation. |
| `js/main.js` | Toolbar, selection, inspector, rule checklist, event log. |

## Model

- **Lawn**: grass height (2–20″), boundary polygon, area (from the boundary), status (open/closed).
- **Path**: width (ft) and boundary polygon. The boundary is swept from a centerline.
- **Bench**: 3 seats, standing just off a path and facing it.
- **User**: a person or a dog. Position (x, y), activity (walking/standing/sitting, plus playing for dogs), location (a path, lawn or bench). A dog has an owner and is on or off its leash.

Relationships are derived from geometry. A path *borders* a lawn, and *connects to* another path, when their boundaries share an edge segment.

The **Rules** panel checks every rule after each action. Actions enforce the rules:

- Users can enter a lawn only if it is open and holds fewer than ⌊area ÷ 10 ft²⌋ users. Dogs count as users.
- People stand on lawns and sit on lawns or benches. Only people sit on benches, at most 3 per bench.
- A leashed dog stays within 6 ft of its owner and does what they do. An unleashed dog must be on a lawn with its owner. Only unleashed dogs play.
- A walking user who changes activity steps onto the nearest bordering lawn that allows it, and stands. A sitting user who changes activity moves to the nearest path and walks.
- Sit on bench moves a person to the nearest bench with a free seat. Their dogs lie on the path at their feet.
- Add dog gives the selected person a leashed dog, or brings a new visitor with a dog. Unleash works only when the owner is on a lawn. Fetch has the owner throw a ball for an unleashed dog.
- Mowing (to 5″) is refused while anyone is on the lawn. Clear lawn sends everyone on it (people and their dogs) to the nearest path, so it can then be mowed.
- Closing a lawn moves its users to the nearest path, where they walk.
- Advancing time moves walkers along the path network (turning at junctions) and grows grass, up to 20″.

## Example scene

A loop of four paths with a center path crossing it. There are three lawns of different sizes: Great Lawn, East Meadow (starts at 17″, needs mowing) and Rose Corner (starts closed). Eleven people: 6 walking (one with a leashed dog), 3 sitting on lawns (one with a dog playing off leash), 1 standing and 1 sitting on a bench. Five benches line the paths.

Visual encoding:
- Grass color runs from light green (short) to dark green (tall), and the grass tufts grow taller.
- A lawn that needs mowing has a pulsing amber dashed outline and a badge.
- A closed lawn has a fence and red hatching.
- Users are colored by activity: blue for walking, orange for standing, purple for sitting, pink for playing. People's bodies take the color. Dogs show it on their collar and on a disk under them, and a red line marks a leash.
- Bench labels show seats taken, for example `1/3`.

Click to select. Drag to orbit, scroll to zoom. Keyboard: `A` add, `Del` remove, `C` activity, `B` bench, `D` dog, `L` leash, `F` fetch, `T` advance, `P` play, `X` clear lawn, `M` mow, `O` open/close, `Esc` deselect. The model is exposed as `window.parkApp` for poking at it from the console.
