"""R5-audio recipes: every shipped key, its variants and processing. Imported by build.py."""
import functools
from build import Entry, V
import designs as D
from designs import mk, kn, og

P = functools.partial
ENTRIES = []


def add(*a, **k):
    ENTRIES.append(Entry(*a, **k))


C = "sfx/cooking"
# ----------------------------------------------------------------------------------------------- COOKING
add("wok_sizzle_loop", C, "sfx", "Steady hard sizzle of food stir-frying in a hot wok (loop under all cooking).",
    [V(mk(123), ss=2.5, t=15.0, xfade=1.5)], vol=0.55, loop=True, pitchVar=0.0, lufs=-18)
add("sizzle_burst", C, "sfx", "Food/ingredient hits hot oil: hiss + sizzle swell that settles (play on add-to-wok).",
    [V(P(D.sizzle_burst, 1, 2.0, 3.0, 1.0)), V(P(D.sizzle_burst, 2, 1.6, 9.0, 1.07)),
     V(P(D.sizzle_burst, 3, 2.6, 14.0, 0.94))], vol=0.75, pitchVar=0.06)
add("oil_pour", C, "sfx", "Pouring cooking oil into the wok (thick pour, first drops start to sizzle).",
    [V(D.oil_pour)], vol=0.6, pitchVar=0.05)
add("sauce_glug", C, "sfx", "Glugging a sauce bottle (fish sauce / oyster sauce / soy) - air bubbles + thick pour.",
    [V(P(D.glug, 1, 4)), V(P(D.glug, 2, 3))], vol=0.65, pitchVar=0.08)
add("liquid_splash", C, "sfx", "Small liquid splash (water/sauce splashed into the wok or a bowl).",
    [V(mk(1311), af="highpass=f=120")], vol=0.6, pitchVar=0.08)
add("sprinkle", C, "sfx", "Sprinkling sugar / MSG / pepper / chili flakes from a shaker or spoon.",
    [V(og("salt", "adding_salt_01.ogg"), ss=0.7, t=1.25), V(og("salt", "adding_salt_01.ogg"), ss=2.05, t=1.1)],
    vol=0.55, pitchVar=0.1)
add("spatula_scrape", C, "sfx", "Metal spatula (ตะหลิว) scraping/stirring in the wok - play on every stir stroke.",
    [V(P(D.spatula_scrape, s, d)) for s, d in [(1, 0.34), (2, 0.42), (3, 0.28), (4, 0.55)]],
    vol=0.5, pitchVar=0.08)
add("wok_toss", C, "sfx", "Wok toss: whoosh + metal clank on the burner + food landing back with a sizzle swell.",
    [V(P(D.wok_toss, 1)), V(P(D.wok_toss, 2))], vol=0.7, pitchVar=0.05)
add("egg_crack", C, "sfx", "Egg shell cracked on the wok rim.",
    [V(mk(3143), ss=1.72, t=0.4), V(mk(3143), ss=2.2, t=0.4)], vol=0.7, pitchVar=0.06)
add("egg_fry_crackle_loop", C, "sfx", "Fried egg (ไข่ดาว) bubbling/crackling in lots of oil (loop while the egg fries).",
    [V(mk(121), ss=1.0, t=17.0, xfade=1.5)], vol=0.6, loop=True, pitchVar=0.0, lufs=-19)
add("gas_ignite", C, "sfx", "Gas burner ignition: click-click-click then WHOOMP as the flame catches.",
    [V(D.gas_ignite)], vol=0.7, pitchVar=0.03)
add("burner_roar_loop", C, "sfx", "Thai high-pressure LPG burner (เตาฟู่) jet roar, loop while the flame is on.",
    [V(D.burner_roar, xfade=1.5)], vol=0.45, loop=True, pitchVar=0.0, lufs=-20)
add("knife_chop_board", C, "sfx", "Cleaver/knife chop on a wooden cutting board (one hit per chop).",
    [V(P(D.knife_chop, i), fout=0.05, maxlen=0.22) for i in range(4)], vol=0.6, pitchVar=0.08)
add("mortar_pound", C, "sfx", "Wooden pestle pounding garlic/chili in a clay mortar (ครก): thunk + crunch.",
    [V(P(D.mortar_pound, i), maxlen=0.3, fout=0.06) for i in (1, 2, 3)], vol=0.7, pitchVar=0.06)
