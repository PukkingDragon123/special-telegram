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

import designs_world as W
WO = "sfx/world"
AM = "amb"
# ----------------------------------------------------------------------------------------------- WORLD
add("traffic_bangkok_loop", AM, "amb", "Busy Bangkok road: traffic bed, swarms of scooters, tuk-tuk, horns. Main road areas.",
    [V(W.traffic_bangkok, xfade=2.0)], vol=0.7, loop=True, pitchVar=0.0)
add("motorbike_pass", WO, "sfx", "Motorbike / scooter passing by (approach-pass-recede). Use for ambient passes.",
    [V(P(W.motorbike_pass_rec, 1), fout=0.3), V(P(W.motorbike_pass_rec, 2), fout=0.2),
     V(P(W.motorbike_pass_syn, 3), fout=0.3), V(P(W.motorbike_pass_syn, 8), fout=0.3)], vol=0.6, pitchVar=0.08)
add("scooter_idle_loop", WO, "sfx", "Small scooter idling (motorbike-taxi stand, parked delivery rider).",
    [V(W.scooter_idle, xfade=0.3)], vol=0.5, loop=True, pitchVar=0.05, lufs=-19)
add("tuktuk_engine_loop", WO, "sfx", "Tuk-tuk two-stroke putt-putt idle/putter with rattling body (loop; pitch up with speed).",
    [V(W.tuktuk_loop, xfade=0.5)], vol=0.55, loop=True, pitchVar=0.0, lufs=-19)
add("car_horn_short", WO, "sfx", "Short car horn honk (everyone honks).",
    [V(mk(717)), V(mk(718)), V(mk(719)), V(mk(1565))], vol=0.55, pitchVar=0.05)
add("truck_horn", WO, "sfx", "Truck / pickup air horn blast.",
    [V(mk(720))], vol=0.6, pitchVar=0.03)
add("bus_airbrake", WO, "sfx", "Bus / truck air-brake release 'PSSSHH'.",
    [V(W.bus_airbrake)], vol=0.55, pitchVar=0.05)
add("siren_distant", WO, "sfx", "Distant ambulance siren drifting across the city.",
    [V(W.siren_distant, fout=1.0)], vol=0.4, pitchVar=0.0, lufs=-20)
add("songthaew_engine_loop", WO, "sfx", "Songthaew / pickup diesel engine running (loop).",
    [V(W.songthaew, xfade=0.8)], vol=0.5, loop=True, pitchVar=0.03, lufs=-19)
add("market_crowd_loop", AM, "amb", "Fresh market (ตลาดสด) bed: crowd chatter, plastic bags, cleaver chops, Thai voices.",
    [V(P(W.market_crowd, 40.0, 21), xfade=2.0)], vol=0.75, loop=True, pitchVar=0.0)
add("street_ambience_day_loop", AM, "amb", "Daytime neighbourhood street: distant traffic, scooters, birds, people, occasional horn.",
    [V(W.street_day, xfade=2.0)], vol=0.75, loop=True, pitchVar=0.0)
add("street_ambience_night_loop", AM, "amb", "Night street: crickets/insects, faint distant traffic, far-off dogs and scooters.",
    [V(W.street_night, xfade=2.0)], vol=0.75, loop=True, pitchVar=0.0)
add("dog_bark", WO, "sfx", "Stray dog (หมาจร) bark.",
    [V(mk(1), ss=0.0, t=0.45), V(mk(54), ss=0.55, t=0.4), V(mk(51), ss=0.0, t=0.62), V(mk(1), ss=0.8, t=0.45, rate=1.06)],
    vol=0.65, pitchVar=0.08)
add("dog_whine", WO, "sfx", "Dog whimper / whine (begging for food, sad).",
    [V(mk(466), ss=0.6, t=1.0), V(mk(467), ss=1.7, t=1.4, fout=0.25)], vol=0.55, pitchVar=0.06)
add("dog_eat", WO, "sfx", "Dog wolfing down food (the dog that eats your rice and pork).",
    [V(mk(2246), ss=0.0, t=2.8, fout=0.3)], vol=0.6, pitchVar=0.05)
add("dog_happy_pant", WO, "sfx", "Happy dog panting (following you around).",
    [V(mk(52), ss=0.1, t=3.3, fout=0.2)], vol=0.5, pitchVar=0.05)
