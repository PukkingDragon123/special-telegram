# Polish wave (client feedback, Oct 25)

Client, verbatim: "The map still looks bad and never use text bubble have just floating 3d realistic text and the
skill tree make when click theres a button and you look up and its like dreamy heaven show sky another scene with
like the skill tree its not a tree are you stupid show like skill floating prop also the map looks lazy i want super
polish shader real detailed assets with physic not cube assets low poly polish"

Four agents work at the same time in this tree:

| Agent | Owns (may edit) |
|---|---|
| **text3d** | `src/ui3d/*` (bubbles, text, choice, cloud, new `text3d.ts`), `public/assets/gen/text3d/`, and the minimum call-site changes in modules that draw their OWN bubbles/labels (it replaces them with the new API) |
| **heaven** | `src/modules/social/*` (think mode, skill visuals, flytext, cloud), `public/assets/gen/social/` |
| **props** | `src/modules/world/{props,dressing,market,rural}.ts`, new `src/modules/world/realprops*.ts`, `scripts/polyhaven.mjs`, `public/assets/gen/world/models/`, plus the `build` visuals of furniture/prop items in `restaurant`/`shops`/`cooking` (visual only) |
| **buildings** | `src/modules/world/{mats,shophouse,buildings,streets,geo,sky,lights,wires,canal,signs,foliage,weather,layout}.ts`, `src/core/postfx.ts`, `public/assets/gen/world/` (not `models/`, except own downloads via the shared script) |
| **food** | `src/modules/cooking/*` food/ingredient/dish visuals + physics feel (not furniture items), small generic hooks in `src/game/items.ts`, `public/assets/gen/cooking/` |
| **creatures** | `src/modules/life/{creature,quad,pets,tex}.ts`, `src/modules/characters/*`, `scripts/life/`, `public/assets/gen/{life,characters}/` |
| **lead** | `src/modules/menu/*` (album cover + newspaper on the main menu), integration |

Follow-up from the client: "make textured and model hyper realistic, add cooler and polish models, make dogs have rig fur, the food
have physic bouncy super polish satisfying, use new font too, and make menu show the album cover and newspaper".

`src/modules/world/index.ts` is shared by props + buildings: keep edits there to a few lines, re-read before every edit.

## Shared 3D text API (owned by text3d; heaven codes against it)

```ts
// src/ui3d/text3d.ts
export type Font3D = 'heavy' | 'ui' | 'bubbly' | 'display' | 'hand' | 'news';
export interface Text3DOpts {
  font?: Font3D;            // looped Thai faces only (K2D, IBM Plex Sans Thai Looped, Kodchasan, Chonburi, Itim, Taviraj)
  size?: number;            // letter height in metres (default 0.12)
  depth?: number;           // extrusion depth, fraction of size (default 0.18)
  bevel?: number;           // bevel, fraction of size (default 0.04)
  color?: THREE.ColorRepresentation;      // face colour
  side?: THREE.ColorRepresentation;       // extrusion/side colour (default darker face colour)
  metalness?: number; roughness?: number; emissive?: number; // physical look
  align?: 'left' | 'center' | 'right';
  maxWidth?: number;        // metres; Thai-aware wrapping (Intl.Segmenter)
  lineHeight?: number;
  castShadow?: boolean;
}
export class Text3D extends THREE.Group {
  readonly width: number; readonly height: number;   // metres (0 until the font is ready)
  readonly glyphCount: number;
  reveal: number;           // glyphs shown (typewriter, each glyph pops in); default = all
  readonly ready: Promise<void>;
  setText(text: string): void;
  dispose(): void;
}
export function text3d(text: string, o?: Text3DOpts): Text3D;   // sync; geometry fills in when the font is loaded
export function preloadText3D(): Promise<void>;
```

Real geometry: HarfBuzz (`harfbuzzjs`, already installed) shapes the Thai text and gives glyph outlines,
which become `THREE.Shape` and then `ExtrudeGeometry` with a bevel. This gives correct Thai mark stacking, PBR-lit
letters that cast shadows, and per-glyph geometry caching.