add("rice_scoop", C, "sfx", "Plastic paddle scooping sticky cooked rice from the rice cooker + tap on the rim.",
    [V(P(D.rice_scoop, 1)), V(P(D.rice_scoop, 2))], vol=0.55, pitchVar=0.06)
add("plate_down", C, "sfx", "Plate set down on a table/counter (ceramic / melamine).",
    [V(kn("impact-sounds", "impactPlate_medium_000.ogg")), V(kn("impact-sounds", "impactPlate_light_002.ogg")),
     V(mk(2933))], vol=0.6, pitchVar=0.06)
add("spoon_clink", C, "sfx", "Spoon/fork clinking on a plate.",
    [V(mk(132)), V(mk(1855)), V(mk(2835), ss=0.0, t=0.6)], vol=0.5, pitchVar=0.08)
add("dishes_stack", C, "sfx", "Stacking plates / bowls on top of each other.",
    [V(mk(2935)), V(kn("impact-sounds", "impactPlate_heavy_001.ogg"))], vol=0.6, pitchVar=0.05)
add("dish_clatter", C, "sfx", "Pile of dishes clattering (collecting dirty dishes / dropping them in the basin).",
    [V(mk(1848), ss=1.0, t=2.6, fout=0.4)], vol=0.6, pitchVar=0.04)
add("tap_water_loop", C, "sfx", "Tap water running into a basin (dish washing station).",
    [V(og("household", "kitchensink01.wav"), ss=20.0, t=11.0, xfade=1.0)], vol=0.5, loop=True, pitchVar=0.0,
    lufs=-20)
add("scrub_loop", C, "sfx", "Sponge scrubbing a plate in soapy water (loop while washing).",
    [V(D.scrub, xfade=0.6)], vol=0.5, loop=True, pitchVar=0.0, lufs=-20)
add("water_splash", C, "sfx", "Water splash (dunking a dish / bucket water).",
    [V(mk(3216)), V(mk(1311), rate=0.92)], vol=0.6, pitchVar=0.07)
add("boil_loop", C, "sfx", "Pot of water/soup boiling (noodle pot, tom yum).",
    [V(og("boil", "cooking_without_cover_01_0.ogg"), ss=0.3, t=9.5, xfade=1.0)], vol=0.5, loop=True,
    pitchVar=0.0, lufs=-21)
add("steam_hiss", C, "sfx", "Burst of steam hiss (lid lifted / water hits hot wok).",
    [V(D.steam_hiss)], vol=0.5, pitchVar=0.06)
add("burnt_smoke_hiss", C, "sfx", "Food burning: angry hiss + crackle + smoke (play when burnt-ness passes the limit).",
    [V(D.burnt_hiss)], vol=0.65, pitchVar=0.04)
add("fire_whoosh", C, "sfx", "Wok flame-up whoosh (oil catches fire, big orange flame for a second).",
    [V(mk(1349), ss=0.5, t=2.6, fout=0.5)], vol=0.75, pitchVar=0.05)
add("rice_cooker_click", C, "sfx", "Rice cooker switch pops up (cooking done) - plastic clack.",
    [V(D.rice_cooker_click)], vol=0.6, pitchVar=0.03)
add("timer_ding", C, "sfx", "Kitchen timer / bell ding.",
    [V(mk(1791), fout=0.2)], vol=0.6, pitchVar=0.0)

I = "sfx/items"
# ----------------------------------------------------------------------------------------------- ITEMS
add("pickup", I, "sfx", "Picking an item up (E): cloth rustle + small whoosh.",
    [V(P(D.pickup, s)) for s in (1, 2, 3)], vol=0.45, pitchVar=0.1)
add("drop_plastic", I, "sfx", "Plastic item dropped (bottle, basket, plastic container).",
    [V(mk(3204)), V(mk(3088), maxlen=0.9, fout=0.1)], vol=0.55, pitchVar=0.1)
add("drop_metal", I, "sfx", "Metal item dropped (pan, ladle, can, tools).",
    [V(mk(835), maxlen=0.9, fout=0.2), V(mk(399), maxlen=0.85, fout=0.15)], vol=0.55, pitchVar=0.08)
add("drop_wood", I, "sfx", "Wooden item dropped (cutting board, chopsticks box, crate).",
    [V(kn("impact-sounds", "impactWood_medium_002.ogg")), V(kn("impact-sounds", "impactPlank_medium_001.ogg"))],
    vol=0.55, pitchVar=0.08)