add("cat_meow", WO, "sfx", "Street cat meow.",
    [V(mk(45)), V(mk(93)), V(og("cat", "cat_mewfood.wav"), ss=0.5, t=0.6), V(mk(87), rate=1.04)], vol=0.55, pitchVar=0.07)
add("cat_purr_loop", WO, "sfx", "Cat purring (adopted cat sitting with you).",
    [V(og("cat", "cat_purractive_loop.wav"), xfade=0.5)], vol=0.5, loop=True, pitchVar=0.0, lufs=-20)
add("birds_loop", AM, "amb", "Tropical city birds (morning/day) - myna/bulbul-like chatter layer.",
    [V(W.birds_city, xfade=2.0)], vol=0.6, loop=True, pitchVar=0.0)
add("pigeons", WO, "sfx", "Pigeons cooing / fluttering (temple courtyard, wires).",
    [V(mk(74), fout=0.4)], vol=0.5, pitchVar=0.05)
add("crow", WO, "sfx", "House crow caw.",
    [V(mk(316))], vol=0.55, pitchVar=0.06)
add("rooster", WO, "sfx", "Rooster crowing (rural edge, dawn).",
    [V(mk(2462)), V(mk(2470))], vol=0.6, pitchVar=0.04)
add("cicadas_loop", AM, "amb", "Hot-afternoon cicada chorus (trees, empty lot, temple). Play 12:00-16:00.",
    [V(W.cicada_chorus, xfade=2.0)], vol=0.45, loop=True, pitchVar=0.0)
add("crickets_frogs_night_loop", AM, "amb", "Night insects + frogs near the canal / rice-field edge.",
    [V(W.crickets_frogs, xfade=2.0)], vol=0.6, loop=True, pitchVar=0.0)
add("tokay_gecko", WO, "sfx", "Tokay gecko 'TOK-KAE, TOK-KAE' call (ตุ๊กแก) - iconic Thai night sound.",
    [V(W.tokay_call, fout=0.3), V(W.cm("commons_tokay", "Gekko_gecko.wav"), ss=2.4, t=9.6, fout=0.4)],
    vol=0.6, pitchVar=0.03)
add("temple_bell", WO, "sfx", "Temple bells: (1) big bronze bell struck, (2) small eave wind-bells tinkling.",
    [V(P(W.thai_temple_bell, 1, 6.0), fout=0.6), V(P(W.wind_bells, 2, 6.0, False), fout=0.6)], vol=0.55, pitchVar=0.02)
add("gong", WO, "sfx", "Thai bossed gong (ฆ้อง) strike.",
    [V(P(W.gong, 1, 5.0), fout=0.5)], vol=0.55, pitchVar=0.02)
add("wind_loop", AM, "amb", "Soft wind / breeze bed (open lot, rooftop, evening).",
    [V(mk(1173), ss=2.0, t=30.0, xfade=2.0)], vol=0.5, loop=True, pitchVar=0.0)
add("rain_loop", AM, "amb", "Heavy tropical rain (monsoon downpour).",
    [V(mk(1255), ss=1.0, t=29.0, xfade=2.0)], vol=0.7, loop=True, pitchVar=0.0)
add("thunder", WO, "sfx", "Thunder: (1) close crack + rumble, (2) long distant rumble.",
    [V(mk(1298), fout=1.0), V(mk(1301), ss=0.0, t=12.5, fout=1.5)], vol=0.7, pitchVar=0.03, stereo=False)
add("ac_hum_loop", WO, "sfx", "Air-conditioner unit hum (shophouse wall AC, convenience store).",
    [V(W.ac_hum, rate=0.85, xfade=1.0)], vol=0.4, loop=True, pitchVar=0.0, lufs=-21)
add("fluorescent_buzz_loop", WO, "sfx", "Fluorescent tube buzz (100 Hz) - night stalls, convenience store, shop interiors.",
    [V(W.fluorescent_buzz, xfade=0.5)], vol=0.3, loop=True, pitchVar=0.0, lufs=-24)
add("convenience_door_chime", WO, "sfx", "Original 'ding-dong' entry chime for the 8-Twelve parody store.",
    [V(W.door_chime, fout=0.4)], vol=0.55, pitchVar=0.0)
add("fan_loop", WO, "sfx", "Standing electric fan whirring and slowly oscillating (restaurant, home).",
    [V(W.fan_loop, xfade=1.0)], vol=0.4, loop=True, pitchVar=0.0, lufs=-21)
