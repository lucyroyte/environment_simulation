# Environment Simulation: Neighborhood Park

A single-page web app, written in vanilla JavaScript with three.js, that visualizes a semantic model of a park. The model has lawns, paths and users, the relationships between them, and the rules they must follow.

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
- **User**: position (x, y), activity (walking/standing/sitting), location (a path or a lawn).

Relationships are derived from geometry. A path *borders* a lawn, and *connects to* another path, when their boundaries share an edge segment.

The **Rules** panel checks every rule after each action. Actions enforce the rules:

- Users can enter a lawn only if it is open and holds fewer than ⌊area ÷ 10 ft²⌋ users.
- A walking user who changes activity steps onto the nearest bordering lawn that allows it, and stands. A sitting user who changes activity moves to the nearest path and walks.
- Mowing (to 5″) is refused while anyone is on the lawn.
- Closing a lawn moves its users to the nearest path, where they walk.
- Advancing time moves walkers along the path network (turning at junctions) and grows grass, up to 20″.

## Example scene

A loop of four paths with a center path crossing it. There are three lawns of different sizes: Great Lawn, East Meadow (starts at 17″, needs mowing) and Rose Corner (starts closed). Ten users: 6 walking, 3 sitting, 1 standing.

Visual encoding:
- Grass color runs from light green (short) to dark green (tall), and the grass tufts grow taller.
- A lawn that needs mowing has a pulsing amber dashed outline and a badge.
- A closed lawn has a fence and red hatching.
- Users are colored by activity: blue for walking, orange for standing, purple for sitting.

Click to select. Drag to orbit, scroll to zoom. Keyboard: `A` add, `Del` remove, `C` activity, `T` advance, `P` play, `M` mow, `O` open/close, `Esc` deselect.