add("drop_glass", I, "sfx", "Glass bottle/cup set down hard or dropped without breaking.",
    [V(kn("impact-sounds", "impactGlass_medium_001.ogg")), V(kn("impact-sounds", "impactGlass_light_003.ogg"))],
    vol=0.55, pitchVar=0.08)
add("glass_break", I, "sfx", "Glass shatters (dropped glass / bottle breaks).",
    [V(D.glass_break, fout=0.3)], vol=0.7, pitchVar=0.05)
add("drop_soft", I, "sfx", "Soft item / bag dropped (rice sack, ingredient bag, clothes).",
    [V(kn("impact-sounds", "impactSoft_heavy_002.ogg")), V(kn("impact-sounds", "impactSoft_medium_003.ogg"))],
    vol=0.55, pitchVar=0.08)
add("plastic_chair_scrape", I, "sfx", "Red plastic stool/chair dragged on concrete (the classic street-restaurant sound).",
    [V(P(D.plastic_drag, 1, 0.75, (75, 125))), V(P(D.plastic_drag, 2, 0.5, (95, 150)))], vol=0.55, pitchVar=0.08)
add("chair_stack", I, "sfx", "Stacking plastic chairs on top of each other.",
    [V(D.chair_stack)], vol=0.55, pitchVar=0.06)
add("table_drag", I, "sfx", "Folding/plastic table dragged across concrete.",
    [V(P(D.plastic_drag, 5, 1.3, (45, 80), (190, 420, 760, 1300), True))], vol=0.55, pitchVar=0.05)
add("cardboard", I, "sfx", "Cardboard box handled / put down (also the cardboard you sleep on).",
    [V(P(D.cardboard, 1)), V(P(D.cardboard, 2))], vol=0.55, pitchVar=0.08)
add("paper_rustle", I, "sfx", "Paper rustle (newspaper, menu poster, receipts).",
    [V(mk(2379), ss=0.85, t=1.1, fout=0.15), V(mk(2385), ss=1.15, t=1.0, fout=0.15)], vol=0.5, pitchVar=0.08)
add("book_open", I, "sfx", "Opening the old man's recipe book.",
    [V(kn("rpg-audio", "bookOpen.ogg"))], vol=0.55, pitchVar=0.04)
add("page_turn", I, "sfx", "Turning a page of the recipe book / magazine / newspaper.",
    [V(kn("rpg-audio", "bookFlip1.ogg")), V(kn("rpg-audio", "bookFlip2.ogg")), V(mk(1104))], vol=0.5, pitchVar=0.08)
add("plastic_bag_rustle", I, "sfx", "Thin plastic carrier bag crinkle (ถุงก๊อบแก๊บ) - market shopping, take-away.",
    [V(P(D.plastic_bag, 1, 1.2)), V(P(D.plastic_bag, 2, 0.8))], vol=0.45, pitchVar=0.1)
add("coin_clink", I, "sfx", "A couple of coins clinking (paying, giving change).",
    [V(mk(2003)), V(mk(1939)), V(mk(1993), ss=0.05, t=0.35, fout=0.08)], vol=0.55, pitchVar=0.08)
add("coins_handful", I, "sfx", "Handful of coins jingling (pulling out coins - the 100 baht scene).",
    [V(kn("rpg-audio", "handleCoins.ogg")), V(kn("rpg-audio", "handleCoins2.ogg"))], vol=0.55, pitchVar=0.06)
add("coin_on_table", I, "sfx", "Single coin dropped on a table (2nd variant spins down like a wobbling disc).",
    [V(P(D.coin_drop, 1, False)), V(P(D.coin_drop, 2, True))], vol=0.55, pitchVar=0.06)
add("banknote", I, "sfx", "Banknote snapped / counted / handed over.",
    [V(mk(2380), ss=0.1, t=0.7, fout=0.1), V(mk(2386))], vol=0.5, pitchVar=0.08)
add("cash_drawer", I, "sfx", "Cash drawer opening with a bell ding and coins (shop till).",
    [V(D.cash_drawer, fout=0.2)], vol=0.6, pitchVar=0.03)
add("bottle_open_fizz", I, "sfx", "Crown cap popped off a soda/beer bottle + fizz.",
    [V(D.bottle_open)], vol=0.6, pitchVar=0.05)