add("icecream_cart_bell", WO, "sfx", "Ice-cream cart hand-bell rung in bursts (ไอติมกะทิ seller passing by).",
    [V(W.icecream_bell, fout=0.3)], vol=0.5, pitchVar=0.02)

import designs_people as DP
import designs_world as W2
import music as MU

# remaining WORLD keys that need Thai voices / music
add("tv_muffled_loop", WO, "sfx", "TV playing inside a shophouse, muffled through the wall (Thai voices, music, canned laughs).",
    [V(P(DP.tv_muffled, 30.0, 51, MU.path("main_menu")), xfade=1.5)], vol=0.4, loop=True, pitchVar=0.0, lufs=-22)
add("radio_distant_loop", WO, "sfx", "A neighbour's radio down the soi playing a Thai-flavoured song + DJ chatter (far away).",
    [V(P(DP.radio_distant, 30.0, 53, MU.path("day_gameplay")), xfade=1.5)], vol=0.4, loop=True, pitchVar=0.0,
    lufs=-22)
add("junk_buyer_loudspeaker", WO, "sfx", "Parody of the roving junk-buyer pickup loudspeaker chant (synthesized Thai voice, megaphone, echo).",
    [V(P(DP.junk_buyer, 22.0), xfade=1.0)], vol=0.5, loop=True, pitchVar=0.0, lufs=-19)

PE = "sfx/people"
# ----------------------------------------------------------------------------------------------- PEOPLE
add("crowd_chatter_loop", AM, "amb", "Restaurant / street-food crowd chatter with Thai voices (busy shop, market tables).",
    [V(P(DP.crowd_chatter, 32.0, 31), xfade=2.0)], vol=0.6, loop=True, pitchVar=0.0)
add("female_scream_comedic", PE, "sfx", "Girl screams (customization gag: she sees you T-posing in shorts and runs).",
    [V(og("female_screams", "x/1.ogg")), V(og("girly_scream", "wscream_2_0.wav"))], vol=0.7, pitchVar=0.05)
add("gasp", PE, "sfx", "Shocked gasp (female / male).",
    [V(mk(964)), V(mk(966))], vol=0.6, pitchVar=0.05)
add("crowd_laugh", PE, "sfx", "Crowd bursts out laughing.",
    [V(mk(460), ss=0.3, t=6.3, fout=1.0)], vol=0.6, pitchVar=0.0)
add("crowd_cheer", PE, "sfx", "Happy crowd cheer.",
    [V(mk(975), fout=0.5)], vol=0.6, pitchVar=0.0)
add("crowd_aww", PE, "sfx", "Sympathetic crowd 'awww' (sad moment, burnt dish).",
    [V(P(D.crowd_vowel, "aww", 26, 3), fout=0.5)], vol=0.55, pitchVar=0.03)
add("applause", PE, "sfx", "Applause (shop upgrade, perfect dish).",
    [V(mk(485), ss=0.2, t=7.5, fout=1.5)], vol=0.6, pitchVar=0.0)
add("angry_grumble", PE, "sfx", "Angry muttering (mad shopkeeper / customer) - gibberish from reversed Thai speech.",
    [V(P(DP.angry_grumble, 0)), V(P(DP.angry_grumble, 1))], vol=0.6, pitchVar=0.06)
add("babble", "voice/babble", "voice",
    "Speech-bubble blips: 12 sped-up real Thai syllables (Animal-Crossing style). Play a random one per character with pitchVar.",
    [V(P(DP.babble, i), trim=False) for i in range(12)], vol=0.45, pitchVar=0.15)

CA = "sfx/casino"
# ----------------------------------------------------------------------------------------------- CASINO
add("casino_ambience_loop", AM, "amb", "Casino floor: crowd, slot machine jingles, chips (intro cutscene).",
    [V(DP.casino_amb, xfade=2.0)], vol=0.6, loop=True, pitchVar=0.0)
add("slot_machine_spin", CA, "sfx", "Slot machine reels spinning.", [V(mk(1932), maxlen=4.4, fout=0.3)], vol=0.55)
add("slot_win", CA, "sfx", "Slot machine win jingle/bells.", [V(mk(1928), fout=0.4)], vol=0.55)
add("roulette_spin", CA, "sfx", "Roulette ball spinning, bouncing and settling.",
    [V(mk(1985), ss=4.5, t=9.4, fout=0.4)], vol=0.55)
