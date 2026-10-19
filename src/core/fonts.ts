import { asset } from './util';

/**
 * Thai font families shipped in public/assets/fonts (Google Fonts, OFL).
 * Use these names in canvas `ctx.font` strings, e.g. `ctx.font = \`700 48px ${F.heavy}\``.
 */
export const F = {
  /** heavy modern sans (400,500,700,800,900, 900 italic) — signs, headlines, floating text */
  heavy: '"Kanit"',
  /** friendly rounded sans (400,500,700) — speech bubbles, prompts */
  ui: '"Mitr"',
  /** neutral sans (300,400,700) — small print */
  body: '"Sarabun"',
  /** classic looped Thai (variable) — newspaper / magazine body text */
  looped: '"Noto Sans Thai Looped"',
  serif: '"Noto Serif Thai"',
  /** high-contrast serif (400,700,900) — newspaper & magazine headlines */
  news: '"Taviraj"',
  news2: '"Trirong"',
  /** bubbly display — main title (album-cover style) */
  bubbly: '"Pattaya"',
  /** chunky display serif */
  display: '"Chonburi"',
  /** handwriting */
  hand: '"Itim"',
  hand2: '"Mali"',
  scrawl: '"Sriracha"',
  /** calligraphic */
  fancy: '"Charmonman"',
  fancy2: '"Charm"',
  fancy3: '"Srisakdi"',
  /** techy */
  tech: '"Chakra Petch"',
  prompt: '"Prompt"',
  round: '"Athiti"',
  jamjuree: '"Bai Jamjuree"',
} as const;

const FILES: [string, string, string, string?][] = [
  ['Kanit', 'Kanit-Regular', '400'], ['Kanit', 'Kanit-Medium', '500'], ['Kanit', 'Kanit-Bold', '700'],
  ['Kanit', 'Kanit-ExtraBold', '800'], ['Kanit', 'Kanit-Black', '900'], ['Kanit', 'Kanit-BlackItalic', '900', 'italic'],
  ['Mitr', 'Mitr-Regular', '400'], ['Mitr', 'Mitr-Medium', '500'], ['Mitr', 'Mitr-Bold', '700'],
  ['Sarabun', 'Sarabun-Light', '300'], ['Sarabun', 'Sarabun-Regular', '400'], ['Sarabun', 'Sarabun-Bold', '700'],
  ['Noto Sans Thai Looped', 'NotoSansThaiLooped', '100 900'], ['Noto Serif Thai', 'NotoSerifThai', '100 900'],
  ['Taviraj', 'Taviraj-Regular', '400'], ['Taviraj', 'Taviraj-Bold', '700'], ['Taviraj', 'Taviraj-Black', '900'],
  ['Trirong', 'Trirong-Regular', '400'], ['Trirong', 'Trirong-Bold', '700'],
  ['Pattaya', 'Pattaya-Regular', '400'], ['Chonburi', 'Chonburi-Regular', '400'],
  ['Itim', 'Itim-Regular', '400'], ['Mali', 'Mali-Regular', '400'], ['Mali', 'Mali-Bold', '700'],
  ['Sriracha', 'Sriracha-Regular', '400'],
  ['Charmonman', 'Charmonman-Regular', '400'], ['Charmonman', 'Charmonman-Bold', '700'],
  ['Charm', 'Charm-Regular', '400'], ['Charm', 'Charm-Bold', '700'],
  ['Srisakdi', 'Srisakdi-Regular', '400'], ['Srisakdi', 'Srisakdi-Bold', '700'],
  ['Chakra Petch', 'ChakraPetch-Regular', '400'], ['Chakra Petch', 'ChakraPetch-Bold', '700'],
  ['Prompt', 'Prompt-Regular', '400'], ['Prompt', 'Prompt-SemiBold', '600'], ['Prompt', 'Prompt-Black', '900'],
  ['Athiti', 'Athiti-SemiBold', '600'], ['Bai Jamjuree', 'BaiJamjuree-Regular', '400'], ['Bai Jamjuree', 'BaiJamjuree-Bold', '700'],
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
