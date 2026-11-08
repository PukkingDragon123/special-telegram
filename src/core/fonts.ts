import { asset } from './util';

/**
 * Thai font families shipped in public/assets/fonts (Google Fonts, OFL). Only the files listed in
 * FILES are loaded at boot (fewer fonts = faster start).
 * CLIENT RULE: only LOOPED Thai fonts (ไทยมีหัว). Loopless families (Kanit, Mitr, Prompt,
 * Chakra Petch, Bai Jamjuree, Athiti, Pattaya…) are intentionally NOT shipped — never add them.
 * Use these names in canvas `ctx.font` strings, e.g. `ctx.font = \`800 48px ${F.heavy}\``.
 */
export const F = {
  /** MAIN UI FACE: Noto Sans Thai Looped (variable 100–900) — clean, modern, used for HUD, prompts,
   *  bubbles, headlines (use weight 800–900 for punchy headlines). The user asked for a new, better
   *  font and NO handwriting faces anywhere, so every old handwriting/calligraphy name aliases to it. */
  heavy: '"Noto Sans Thai Looped"',
  ui: '"Noto Sans Thai Looped"',
  body: '"Noto Sans Thai Looped"',
  looped: '"Noto Sans Thai Looped"',
  serif: '"Noto Serif Thai"',
  /** high-contrast looped serif (400,700,900) — newspaper & magazine headlines */
  news: '"Taviraj"',
  news2: '"Trirong"',
  /** the floating 3D dialogue lettering (3D text uses public/assets/gen/text3d/*.ttf = Noto instances) */
  krub: '"Noto Sans Thai Looped"',
  /** rounded looped display (400,600,700) — the main title / bubbly lettering */
  bubbly: '"Kodchasan"',
  round: '"Noto Sans Thai Looped"',
  /** chunky looped display serif (big titles only) */
  display: '"Chonburi"',
  /** NO handwriting: these old names alias to clean faces */
  hand: '"Noto Sans Thai Looped"',
  hand2: '"Noto Sans Thai Looped"',
  scrawl: '"Noto Sans Thai Looped"',
  fancy: '"Taviraj"',
  fancy2: '"Taviraj"',
  fancy3: '"Taviraj"',
  stylish: '"Noto Sans Thai Looped"',
  serif2: '"Noto Serif Thai"',
  serif3: '"Noto Serif Thai"',
  tech: '"Noto Sans Thai Looped"',
  prompt: '"Noto Sans Thai Looped"',
  jamjuree: '"Noto Sans Thai Looped"',
} as const;

const FILES: [string, string, string, string?][] = [
  ['Noto Sans Thai Looped', 'NotoSansThaiLooped', '100 900'], ['Noto Serif Thai', 'NotoSerifThai', '100 900'],
  ['Taviraj', 'Taviraj-Regular', '400'], ['Taviraj', 'Taviraj-Bold', '700'], ['Taviraj', 'Taviraj-Black', '900'],
  ['Trirong', 'Trirong-Regular', '400'], ['Trirong', 'Trirong-Bold', '700'], ['Trirong', 'Trirong-Black', '900'],
  ['Kodchasan', 'Kodchasan-Regular', '400'], ['Kodchasan', 'Kodchasan-SemiBold', '600'], ['Kodchasan', 'Kodchasan-Bold', '700'],
  ['Chonburi', 'Chonburi-Regular', '400'],
,
  // legacy family names still written literally in some canvases → same clean Noto file (cached once)
  ...(['K2D', 'Sarabun', 'IBM Plex Sans Thai Looped', 'Krub', 'KoHo', 'Itim', 'Mali', 'Sriracha', 'Fahkwang', 'Pattaya', 'Niramit', 'Thasadith'] as const)
    .map((fam) => [fam, 'NotoSansThaiLooped', '100 900'] as [string, string, string]),
  ...(['Charmonman', 'Charm', 'Srisakdi', 'Maitree', 'Pridi'] as const).map((fam) => [fam, 'NotoSerifThai', '100 900'] as [string, string, string]),
];

let loading: Promise<void> | null = null;

/** Load all game fonts (awaited at boot so canvas text renders with correct Thai shaping). */
export function loadFonts(): Promise<void> {
  if (loading) return loading;
  loading = Promise.all(
    FILES.map(async ([fam, file, weight, style]) => {
      try {
        const ff = new FontFace(fam, `url(${asset('fonts/' + file + '.woff2')}) format("woff2")`, { weight, style: style ?? 'normal', display: 'block' } as any);
        await ff.load();
        (document as any).fonts.add(ff);
      } catch (e) {
        console.warn('[fonts] failed', file, e);
      }
    }),
  ).then(() => undefined);
  return loading;
}
