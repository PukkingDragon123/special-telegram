# R5-audio — notes for เฮียผัด! audio

Everything the game plays lives in `public/assets/audio/` and is described by
`public/assets/audio/manifest.json`. Credits (one line per shipped file and source) are in
`references/credits/R5-audio.md`. The whole set is reproducible from `scripts/research/R5/`
(see "Rebuilding" at the end).

## 1. What ships

| folder | contents |
|---|---|
| `sfx/cooking` | wok sizzle / bursts, spatula scrapes, toss, egg, gas ignite, burner roar, knife, mortar, rice, plates, cutlery, washing-up, boil, steam, burnt hiss, flame-up, rice cooker, timer |
| `sfx/items` | pickup, drops (plastic/metal/wood/glass/soft), glass break, plastic chair & table drags, cardboard, paper, recipe book, plastic bag, coins, banknotes, cash drawer, bottle/can opening, ice, cup fill |
| `sfx/player` | footsteps (concrete, rubber flip-flops, wet), overloaded panting, grunts, slap, high five, swings, tug-of-war strain, thud, snore, yawn, burp, hiccup, cough, sneeze, eating, gulp |
| `sfx/world` | scooter passes / idle, tuk-tuk, horns, bus air brake, siren, songthaew diesel, dogs, cats, pigeons, crow, rooster, tokay gecko, temple bells, gong, thunder, AC, fluorescent tube, 8-Twelve door chime, fan, muffled TV, distant radio, ice-cream bell, junk-buyer loudspeaker parody |
| `sfx/people` | girl scream (customization gag), gasps, crowd laugh/cheer/aww, applause, angry grumbles |
| `sfx/casino` | slots, roulette, chips, cards, glass clinks, champagne, beer, pours, slow-mo whoosh, heartbeat, lose sting |
| `sfx/ghost` | whispers, female ghost laughs, wind howl, headless-motorcycle engine loop, scare stings, dog howl, chains, eerie bells |
| `amb` | stereo ambience beds: Bangkok traffic, market, day/night street, birds, cicadas, crickets+frogs, wind, rain, crowd chatter, casino floor, eerie drone |
| `meme` | sad trombone, airhorn, boing, bass boom, bonk, slide whistles, crickets, dun-dun-dunn, laugh track, ka-ching, buzzers, quack, squeaky toy, record scratch, crowd wow, tada, ding, sparkle, level-up, poof, bubble pops, text whooshes, 3-s tick-tock, camera |
| `voice` | short Thai barks by native speakers (see §4) |
| `voice/babble` | 12 speech-bubble blips (real Thai syllables, sped up) — manifest key `babble` |
| `music` | menu theme, day/night loops, casino lounge, slow-mo, skill tree, bargaining, lullaby, 2 jingles |

Format: MP3 44.1 kHz with LAME/Xing gapless header. SFX/meme/voice mono 112 kbps, ambience/music
stereo 128 kbps. Every file is trimmed, faded, DC-filtered and loudness-normalised (EBU R128 via
pyloudnorm): SFX/meme/voice ≈ −16 LUFS, ambience ≈ −24 LUFS, music ≈ −20 LUFS, true peak ≤ −1 dBTP
(lookahead limiter + oversampled clip guard; a few very spiky sources land 1–4 dB under target rather
than being squashed). Loops (`*_loop`, all `amb/*`, most `music/*`) were made seamless: SFX/ambience
by an equal-power crossfade of the tail into the head, synthesized music by folding the reverb tail onto
the start. Every output was checked with loudness/peak stats and waveform + spectrogram contact sheets.

## 2. Manifest

```json
"wok_sizzle_loop": {"files": ["sfx/cooking/wok_sizzle_loop.mp3"], "vol": 0.55, "loop": true,
                    "cat": "sfx", "pitchVar": 0, "desc": "..."}
```
* `files`: 1–n variants — pick one at random (avoid repeating the last one).
* `vol`: suggested gain (0–1) on top of the normalisation so categories sit together; music is
  deliberately lower (0.4–0.55) so it never fights the sizzle and voices.
* `pitchVar`: suggested random detune range (e.g. 0.08 → playbackRate 0.92–1.08). Keep 0 on loops
  and music.
* `cat`: `sfx | amb | music | voice | meme` → map to mixer buses (suggest separate volume sliders for
  music / ambience / effects+meme / voices).
* Extra keys beyond the brief: Thai voice keys (§4) and `babble`, `bubble_pop` as requested.

Engine tips: decode loops with Web Audio (`AudioBufferSourceNode.loop = true`). Chrome and Firefox
honour the LAME gapless header; if a click is ever audible at a loop seam on some browser, start the
next instance 20–30 ms early with a short crossfade. Make world sounds positional (PannerNode,
`refDistance` 2–4 m) and keep `amb/*` non-positional beds crossfaded by area/time.