add("chips_clatter", CA, "sfx", "Casino chips clattering / stacking.",
    [V(kn("casino-audio", "chips-collide-2.ogg")), V(kn("casino-audio", "chips-stack-3.ogg"))], vol=0.55, pitchVar=0.06)
add("card_shuffle", CA, "sfx", "Deck of cards shuffled.", [V(kn("casino-audio", "card-shuffle.ogg"))], vol=0.55)
add("cheers_glass_clink", CA, "sfx", "Cheers! glasses clinking.", [V(mk(154)), V(mk(2936))], vol=0.6, pitchVar=0.05)
add("champagne_pop", CA, "sfx", "Champagne cork pop + fizz + foam.", [V(D.champagne_pop)], vol=0.65, pitchVar=0.04)
add("beer_can_open", CA, "sfx", "Beer can cracked open.", [V(P(D.can_open, 11))], vol=0.6, pitchVar=0.05)
add("pour_beer", CA, "sfx", "Pouring foamy beer into a glass.", [V(mk(3181), ss=0.3, t=5.0, fout=0.5)], vol=0.55)
add("pour_wine", CA, "sfx", "Pouring wine into a glass.", [V(mk(2826), ss=0.3, t=3.5, rate=0.92, fout=0.5)], vol=0.55)
add("slowmo_whoosh", CA, "sfx", "Deep pitched-down slow-motion whoosh (slow-mo celebration).", [V(DP.slowmo_whoosh, maxlen=4.5, fout=1.2)], vol=0.7)
add("heartbeat_slow", CA, "sfx", "Slow heartbeat (all-in bet, tension). Loopable-ish one-shot of ~9 s.",
    [V(D.heartbeat_slow, fout=0.3)], vol=0.6)
add("lose_sting", CA, "sfx", "Losing sting (lost everything at the casino).", [V(mk(2032), fout=0.5)], vol=0.6)

GH = "sfx/ghost"
# ----------------------------------------------------------------------------------------------- GHOST / NIGHT
add("eerie_drone_loop", AM, "amb", "Eerie night drone for ghost encounters (low drone, ghostly air, far bells).",
    [V(DP.eerie_drone, xfade=2.5)], vol=0.55, loop=True, pitchVar=0.0)
add("whisper", GH, "sfx", "Ghostly whispers: (1) a woman whispering 'ช่วยด้วย' (help me) in reverb, (2) male whispering voices.",
    [V(P(DP.ghost_whisper, 0), fout=0.6), V(P(DP.ghost_whisper, 1), fout=0.6)], vol=0.55, pitchVar=0.03)
add("ghost_laugh_female", GH, "sfx", "Female ghost laugh 'hihihi' with reverse-reverb swell (กระสือ / นางตานี).",
    [V(P(DP.ghost_laugh, 0), fout=0.8), V(P(DP.ghost_laugh, 1), fout=0.8)], vol=0.6, pitchVar=0.04)
add("wind_howl", GH, "sfx", "Howling wind gust.", [V(mk(1266), ss=4.0, t=8.0, fin=0.6, fout=1.5)], vol=0.55)
add("motorcycle_ghost_engine_loop", GH, "sfx", "Headless motorcycle ghost: slowed, distorted, reverb-drowned engine (loop).",
    [V(DP.ghost_engine, xfade=1.5)], vol=0.55, loop=True, pitchVar=0.0, lufs=-19)
add("ghost_scare_sting", GH, "sfx", "Jump-scare sting (kept below ear-splitting level).",
    [V(P(DP.scare_sting, 0), fout=0.6, lufs=-18), V(mk(3130), maxlen=3.0, fout=0.8, lufs=-18)], vol=0.6)
add("dog_howl_night", GH, "sfx", "Dog howling far away at night.", [V(DP.dog_howl, fout=1.0)], vol=0.5)
add("chain_rattle", GH, "sfx", "Chains rattling in the dark.", [V(P(DP.chain_rattle, 4, 1.6), fout=0.4)], vol=0.5)
add("bells_eerie", GH, "sfx", "Eerie slowed temple wind-bells in a big reverb.",
    [V(P(W2.wind_bells, 7, 6.0, True), fout=0.8)], vol=0.5)

