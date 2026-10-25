import { asset } from './util';

/**
 * Thai font families shipped in public/assets/fonts (Google Fonts, OFL).
 * CLIENT RULE: only LOOPED Thai fonts (ไทยมีหัว). Loopless families (Kanit, Mitr, Prompt,
 * Chakra Petch, Bai Jamjuree, Athiti, Pattaya…) are intentionally NOT shipped — never add them.
 * Use these names in canvas `ctx.font` strings, e.g. `ctx.font = \`800 48px ${F.heavy}\``.
 */
export const F = {
  /** heavy looped sans (400,700,800) — signs, headlines, floating money text */
  heavy: '"K2D"',
  /** friendly looped sans (400,500,600,700) — speech bubbles, prompts, UI */
  ui: '"IBM Plex Sans Thai Looped"',
  /** neutral looped sans (300–800) — small print, subtitles */
  body: '"Sarabun"',
  /** classic looped Thai (variable 100–900) — newspaper / magazine body, very heavy headlines */
  looped: '"Noto Sans Thai Looped"',
  serif: '"Noto Serif Thai"',
  /** high-contrast looped serif (400,700,900) — newspaper & magazine headlines */
  news: '"Taviraj"',
  news2: '"Trirong"',
  /** rounded-square looped display (700, Cadson Demak "Krub") — the floating 3D dialogue lettering */
  krub: '"Krub"',
  /** rounded looped display (400,600,700) — the main title / bubbly lettering */
  bubbly: '"Kodchasan"',
  /** soft rounded looped (400,600,700) */
  round: '"KoHo"',
  /** chunky looped display serif */
  display: '"Chonburi"',
  /** handwriting (looped) */
  hand: '"Itim"',
  hand2: '"Mali"',
  scrawl: '"Sriracha"',
  /** calligraphic */
  fancy: '"Charmonman"',
  fancy2: '"Charm"',
  fancy3: '"Srisakdi"',
  /** stylish looped */
  stylish: '"Fahkwang"',
  serif2: '"Maitree"',
  serif3: '"Pridi"',
  /** kept for older code: maps to looped faces */
  tech: '"IBM Plex Sans Thai Looped"',
  prompt: '"Sarabun"',
  jamjuree: '"Sarabun"',
} as const;

const FILES: [string, string, string, string?][] = [
  ['K2D', 'K2D-Regular', '400'], ['K2D', 'K2D-Bold', '700'], ['K2D', 'K2D-ExtraBold', '800'],
  ['IBM Plex Sans Thai Looped', 'IBMPlexSansThaiLooped-Regular', '400'], ['IBM Plex Sans Thai Looped', 'IBMPlexSansThaiLooped-Medium', '500'],
  ['IBM Plex Sans Thai Looped', 'IBMPlexSansThaiLooped-SemiBold', '600'], ['IBM Plex Sans Thai Looped', 'IBMPlexSansThaiLooped-Bold', '700'],
  ['Sarabun', 'Sarabun-Light', '300'], ['Sarabun', 'Sarabun-Regular', '400'], ['Sarabun', 'Sarabun-Medium', '500'],
  ['Sarabun', 'Sarabun-SemiBold', '600'], ['Sarabun', 'Sarabun-Bold', '700'], ['Sarabun', 'Sarabun-ExtraBold', '800'], ['Sarabun', 'Sarabun-BoldItalic', '700', 'italic'],
  ['Noto Sans Thai Looped', 'NotoSansThaiLooped', '100 900'], ['Noto Serif Thai', 'NotoSerifThai', '100 900'],
  ['Taviraj', 'Taviraj-Regular', '400'], ['Taviraj', 'Taviraj-Bold', '700'], ['Taviraj', 'Taviraj-Black', '900'],
  ['Trirong', 'Trirong-Regular', '400'], ['Trirong', 'Trirong-Bold', '700'], ['Trirong', 'Trirong-Black', '900'],
  ['Kodchasan', 'Kodchasan-Regular', '400'], ['Kodchasan', 'Kodchasan-SemiBold', '600'], ['Kodchasan', 'Kodchasan-Bold', '700'],
  ['KoHo', 'KoHo-Regular', '400'], ['KoHo', 'KoHo-SemiBold', '600'], ['KoHo', 'KoHo-Bold', '700'],
  ['Chonburi', 'Chonburi-Regular', '400'], ['Krub', 'Krub-Bold', '700'],
  ['Itim', 'Itim-Regular', '400'], ['Mali', 'Mali-Regular', '400'], ['Mali', 'Mali-Bold', '700'], ['Sriracha', 'Sriracha-Regular', '400'],
  ['Charmonman', 'Charmonman-Regular', '400'], ['Charmonman', 'Charmonman-Bold', '700'],
  ['Charm', 'Charm-Regular', '400'], ['Charm', 'Charm-Bold', '700'],
  ['Srisakdi', 'Srisakdi-Regular', '400'], ['Srisakdi', 'Srisakdi-Bold', '700'],
  ['Fahkwang', 'Fahkwang-Regular', '400'], ['Fahkwang', 'Fahkwang-Bold', '700'],
  ['Maitree', 'Maitree-Regular', '400'], ['Maitree', 'Maitree-Bold', '700'],
  ['Pridi', 'Pridi-Regular', '400'], ['Pridi', 'Pridi-Bold', '700'],
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
