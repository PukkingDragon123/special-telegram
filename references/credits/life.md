# life module — credits (models, photos, sounds)

All files shipped under `public/assets/gen/life/`. Models come from Sketchfab via the Objaverse dataset (allenai/objaverse on Hugging Face); converted/decimated with headless Blender (`scripts/life/bl_creature.py`, `bl_prop.py`). Photos via Openverse (Flickr). Licences as stated by the authors.

## 3D models

| file | source | author | licence | use |
|---|---|---|---|---|
| models/dog.glb | [Animated Dog, Shiba Inu](https://sketchfab.com/3d-models/9abfce885a834399b2c3ccaed51cd474) | quander | by | stray dog (decimated 33k→10k tris, whiskers removed, toe weights merged, clips renamed) |
| models/cat.glb | [Cat [Murdered: Soul Suspect]](https://sketchfab.com/3d-models/836312def1b84e588866500a2bf79f0f) | mark2580 | by | stray cat — Objaverse GLB re-rooted without Blender (`scripts/life/glb_root_fix.py`: scale 0.0175, -90° Y, clip → idle; the Blender round-trip broke this FBX-derived rig); sitting rig stood up procedurally in creature.ts |
| models/ghost_scooter.glb | [Old Scooter](https://sketchfab.com/3d-models/5e9b5072b2224ba982366490ad5f31d9) | ribitis | by | headless ghost rider scooter + traffic scooters (base plane removed, rescaled) |
| models/ghost_white.glb | [Samara (The Ring)](https://sketchfab.com/3d-models/57ab1a21d63744dfab12c54c7d139ddb) | CoryRichards | by | long-haired woman in white / Nang Tani (decimated 40k→11k) |
| models/krasue_hair.glb | [Samara (The Ring)](https://sketchfab.com/3d-models/57ab1a21d63744dfab12c54c7d139ddb) | CoryRichards | by | krasue hair (hair mesh only) |
| models/krasue_head.glb | [Lisa - Woman Head with BlendShapes](https://sketchfab.com/3d-models/7670d1c2742b4188a989f1b3205a628b) | skullvez | by | krasue head (decimated) |
| models/moodeng_plush.glb | [Hippo](https://sketchfab.com/3d-models/5c83bf36bea04b82abd4396597c5c81e) | nasdull | by | Moo Deng plush base (decimated, retextured with Moo Deng photo) |
| models/gecko.glb | [Model 40A - Tokay Gecko "Big Mama"](https://sketchfab.com/3d-models/27231576e5d44349891dd5e7d43056a9) | DigitalLife3D | by | tokay gecko on walls at night |
| models/crow.glb | [Crow](https://sketchfab.com/3d-models/d5a9b0df4da3493688b63ce42c8a83e2) | alexanders823 | by | crows on the vacant lot |

## Photos (textures)

| file | source photo | author | licence | processing |
|---|---|---|---|---|
| tex/fur_dog.jpg, tex/fur_detail.jpg | [Tango texture I](https://www.flickr.com/photos/90863480@N00/2248134902) | theilr | CC BY-SA 2.0 | crop, snow-speck inpaint, low-freq flatten, seamless tile, high-pass detail |
| tex/fur_cat.jpg, tex/fur_detail_cat.jpg | [Coat color and heat](https://www.flickr.com/photos/77654185@N07/7606047918) | Kerri Lee Smith | CC BY-NC-SA 2.0 | crop, flatten, seamless tile, high-pass detail |
| tex/veh_taxi_pink.jpg, tex/veh_wheel.jpg | [Taxi](https://www.flickr.com/photos/8903846@N05/2504413107) | Garik Lawson Asplund | CC BY-NC 2.0 | perspective-rectified side, mirrored front/rear strips; wheel crop |
| tex/veh_taxi_gy.jpg | [Thai Taxi](https://www.flickr.com/photos/90208834@N00/9320607968) | Peter Zoon | CC BY 2.0 | perspective-rectified side |
| tex/veh_pickup.jpg, tex/veh_junk.jpg | [Isuzu D-Max tuning](https://www.flickr.com/photos/124790945@N06/47844318772) | Phuketian.S | CC BY 2.0 | perspective-rectified side |
| tex/veh_bus_red.jpg | [BMTA Hino AK Bus at Victory Monument](https://www.flickr.com/photos/18684820@N00/3123226100) | Ian Fuller | CC BY-NC 2.0 | rectified side + front |
| tex/veh_songthaew.jpg | [Songthaew](https://www.flickr.com/photos/34326110@N00/11530556294) | abdul / yunir | CC BY 2.0 | rectified side + front |
| tex/veh_tuktuk.png | [Bangkok tuk tuk](https://www.flickr.com/photos/77742560@N06/8347822087) | shankar s. | CC BY 2.0 | rectified side with open-cabin alpha |
| tex/moodeng_photo.jpg, tex/moodeng_skin.jpg | [Moo deng หมูเด้ง (2024-09-14) - img](https://commons.wikimedia.org/w/index.php?curid=152673257) | MGR ภาคกลาง ตะวันออก / MGR Online VDO | CC BY 3.0 | crop (watermark removed by crop) |
| tex/dogfood_bag.jpg | [Bags of Beneful and Pedigree dog food on shelves 2006](https://commons.wikimedia.org/w/index.php?curid=3983417) | Jason Meredith | CC BY 2.0 | crop of one bag |
| tex/lottery_board.jpg | [Lottery Tickets Joy](https://www.flickr.com/photos/53801255@N07/5383455458) | nist6dh | CC BY-SA 2.0 | crop |
| tex/amulet_table.jpg, tex/amulet_face.jpg | [amulet market](https://www.flickr.com/photos/54369147@N00/4140805879) | mimolag | CC BY 2.0 | crop |
| tex/rose_yellow.jpg | [Yellow Rose](https://www.flickr.com/photos/49694447@N00/8201972752) | Kumaravel | CC BY 2.0 | crop; weekday tint at runtime |
| tex/garland_jasmine.jpg, tex/garland_rose.jpg | [These decorative bright yellow marigold garland arrangements](https://www.flickr.com/photos/124476447@N02/15948584746) | UpSticksNGo | CC BY 2.0 | crop |

## Fur (shell + fin fur, baked by `scripts/life/bake_fur.py`, comb rules in `data/fur_dog.json`, `data/fur_cat.json`)

| file | source photo | author | licence | processing |
|---|---|---|---|---|
| tex/dog_albedo.jpg, tex/dog_fur.jpg, tex/cat_albedo.jpg, tex/cat_fur.jpg | [Coarse Fur](https://www.flickr.com/photos/146348689@N08/24952672127) | CodeHole | CC BY-SA 2.0 | flattened, seamless, resampled ALONG the per-texel strand flow (bone-chain comb rasterised into the model atlas, cell-rotated synthesis) → strand detail + shell strand-density map; dog colours = model atlas low-frequency layout recoloured to a real Thai soi-dog palette sampled from the photos below |
| (dust blotches in the albedos) | public/assets/textures/pbr/dirt_path_dry (Poly Haven "dirt_floor") | eye-candy.xyz | CC0 | luminance as street-grime mask on paws / belly |
| (colour reference only, not shipped) | [Thai street dog](https://www.flickr.com/photos/91994044@N00/5855237593) · [Soi Dog](https://www.flickr.com/photos/29443624@N05/2755519472) · [soi dog, pondering](https://www.flickr.com/photos/44124401641@N01/5065289628) | quinet · Thai Dogs · istolethetv | CC BY 2.0 | fawn / cream / saddle colours sampled |

## Sounds

The life module uses the shared audio manifest (credits in `references/credits/R5-audio.md`): dog_bark, dog_whine, dog_eat, dog_happy_pant, dog_howl_night, cat_meow, cat_purr_loop, motorbike_pass, scooter_idle_loop, tuktuk_engine_loop, songthaew_engine_loop, car_horn_short, truck_horn, bus_airbrake, siren_distant, icecream_cart_bell, junk_buyer_loudspeaker, traffic_bangkok_loop, street_ambience_day/night_loop, market_crowd_loop, crowd_chatter_loop, birds_loop, cicadas_loop, crickets_frogs_night_loop, tv_muffled_loop, radio_distant_loop, tokay_gecko, rooster, temple_bell, crow, pigeons, eerie_drone_loop, ghost_scare_sting, ghost_laugh_female, whisper, wind_howl, motorcycle_ghost_engine_loop, crowd_laugh, female_scream_comedic, gasp, sparkle_chime, coin_clink, snore_loop. No extra audio files are shipped by life.

## Code-only (no third-party assets)

Noise-shader mist, glow and entrail shaders (`src/modules/life/fx.ts`), shell-texture fur (`creature.ts`), procedural fallback quadruped (`quad.ts`).