## 3. Where to use what

**Ambience per area / time (crossfade 3–5 s, layer 2–3 beds):**
* Main road / food-stall street, day: `traffic_bangkok_loop` + `street_ambience_day_loop` (+ `birds_loop`
  early morning, + `cicadas_loop` 12:00–16:00 near trees/empty lot/temple). Random one-shots every
  4–15 s: `motorbike_pass`, `car_horn_short`, `truck_horn`, `bus_airbrake`, `dog_bark`, `crow`,
  `pigeons`, occasional `siren_distant`, `icecream_cart_bell`, `junk_buyer_loudspeaker` (drive the
  pickup past slowly, 2–3 times per day).
* Fresh market: `market_crowd_loop` (+ `crowd_chatter_loop` near tables, + `plastic_bag_rustle`,
  `knife_chop_board`, `coin_clink` one-shots).
* Your shop when busy: `crowd_chatter_loop` at 0.3–0.7 scaled by customer count, `fan_loop` +
  `fluorescent_buzz_loop` near the stall at night, `tv_muffled_loop` / `radio_distant_loop` from
  neighbouring shophouses (positional).
* Convenience store (8-Twelve): `convenience_door_chime` on enter/exit, inside `ac_hum_loop` +
  `fluorescent_buzz_loop`.
* Rural edge / rice field / canal: `birds_loop` (day), `rooster` at dawn (05:00–07:00),
  `crickets_frogs_night_loop` at night, `wind_loop` on the open lot.
* Temple wall / spirit house: `temple_bell` (1 = big bell struck, 2 = wind bells) and `gong` sparingly,
  respectful, low volume.
* Night (after ~19:00): crossfade to `street_ambience_night_loop` + `crickets_frogs_night_loop`;
  `tokay_gecko` every 1–3 in-game hours from walls/trees; distant `dog_bark`.
* Ghost encounters: `eerie_drone_loop` bed + `music/night_loop`, one-shots `whisper`,
  `ghost_laugh_female`, `bells_eerie`, `chain_rattle`, `dog_howl_night`, `wind_howl`;
  `motorcycle_ghost_engine_loop` attached to the headless rider (positional, Doppler via
  playbackRate); `ghost_scare_sting` only for the actual reveal (it is already level-limited).
* Weather: `rain_loop` + `thunder` (play 1 then 2 seconds apart with a lightning flash); duck traffic
  −6 dB under heavy rain.
* Casino intro: `casino_ambience_loop` + `music/casino_lounge`, `slot_*`, `roulette_spin`,
  `chips_clatter`, `card_shuffle`, `cheers_glass_clink`, `champagne_pop`, `beer_can_open`,
  `pour_beer/pour_wine`; slow-mo celebration: `slowmo_whoosh` → `music/slowmo_dramatic`;
  losing everything: `heartbeat_slow` → `lose_sting` → fade out.

**Cooking loop logic:** `burner_roar_loop` volume/pitch follows the heat knob (0.9–1.15 rate);
`wok_sizzle_loop` volume follows (food mass × heat); on every ingredient drop play `sizzle_burst`
(scale by amount), `oil_pour`/`sauce_glug`/`sprinkle` while pouring/seasoning (`sauce_glug` per
"splash"), `spatula_scrape` on each stir stroke (alternate variants, pitchVar 0.08), `wok_toss` on
flip, `fire_whoosh` when flame-up triggers, `steam_hiss` when water/sauce hits a hot wok,
`burnt_smoke_hiss` + `cough`/`sneeze` + voice `fai_mai` when burnt. Egg: `egg_crack` →
`sizzle_burst` → `egg_fry_crackle_loop`. Prep: `knife_chop_board` per chop, `mortar_pound` per pound,
`rice_scoop`, `plate_down`, `spoon_clink`. Washing: `tap_water_loop` + `scrub_loop`,
`dishes_stack`, `dish_clatter`, `water_splash`. `rice_cooker_click` / `timer_ding` for ready states.

**Player/social:** footsteps every ~0.45 s walking (`footstep_flipflop` default — the players wear
slippers; `footstep_concrete` for NPCs with shoes; `footstep_wet` in market/puddles); overloaded:
`overloaded_breath_loop` + slower steps; slap: `slap_hard` (+ `bonk`/`boing` meme for crits),
`high_five`, snatch tug-of-war: `tug_strain` + `grunt` + `tick_tock_loop`; giving money: `banknote`
/ `coin_clink`; sleeping on cardboard at midnight: `cardboard` → `yawn` → `snore_loop` +
`music/sleep_lullaby`.