ME = "meme"
# ----------------------------------------------------------------------------------------------- MEME
add("sad_trombone", ME, "meme", "Wah-wah-wah-waaah sad trombone.", [V(mk(471), fout=0.5)], vol=0.65)
add("airhorn", ME, "meme", "Air horn: (1) one long blast, (2) bwa-bwa-BWAAA.",
    [V(P(D.airhorn, ((0.0, 1.15),), 1)), V(P(D.airhorn, ((0.0, 0.16), (0.24, 0.16), (0.48, 0.95)), 2))],
    vol=0.55, pitchVar=0.03)
add("boing", ME, "meme", "Cartoon spring boing.", [V(mk(2894)), V(mk(2895))], vol=0.6, pitchVar=0.08)
add("bass_boom", ME, "meme", "Deep 'vine boom' style bass impact (original synthesis).", [V(D.bass_boom, fout=0.6)], vol=0.7)
add("bonk", ME, "meme", "Cartoon bonk on the head.", [V(D.bonk)], vol=0.65, pitchVar=0.06)
add("slide_whistle_up", ME, "meme", "Slide whistle rising.", [V(P(D.slide_whistle, True))], vol=0.55)
add("slide_whistle_down", ME, "meme", "Slide whistle falling.", [V(P(D.slide_whistle, False))], vol=0.55)
add("crickets_awkward", ME, "meme", "Awkward silence... crickets.", [V(D.crickets_awkward, trim=False, fout=0.3)], vol=0.55)
add("dun_dun_dunn", ME, "meme", "Dramatic 'dun dun DUNNN' orchestral stabs (original).", [V(D.dun_dun_dunn, fout=0.8)], vol=0.65)
add("laugh_track", ME, "meme", "Sitcom laugh track with a bit of applause.", [V(mk(422), fout=0.8)], vol=0.6)
add("ka_ching", ME, "meme", "Ka-ching! cash register (profit!).", [V(D.ka_ching, fout=0.3)], vol=0.65)
add("fail_buzzer", ME, "meme", "Long fail buzzer.", [V(mk(954), fout=0.2)], vol=0.55)
add("quack", ME, "meme", "Duck quack (synthesized).", [V(P(D.quack, 1))], vol=0.6, pitchVar=0.08)
add("squeaky_toy", ME, "meme", "Squeaky toy squeaks.", [V(mk(2814), ss=0.0, t=0.47, fout=0.05)], vol=0.55, pitchVar=0.08)
add("record_scratch", ME, "meme", "Record scratch (everything stops).", [V(mk(703), fout=0.05)], vol=0.6)
add("wow_crowd", ME, "meme", "Crowd 'wooOOOoo!' impressed reaction (synthesized crowd).",
    [V(P(D.crowd_vowel, "wow", 26, 5), fout=0.5)], vol=0.55)
add("tada", ME, "meme", "Ta-da! fanfare.", [V(mk(2992), fout=0.4)], vol=0.6)
add("ding_correct", ME, "meme", "Correct-answer ding (right words in the bargaining minigame).", [V(mk(947), fout=0.3)], vol=0.6)
add("wrong_buzz", ME, "meme", "Short wrong-answer buzz.", [V(mk(950))], vol=0.55)
add("sparkle_chime", ME, "meme", "Sparkle chime (item upgraded / shiny).", [V(mk(3062), fout=0.5)], vol=0.55)
add("level_up_fanfare", ME, "meme", "Short funny level-up / skill unlocked fanfare.", [V(mk(2984), fout=0.8)], vol=0.6)
add("cloud_poof", ME, "meme", "Poof! (thought cloud appears / disappears).", [V(P(D.cloud_poof, 1))], vol=0.55, pitchVar=0.06)
add("bubble_pop", ME, "meme", "Bubble pop (speech bubbles appearing, UI blips).",
    [V(mk(731), ss=0.0, t=0.12), V(mk(2925), ss=0.02, t=0.14), V(mk(3192), ss=0.05, t=0.16)], vol=0.5, pitchVar=0.12)
add("whoosh_text", ME, "meme", "Quick whoosh for flying 3D text / transitions.", [V(mk(1464)), V(mk(3115))], vol=0.5, pitchVar=0.08)
add("tick_tock_loop", ME, "meme", "3-second bargaining timer tick-tock (6 ticks, loops seamlessly).",
    [V(P(D.tick_tock, 6, 0.5), trim=False, xfade=0.02, loop_len=3.0)], vol=0.55, loop=True, pitchVar=0.0)