add("can_open", I, "sfx", "Ring-pull can opened: click + psssht + fizz.",
    [V(P(D.can_open, 6))], vol=0.6, pitchVar=0.05)
add("ice_cubes", I, "sfx", "Ice cubes dropped into a glass.",
    [V(mk(2834))], vol=0.55, pitchVar=0.06)
add("cup_fill", I, "sfx", "Pouring water/drink into a cup (water machine, iced tea).",
    [V(mk(2826), ss=0.2, t=4.0, fout=0.4)], vol=0.55, pitchVar=0.04)

PL = "sfx/player"
# ----------------------------------------------------------------------------------------------- PLAYER
add("footstep_concrete", PL, "sfx", "Footstep on concrete / pavement (shoes).",
    [V(kn("impact-sounds", f"footstep_concrete_00{i}.ogg")) for i in range(4)], vol=0.35, pitchVar=0.08)
add("footstep_flipflop", PL, "sfx", "Rubber flip-flop (รองเท้าแตะ) step: sole slap + heel flap. The players' default!",
    [V(P(D.flipflop, s)) for s in (1, 2, 3, 4)], vol=0.4, pitchVar=0.08)
add("footstep_wet", PL, "sfx", "Footstep in a puddle / on wet market floor.",
    [V(P(D.wet_step, s)) for s in (0, 1, 2)], vol=0.4, pitchVar=0.08)
add("overloaded_breath_loop", PL, "sfx", "Heavy panting while carrying too much (5/5 slots = overloaded).",
    [V(mk(379), ss=1.0, t=6.6, xfade=0.6)], vol=0.5, loop=True, pitchVar=0.0, lufs=-19)
add("grunt", PL, "sfx", "Effort grunt (lifting, throwing, snatching).",
    [V(mk(2174)), V(mk(2171)), V(mk(2056))], vol=0.6, pitchVar=0.08)
add("slap_hard", PL, "sfx", "Comedic face slap (right-click slap a friend): whoosh + smack + room.",
    [V(P(D.slap, s)) for s in (1, 2, 3)], vol=0.75, pitchVar=0.07)
add("high_five", PL, "sfx", "High five clap.",
    [V(P(D.high_five, 1)), V(P(D.high_five, 2))], vol=0.65, pitchVar=0.06)
add("whoosh_swing", PL, "sfx", "Arm swing / throw whoosh.",
    [V(mk(1462)), V(mk(2605)), V(mk(2607))], vol=0.5, pitchVar=0.1)
add("tug_strain", PL, "sfx", "Straining voice during the snatch tug-of-war.",
    [V(P(D.tug_strain, 1)), V(P(D.tug_strain, 2))], vol=0.6, pitchVar=0.06)
add("body_thud", PL, "sfx", "Body falls / bumps into something (slapstick).",
    [V(mk(2498), maxlen=0.7, fout=0.15)], vol=0.65, pitchVar=0.06)
add("snore_loop", PL, "sfx", "Snoring while sleeping on cardboard at midnight.",
    [V(D.snore_loop, xfade=0.8, loop_len=8.8)], vol=0.5, loop=True, pitchVar=0.0, lufs=-20)
add("yawn", PL, "sfx", "Big tired yawn (late night, waking up).",
    [V(mk(2270))], vol=0.6, pitchVar=0.05)
add("burp", PL, "sfx", "Burp after eating / drinking soda.",
    [V(og("burps", "burp_02.ogg")), V(og("burps", "burp_03.ogg"))], vol=0.6, pitchVar=0.08)
add("hiccup", PL, "sfx", "Hiccup (drunk in the intro / ate too fast).",
    [V(P(D.hiccup, 1)), V(P(D.hiccup, 2))], vol=0.55, pitchVar=0.06)
add("cough", PL, "sfx", "Cough (smoke from the wok, chili fumes).",
    [V(mk(2224)), V(mk(2222))], vol=0.6, pitchVar=0.05)
add("sneeze", PL, "sfx", "Sneeze (chili fumes in the wok!).",
    [V(mk(2212))], vol=0.65, pitchVar=0.05)
add("eat_chomp", PL, "sfx", "Eating / chomping food.",
    [V(mk(2252)), V(mk(117))], vol=0.55, pitchVar=0.07)
add("drink_gulp", PL, "sfx", "Gulp of a drink.",
    [V(mk(155))], vol=0.55, pitchVar=0.05)