**Bargaining / mad system (3 s):** `music/bargaining_tension_loop` + `tick_tock_loop`; right words →
`ding_correct` + voice `por_laew`/`khob_khun`; wrong → `wrong_buzz`/`fail_buzzer` + `angry_grumble`.

**Meme stingers** (keep rare so they stay funny): `sad_trombone` on a failed dish, `ka_ching` on a
big sale, `bass_boom` / `dun_dun_dunn` for dramatic reveals, `record_scratch` + `crickets_awkward`
for awkward moments, `airhorn` for a perfect 5-star rating, `laugh_track`/`wow_crowd`/`crowd_aww`
reactions, `tada`/`sparkle_chime`/`level_up_fanfare` for unlocks, `cloud_poof` when the skill-tree
thought cloud opens/closes, `bubble_pop` + `babble` for every speech bubble, `whoosh_text` for 3D text
flying in, `camera_shutter` for the newspaper photo, `quack`/`squeaky_toy`/`slide_whistle_*` for
slapstick.

**Music map:** `main_menu` (album-cover menu), `day_gameplay_loop` (daytime, −3 dB when the shop is
full), `night_loop` (after dark / ghosts), `casino_lounge` (intro), `slowmo_dramatic` (slow-mo
cutscene), `skill_tree_dreamy` (thought-cloud skill tree), `bargaining_tension_loop`, `sleep_lullaby`
(midnight), `shop_upgrade_jingle` (purchase/upgrade), `day_end_jingle` (day summary / newspaper).
Duck music −6 dB under voice barks.

**Babble:** for each NPC speech bubble play one random `babble` file every ~70–90 ms of text with
playbackRate 0.85–1.2 per character (men lower, aunties higher) + a tiny random detune per blip.

## 4. Thai voice barks (native speakers, public domain)

From the U.S. Peace Corps Thai course audio (archive.org `peace-corps-thai`, PD — U.S. Government
work). Lesson audio was transcribed with Whisper (word timestamps), cut with energy-based speech-island
detection, then QA'd by re-transcribing the cut clips.

| key | Thai | meaning | variants |
|---|---|---|---|
| `sawasdee` | สวัสดีค่ะ / สวัสดีครับ | hello | female, male |
| `khob_khun` | ขอบคุณค่ะ / ขอบคุณครับ | thank you | female, male |
| `aroi` | อร่อย / อร่อยมากครับ | delicious / very delicious | 2 |
| `phet` | เผ็ด | spicy | 1 |
| `mai` | ไม่ | no / not | 1 |
| `dai` | ได้ | can / OK | 1 |
| `im_laew` | อิ่มแล้วค่ะ / ผมอิ่มแล้วครับ | I'm full | 2 |
| `por_laew` | พอแล้วค่ะ / พอแล้วครับ | that's enough | 2 |
| `mai_pen_rai` | ไม่เป็นไรครับ | never mind | 1 |
| `kho_thot` | ขอโทษค่ะ / ขอโทษครับ | sorry | 2 |
| `chuay_duay` | ช่วยด้วย | help! | 2 |
| `fai_mai` | ไฟไหม้ | fire! | 1 |
| `tamruat` | ตำรวจ | police! | 2 |
| `nii_arai` | นี่อะไรครับ | what is this? | 1 |
| `sabai_dee_mai` | สบายดีไหม | how are you? | 1 |
| `ao_arai` | เอาอะไรคะ | what would you like? (vendor) | 1 |
| `thao_rai` | (ทั้ง)หมดเท่าไรคะ / ครับ | how much (in total)? (customer) | 2 |

The speakers are teacher-style (clear, polite), so barks sound friendly rather than street-rough —
fine for customers/vendors. All clips were re-transcribed by Whisper as QA and matched the intended
words. **Not found licence-clean:** แพง (expensive), ใช่ (yes), เฮ้ย / โอ้ย exclamations.
Suggestion: record these with a Thai friend (2–3 voices, phone in a closet is fine) or commission a
voice actor; drop them into `voice/` with the same naming and add manifest keys.

## 5. Sources, what worked and what did not

* **Mixkit** (free SFX licence, no attribution needed but credited): crawled 149 category pages into
  a local catalogue (2,493 items) and pulled the WAV masters from `assets.mixkit.co`. Biggest share of
  real-world recordings (frying, water, dishes, animals, horns, casino, crowd reactions, meme stingers).
* **Kenney** (CC0): Impact Sounds (plates, glass, metal, wood, footsteps), RPG Audio (cloth, book,
  coins), Casino Audio (chips, cards).