add("camera_shutter", ME, "meme", "Camera shutter (newspaper photo, selfie).", [V(mk(1133))], vol=0.55)

import pc_extract as PX
MUS = "music"
# ----------------------------------------------------------------------------------------------- MUSIC
add("main_menu", MUS, "music", "Main menu theme: warm, slightly lo-fi 2000s Thai-indie (clean guitar, EP, brushed kit). Original.",
    [V(MU.path("main_menu"), trim=False, preloop=True)], vol=0.55, loop=True, pitchVar=0.0)
add("day_gameplay_loop", MUS, "music", "Daytime gameplay: light Thai-flavoured loop (ranat ek, khim, khaen drone, ching & thon). Original.",
    [V(MU.path("day_gameplay"), trim=False, preloop=True)], vol=0.4, loop=True, pitchVar=0.0)
add("night_loop", MUS, "music", "Night loop: eerie drone, sparse detuned ranat notes, ghostly bells. Original.",
    [V(MU.path("night"), trim=False, preloop=True)], vol=0.45, loop=True, pitchVar=0.0)
add("casino_lounge", MUS, "music", "Casino lounge (intro): 'Local Forecast - Elevator' by Kevin MacLeod (CC BY 4.0) - credit required.",
    [V(f"{DL_}/incompetech/Local_Forecast_-_Elevator.mp3" if (DL_ := "/home/user/special-telegram/scripts/_cache/audio_dl") else "",
       ss=25.0, t=95.66, xfade=2.0, trim=False)], vol=0.5, loop=True, pitchVar=0.0)
add("slowmo_dramatic", MUS, "music", "Over-dramatic slow-motion choir/strings/timpani (comedic intro celebration). Original.",
    [V(MU.path("slowmo"), trim=False, preloop=True)], vol=0.55, loop=True, pitchVar=0.0)
add("skill_tree_dreamy", MUS, "music", "Skill-tree thought cloud: dreamy harp arpeggios, celesta, warm pads. Original.",
    [V(MU.path("skill_tree"), trim=False, preloop=True)], vol=0.5, loop=True, pitchVar=0.0)
add("bargaining_tension_loop", MUS, "music", "Bargaining / mad-system tension loop (128 bpm pizzicato ostinato). Original.",
    [V(MU.path("bargaining"), trim=False, preloop=True)], vol=0.5, loop=True, pitchVar=0.0)
add("sleep_lullaby", MUS, "music", "Midnight sleep on cardboard: slow khim lullaby over a soft pad. Original.",
    [V(MU.path("lullaby"), trim=False, preloop=True)], vol=0.45, loop=True, pitchVar=0.0)
add("shop_upgrade_jingle", MUS, "music", "Shop/restaurant upgrade jingle (ranat run + chord + ching). Original.",
    [V(MU.path("shop_jingle"), maxlen=3.2, fout=0.8)], vol=0.6, pitchVar=0.0)
add("day_end_jingle", MUS, "music", "End-of-day jingle (khaen chord, ranat cadence). Original.",
    [V(MU.path("day_end_jingle"), maxlen=6.5, fout=1.2)], vol=0.6, pitchVar=0.0)


# ----------------------------------------------------------------------------------------------- VOICE (Thai)
def _u(n, pat, occ=0, island=None, **kw):
    def f():
        s, e = PX.find(n, pat, occ)
        y = PX.refine(PX.lesson_audio(n), s, e, island=island, **kw)
        return A_.fade(A_.hp(y, 80, 2), 0.01, 0.05), [PX.lesson_path(n)]
    return f


def _w(n, s, e, island=None):
    def f():
        y = PX.refine(PX.lesson_audio(n), s, e, island=island)
        return A_.fade(A_.hp(y, 80, 2), 0.01, 0.05), [PX.lesson_path(n)]
    return f


import audiolib as A_
VO = "voice"
VD = "Native Thai speaker (U.S. Peace Corps Thai course, public domain)."
add("sawasdee", VO, "voice", "สวัสดีค่ะ / สวัสดีครับ - hello (female, male). " + VD,
    [V(_u(4, "สวัสดีค่ะ")), V(_u(4, "สวัสดีครับ"))], vol=0.85, pitchVar=0.04)
add("khob_khun", VO, "voice", "ขอบคุณค่ะ / ขอบคุณครับ - thank you (female, male). " + VD,
    [V(_u(13, "ขอบคุณค่ะ")), V(_u(13, "ขอบคุณครับ"))], vol=0.85, pitchVar=0.04)
