<<<<<<< HEAD
# TrainTrack

Wooden train sets from the 90s and 00s are discontinued and command ~$100s on eBay. Recreate the joy of playing with toy train sets directly in the browser with TrainTrack.

# Quickstart

```
npm run dev
```

Hosted locally at http://localhost:5174/ 

# Resources

- [Track piece dimensions and specs](https://woodenrailway.info/track/track-math)
- [Thomas the tank engine toy train wiki](https://thomaswoodenrailway.fandom.com/wiki/Official_Website). 
- [Thomas the tank engine track types, history, pieces, etc](https://thomaswoodenrailway.fandom.com/wiki/Track#Traction_Rail)

## Features

### Build mode
- **Drag-and-drop track library** grouped by type: straights, curves, switches, elevation, adapters.
- **Elastic "wiggle-room" snapping.** Drag a piece near another's free end and it clicks into
  place. Joints tolerate a little pull-apart and angular play (just like real BRIO), so imperfect
  loops — the kind 45° curves and √2 distances make unavoidable — still close and run smoothly.
- **Select → rotate / flip / delete** from the toolbar or keyboard.
- **Drag a piece back onto the sidebar to delete it** (the palette highlights as a drop-zone).
- **Pan** (drag the background) and **zoom** (mouse wheel).

### Piece library
- **Straights:** standard A (144 mm), short A1 (108 mm), long D (216 mm).
- **Curves:** large 45° curve (≈202 mm radius) and a **tight 45° curve** (≈110 mm radius). Flip for the opposite hand.
- **Switches (points):** 1 female → 2 male, and 1 male → 2 female. Click to flip the active route.
- **Y splits:** symmetric two-curve forks, in 1 female → 2 male and 1 male → 2 female layouts.
- **3-way (T) switch:** straight + left + right from a single end; click cycles through all three routes.
- **Ascender ramps:** climb one level over a long-straight run, in both **F→M** and **M→F** gender layouts (flip either one for a descent).
- **Adapters:** double-male and double-female connectors to resolve gender mismatches and close loops.

### Elevation & crossings
- Ascenders raise connected track to higher **levels**; levels propagate across joints out from
  the ground automatically (any flat piece can sit on a raised level just by connecting to a ramp).
- Higher track and its trains render **on top**, so a train passing under a bridge is correctly
  hidden — true over/under crossings. Male pegs always render over their matching sockets.

### Trains
- Drop an **engine + cars** onto any track; cars follow the lead around curves, switches and joints.
- **Play / Pause** and a **speed** slider. Trains take the active branch at switches (and the points
  auto-throw to the route the lead actually drives), and reverse at open-ended track.

### Persistence
- **Save / Load** to the browser (localStorage).
- **Export / Import** a layout as JSON.

## Controls

| Action | How |
|---|---|
| Place a piece / train | Drag from the left palette onto the table |
| Move a piece | Drag it |
| Delete a piece | Drag it back onto the palette, or select it and press Delete |
| Snap pieces together | Drag one piece's end near another's free end |
| Rotate selected | `r` / `R` (or the toolbar 45° buttons) |
| Flip selected | `f` (or the Flip button) |
| Delete selected | `Delete` / `Backspace` (or the Delete button) |
| Flip a switch route | Click the switch |
| Play / Pause | `Space` (or the Play button) |
| Pan / Zoom | Drag background / mouse wheel |

## Tech stack

- **Vite** + **React 19** + **TypeScript**
- **react-konva** (HTML5 Canvas) for rendering, hit-testing and the `requestAnimationFrame` loop
- **zustand** for state

All geometry uses millimetres as world units (`src/track/constants.ts` is the source of truth) and
is rendered at an adjustable scale.

## Project layout

```
src/
  geometry/    line/arc segment math, poses, sampling
  track/       constants, the piece library (defs), connector + render helpers, placed-piece transforms
  network/     port world-transform, elastic snapping, connection graph, elevation levels
  train/       train model + movement along the connected network
  state/       zustand store (layout + simulation)
  components/  Palette, CanvasStage, PieceShape, Connector, TrainShape, Toolbar
```

## Development

```sh
npm install
npm run dev      # start the dev server
npm run build    # type-check + production build
npm run preview  # preview the production build
```