* **OpenGameArt**: household foley pack (CC0, frying pan, sink, cutting board, AC), adding salt / boiling
  loops / stove switch (CC0, TinyWorlds), cat purr & meow (CC0), cicadas (CC0), female screams (CC0),
  burps (CC-BY-SA 4.0 — attribution + share-alike apply to those 2 files), punch/slap hits (CC-BY 3.0),
  ghostly cackle (CC0), eerie loops (CC0).
* **Wikimedia Commons**: Tokay gecko calls (public domain, Richard Ling; CC BY-SA 3.0, Israel Benjumeda),
  a real Chiang Mai night recording of frogs/insects/rain (CC BY-SA 3.0, Takeaway) inside
  `crickets_frogs_night_loop`, and "unidentified bird in Bangkok" (CC BY-SA 3.0, Amada44) inside
  `birds_loop`. The Commons API/upload server rate-limited (HTTP 429) the shared IP most of the session,
  so Lingua Libre / `Th-*.ogg` Thai word recordings were never fetched (not needed in the end).
  CC BY-SA files: keep the attribution lines; share-alike applies to those audio files only.
* **archive.org**: Peace Corps Thai lessons (public domain) → all Thai voices, crowd/TV/radio voices,
  babble syllables and the whispered ghost line.
* **incompetech** (Kevin MacLeod, CC BY 4.0): "Local Forecast - Elevator" for `casino_lounge` —
  attribution required: *"Local Forecast - Elevator" Kevin MacLeod (incompetech.com), Licensed under
  Creative Commons: By Attribution 4.0 License, http://creativecommons.org/licenses/by/4.0/*.
* **Original synthesis/design (numpy/scipy, CC0 project original)**: all other music (Thai-flavoured
  ranat ek / khim / khaen / ching / thon arrangements, menu theme, jingles), spatula scrapes, burner
  roar layer, plastic chair/table drags, plastic bag, cardboard, coin drop/spin, bottle/can/champagne,
  flip-flop steps, hiccups, airhorns, bass boom, bonk, slide whistles, dun-dun-dunn, quack, tick-tock,
  poof, crowd "aww"/"wow", temple bells, gong, door chime, ice-cream bell, fluorescent buzz, cicada
  chorus, tuk-tuk engine, synthetic scooter passes (Doppler), and all composite ambiences.
  The junk-buyer chant uses espeak-ng's Thai voice (generated audio, not covered by the program's GPL).
* **Not used:** Freesound (pages and CDN return 403 through the proxy); BigSoundBank (its robots.txt
  and ai.txt ask automated agents not to fetch `/UPLOAD/` audio — respected; a human can still pick
  CC0 files there manually); soundjay (licence not on the allowed list); no meme clips ripped from
  films/TV/music — all meme sounds are licensed SFX or original synthesis.

## 6. Known gaps / listening QA wanted

I cannot listen, so everything was verified by numbers + spectrograms. Please give these a real listen
first and swap if they feel off:
* Synthesized approximations: `tuktuk_engine_loop`, `motorbike_pass_3/4` (synthetic scooter),
  `spatula_scrape`, `plastic_chair_scrape`, `table_drag`, `quack`, `hiccup`, `airhorn`, `crowd_aww`,
  `wow_crowd`, `cicadas_loop` (synth chorus + quiet CC0 recording), `burner_roar_loop`.
* Music is original procedural synthesis (pleasant but not a band recording); `main_menu` could be
  replaced by a real 2000s Thai-indie style track if one with a clean licence is found.
* Voice: the missing barks listed in §4. Lessons 5/6/7 (numbers, บาท, food words) are already
  transcribed in `scripts/_cache/audio_work/asr/peacecorps_medium.json`; more barks (e.g. counting change
  "สิบบาท") can be added with the `_u()` helper in `recipes.py`.
* `birds_loop` is a tropical mix (not species-accurate myna/koel); Asian koel / common myna recordings
  from Commons would make it more Bangkok-specific.
* Mixkit's licence forbids redistributing the raw files standalone: keep them inside the game build
  (fine) and do not publish the audio folder as a separate "sound pack".

## 7. Rebuilding

```
cd scripts/research/R5
python3 -I mixkit_crawl.py <dl>/mixkit <categories...>   # catalogue (already cached)
python3 -I mixkit_get.py <ids...>                        # WAV masters into scripts/_cache/audio_dl/mixkit/wav
python3 -I transcribe.py medium <out.json> lessons...   # Whisper word timestamps for Peace Corps lessons
python3 -I music.py                                     # renders original music WAVs
python3 -I build.py [--only k1,k2] [--folder sfx/cooking]   # processes, writes MP3s, manifest, credits
python3 -I inspect_audio.py out.png files...             # waveform/spectrogram contact sheets
```
Downloads/caches live in `scripts/_cache/` (git-ignored). `recipes.py` lists every key, its sources
and processing; `designs*.py` hold the composites and synthesis.
