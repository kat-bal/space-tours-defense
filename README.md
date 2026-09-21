# Space Tours Defense

A small arcade game that drops onto any web page with one line of HTML. Raiders
between here and Saturn, a liner full of tourists behind you, and nothing else
in the way.

**Play it:** [kat-bal.github.io/space-tours-defense](https://kat-bal.github.io/space-tours-defense/)

It is the arcade companion to [Space Tours](https://calverasolutions.eu/lab.html),
the booking API sandbox used for teaching API testing. Same fictional universe,
no shared code: this repository is one JavaScript file with no dependencies and
no build step.

## Embedding it

Copy `space-tours-defense.js` next to your HTML and add:

```html
<div data-space-tours-game></div>
<script src="space-tours-defense.js"></script>
```

That is the whole integration. The script finds every
`[data-space-tours-game]` element on the page and mounts itself into it.

The widget fills the width of its container. Given no height of its own it
takes a 4:3 box on desktop and a 3:4 box under 480px, where a letterboxed
playfield is unplayable. Give the container a height and it uses that instead.

To mount by hand, for instance after rendering something dynamically:

```js
const game = SpaceToursDefense.mount('#arcade', { attract: false, lives: 5 });
// game.destroy() when you tear the container down
```

## Options

Set them as data attributes on the container, or pass them as an object to
`SpaceToursDefense.mount()`.

| Attribute | Option | Default | What it does |
|---|---|---|---|
| `data-attract` | `attract` | `true` | Plays itself, arcade cabinet style, until someone clicks. `false` gives a still title screen. |
| `data-sound` | `sound` | `false` | Sound stays off until asked for. The attract demo is always silent. |
| `data-lives` | `lives` | `3` | Escort ships you start with. |
| `data-aspect` | `aspect` | `4 / 3` | Box shape, used only when the container has no height. Setting it disables the narrow-screen switch to portrait. |
| `data-title` | `title` | Space Tours Defense | Heading on the title screen. |
| `data-credit-label` | `creditLabel` | none | Optional credit line under the start button. |
| `data-credit-href` | `creditHref` | none | Link for that credit line. |

## Controls

| | |
|---|---|
| Move | `←` `→` or `A` `D` |
| Fire | `Space` or `Enter` |
| Pause | `P` or `Escape` |
| Sound | `M` |
| Touch | Drag anywhere to steer, hold to fire, or use the on-screen buttons |

## How it behaves on a real page

- **It cannot break your styling, and your styling cannot break it.** Everything
  lives in a shadow root.
- **It borrows your palette.** If the page defines `--bg`, `--line`, `--text`,
  `--text-muted-solid`, `--gold`, `--ember`, `--pulse`, `--pulse-dim`,
  `--danger` or `--ok`, the game uses them. Otherwise it falls back to its own.
- **It stops when nobody is looking.** Scrolled out of view or in a background
  tab, the loop does no work. A game in progress pauses when the window loses
  focus.
- **It does not steal your keyboard.** Arrow keys and space are only captured
  while the widget itself has focus, so the page scrolls normally everywhere else.
- **It respects `prefers-reduced-motion`**: no screen shake, far fewer particles,
  a near-still starfield.
- **It sends nothing anywhere.** No network calls, no analytics, no cookies. The
  high score sits in `localStorage` on the visitor's own machine.

## The game itself

Five rows of raiders step across the screen and drop a row at each wall, faster
as their numbers thin out, which is the shape of the 1978 original. What is
different: four destructible cargo pods rather than bunkers, a salvage barge
crossing the top for bonus points, and a liner filling the bottom of the screen
that ends the run if the raiders reach it. Waves are named after the Space Tours
destinations, Mercury through Neptune, and then keep going. An extra escort ship
every 3000 points.

## Development

No build step and no dependencies. Serve the folder and open it:

```bash
python3 -m http.server 8000
```

`space-tours-defense.js` is the whole game; `index.html` is the demo page that
GitHub Pages serves.

Every interactive element carries a `data-testid` (`game-root`, `game-canvas`,
`game-btn-start`, `game-btn-pause`, `game-btn-sound`, `game-btn-left`,
`game-btn-right`, `game-btn-fire`, `game-overlay`, `game-title`, `game-status`),
and the live instance is reachable as `element.__spaceToursDefense`, so its state
can be read and driven from a test.

## License

MIT. See [LICENSE](LICENSE).