add("aroi", VO, "voice", "อร่อย! / อร่อยมากครับ - delicious! / very delicious! " + VD,
    [V(_u(10, "อร่อย", 0)), V(_u(10, "อร่อยมากครับ"))], vol=0.85, pitchVar=0.04)
add("phet", VO, "voice", "เผ็ด - spicy! " + VD, [V(_u(10, "เผ็ด", 0))], vol=0.85, pitchVar=0.04)
add("mai", VO, "voice", "ไม่ - no / not. " + VD, [V(_w(10, 91.04, 92.12))], vol=0.85, pitchVar=0.04)
add("dai", VO, "voice", "ได้ - can / OK (ได้!). " + VD, [V(_w(10, 85.0, 85.7))], vol=0.85, pitchVar=0.04)
add("im_laew", VO, "voice", "อิ่มแล้วค่ะ / ผมอิ่มแล้วครับ - I'm full. " + VD,
    [V(_u(10, "อิ่มแล้วค่ะ")), V(_u(13, "ผมอิ่มแล้วครับ"))], vol=0.85, pitchVar=0.04)
add("por_laew", VO, "voice", "พอแล้วค่ะ / พอแล้วครับ - that's enough! (seasoning, haggling). " + VD,
    [V(_u(10, "พอแล้วค่ะ")), V(_u(10, "พอแล้วครับ"), maxlen=1.25, fout=0.15)], vol=0.85, pitchVar=0.04)
add("mai_pen_rai", VO, "voice", "ไม่เป็นไร - never mind / no problem. " + VD,
    [V(_u(13, "ไม่เป็นไรครับ", island=0))], vol=0.85, pitchVar=0.04)
add("kho_thot", VO, "voice", "ขอโทษค่ะ / ขอโทษครับ - sorry / excuse me. " + VD,
    [V(_u(13, "ขอโทษค่ะ")), V(_u(13, "ขอโทษครับ"))], vol=0.85, pitchVar=0.04)
add("chuay_duay", VO, "voice", "ช่วยด้วย! - help! " + VD,
    [V(_u(13, "ช่วยด้วย", 0)), V(_u(13, "ช่วยด้วย", 1))], vol=0.85, pitchVar=0.03)
add("fai_mai", VO, "voice", "ไฟไหม้! - fire! (wok flame-up / burnt food). " + VD,
    [V(_u(13, "ไฟไหม้", island=0))], vol=0.85, pitchVar=0.03)
add("tamruat", VO, "voice", "ตำรวจ! - police! " + VD,
    [V(_u(13, "ตำรวจ", island=0)), V(_u(13, "ตำรวจ", island=1))], vol=0.85, pitchVar=0.03)
add("nii_arai", VO, "voice", "นี่อะไรครับ - what is this? (customer looking at the menu). " + VD,
    [V(_u(10, "นี่อะไรครับ", 0))], vol=0.85, pitchVar=0.04)
add("sabai_dee_mai", VO, "voice", "สบายดีไหม - how are you? " + VD, [V(_u(3, "สบายดีไหม"))], vol=0.85, pitchVar=0.04)

# Lesson 9 lines (only when its transcript exists): vendor 'what would you like?' + customer 'how much in total?'
if "TH_Thai_Lesson_9.mp3" in PX.transcripts():
    def _try(n, pat, occ=0, **kw):
        try:
            PX.find(n, pat, occ)
            return V(_u(n, pat, occ, **kw))
        except Exception:
            return None
    _ao = [v for v in (_try(9, "เอาอะไรคะ", 0), _try(9, "อะไรคะ", 0)) if v][:1]
    _tr = [v for v in (_try(9, "เท่าไรคะ", 0), _try(9, "เท่าไรครับ", 0), _try(9, "เท่าไหร่คะ", 0),
                       _try(9, "เท่าไหร่ครับ", 0)) if v][:2]
    if _ao:
        add("ao_arai", VO, "voice", "เอาอะไรคะ - what would you like? (vendor/auntie). " + VD, _ao, vol=0.85, pitchVar=0.04)
    if _tr:
        add("thao_rai", VO, "voice", "(ทั้งหมด)เท่าไรคะ/ครับ - how much (in total)? (customer). " + VD, _tr,
            vol=0.85, pitchVar=0.04)
