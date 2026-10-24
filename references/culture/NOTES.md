# Thai pop culture, memes & street life: reference sheet for เฮียผัด!

Dialogue lives in `references/culture/lines.json` (545 bilingual lines, 29 keys, 17 mad-system situations, 36 templated headlines).
Generate or extend it with `scripts/research/R4/build_lines.py`.

**Use columns:** `sign` (shop sign or wall text) · `poster` · `NPC` (spoken line / speech bubble) · `item` (buyable or pickup) · `news` (ไทยรั่ว headline) · `egg` (easter egg) · `sfx` (sound cue).
**Status:** ✅ evergreen · 🆕 verified current 2024–2026 · ⚠ use with care.

## Hard avoid list
- **Royal family:** nothing, ever. No portraits on shop walls; real shophouses often have them, but we leave that space empty or put a calendar there instead. No royal colours or symbols used as jokes.
- **Politics:** no politicians, parties, party colours used as jokes, or protest symbols.
  This rules out **"กีกี้ / kiki"**, Google Thailand's #1 search of 2025, because it comes from a March 2025 no-confidence debate; the 2023 slogan "ส้มรักพ่อ"; and hand-sign memes.
- **Real people or brands:** no real celebrities, influencers, singers, TV hosts or real logos. Use parodies: **8-Twelve**, sauce **ภูเขาเงิน**, tabloid **ไทยรั่ว**, magazine **ซอยเก๋**.
- **Religion:** monks, Buddha images, temples and spirit houses are treated respectfully. No slapping or snatching near monks, no jokes about Buddha images.
  Ghosts and folklore are fine. Amulet and takrut *sales* humour is fine (it's commerce), but not mockery of belief.

## A. Food & ordering culture
| # | Thai | Gloss | How to use |
|---|---|---|---|
| 1 | อะไรก็ได้ | "Whatever": the classic non-order. Partners and colleagues say it, then reject every suggestion | NPC order type: accepts any dish but rates it −1 if it's ไข่เจียว ("ไม่เอาไข่เจียว"). News: *"สั่งอะไรก็ได้ ได้ไข่เจียว โวย"* |
| 2 | ไม่เผ็ด → then complains it's bland | Orders "not spicy", then adds chilli fish sauce and says "จืด" | NPC + mad system (`not_spicy_got_spicy`). Tooltip for the chilli count |
| 3 | กะเพราไก่ไข่ดาวไม่สุก | The canonical office-lunch order (chicken kaprao, runny egg) | NPC order variant. Recipe-book note "ไข่ดาวไม่สุก = 45 วิ" |
| 4 | เมนูสิ้นคิด | "No-idea menu": kaprao is what you order when you can't think | Magazine joke, news, skill-tree thought |
| 5 | กะเพราใส่ถั่วฝักยาว? | The long-beans-in-kaprao drama. A Facebook page started in 2013 to "ทวงคืนผัดกะเพรา" (no long beans, baby corn or onion); food historians point to a 1970 recipe that did use long beans ✅ | Recipe book "ห้ามใส่ถั่วฝักยาว!!". News: purist club protest. Customer angry option |
| 6 | ไข่ดาวกรอบ / ไข่ดาวไม่สุก / ไข่ดาวสุก | Lacy crispy edges in lots of oil; yolk runny or set | Order modifiers; the physics goal for the egg minigame |
| 7 | พิเศษ (+10 บาท) | "Special" = bigger portion | Menu add-on. NPC "พิเศษครับ" |
| 8 | ราดข้าว / ใส่กล่อง / แยกข้าว | Over rice / to go / rice on the side | NPC order modifiers |
| 9 | พริกน้ำปลา | Chilli fish sauce: always on the table | Item (condiment jar); customer asks for it |
| 10 | เครื่องปรุงสี่ทหารเสือ | The table condiment set: sugar, fish sauce + chilli, vinegar chilli, chilli flakes | Table prop item; customers "ปรุง" themselves (rating effect) |
| 11 | ส้มตำ war: ไทย vs ปูปลาร้า | Thai sweet vs Isan fermented-crab som tam | Rival vendor event; news *"แม่ค้าส้มตำเปิดศึก"* |
| 12 | อร่อยไม่อร่อยไม่รู้ รู้แต่หมด | "Don't know if it's good, only know it sells out" | Sign on the cart when sold out; shop-sign line |
| 13 | ราคาเป็นกันเอง | "Friendly price" | Menu poster footer; NPC review |
| 14 | ถึงเครื่อง | "Properly seasoned, punchy" | Good-taste review |
| 15 | คิวยาว | Long queue = proof it's good | Queue mechanic; news *"คิวยาวถึงปากซอย"* |
| 16 | ข้าวเติมฟรีไหม | Free rice refill? | Mad-system `customer_wants_free_refill` |
| 17 | ติดไว้ก่อน | "Put it on my tab" | NPC pay option. Recipe-book debts "ป้าแดง ค้าง 40" |
| 18 | แบงค์พันทอนได้ไหม | "Change for a 1000?": the vendor nightmare | Pay line; cardboard menu "ไม่มีเงินทอนแบงค์พัน!" |
| 19 | สแกนจ่าย | QR PromptPay-style scanning, everywhere since ~2018 🆕 | Laminated QR card prop with a parody bank name. Customer pay line |
| 20 | หมูกระทะ | Thai BBQ hot-pot buffet: what friends do on payday | Ambient chatter; future upgrade idea |

## B. Online & social culture
| # | Thai | Gloss | How to use |
|---|---|---|---|
| 21 | 555 | "hahaha" (5 is pronounced *ha*) ✅ | Speech bubbles, phone screens, friends' chat |
| 22 | สวัสดีวันจันทร์ flower images | Aunties and parents send glittery flower-greeting images on LINE every morning, a colour per weekday (Mon yellow, Tue pink, Wed green, Thu orange, Fri blue, Sat purple, Sun red) ✅ | `posters/poster_sawasdee_wan_jan.png`. Phone-screen prop. News: *"ป้าส่ง 48 รูปลงกลุ่มไลน์"* |
| 23 | ฝากร้านด้วยนะคะ | "Please support my shop": the comment-section plug | Auntie line; magazine small print |
| 24 | CF (แม่ค้าออนไลน์) | Live-selling: comment "CF" to confirm a purchase. TikTok Shop live selling is huge (2025–2026 reports: 5M+ sellers in TH) 🆕 | Ambient NPC on a phone "CF ได้เลยค่ะ". Easter egg: a ghost doing a live sale at 3 a.m. |
| 25 | ทักแชท | "DM us" (price not shown, "ask in chat") | Poster tagline; NPC |
| 26 | ตึงๆ / ตัวตึง | Hardcore / the badass one (Wisesight 2022 #3) | Friends' high-five line; skill unlock text |
| 27 | อิหยังวะ | "What the heck?" (Isan), still used constantly | Customer reaction to weird food or slapping |
| 28 | ฉ่ำ | "A lot / very" (top word of 2023) | "ร้อนฉ่ำ", "รถติดฉ่ำ" in chatter |
| 29 | ชีเสิร์ฟ | "She serves / slays": the big word of late 2024–2025 🆕 | Good review; news *"กะเพราชีเสิร์ฟ!"* |
| 30 | เกิดแต่กับกู | "Why only me?", TikTok self-pity, 2025 🆕 | Player-death / disaster-day banter |
| 31 | จึ้ง / เกือบตุย | Wow-stunning / almost died | NPC exclamations |
| 32 | กลุ่มไลน์หมู่บ้าน / โพสต์ลงกลุ่ม | Neighbourhood Facebook/LINE groups where people post complaints | Threat line in the mad system; girl-scream gag |
| 33 | รีวิวหนึ่งดาว | One-star review threat | Angry customer line |

## C. Street life, sounds & characters
| # | Thai | Gloss | How to use |
|---|---|---|---|
| 34 | สวัสดีค่ะ ยินดีต้อนรับค่ะ + ติ๊งต่อง | Convenience-store greeting + two-tone door chime | 8-Twelve clerk (sfx on enter) |
| 35 | "อุ่นไหมคะ / รับถุงไหมคะ" | "Heat it up? / Need a bag?" (plastic bags cost money since the 2020 bag ban) | 8-Twelve checkout; mad system `convenience_no_bag` |
| 36 | รถรับซื้อของเก่า loudspeaker | Pickup truck looping "รับซื้อ ทีวีเก่า ตู้เย็นเก่า แอร์เก่า..." | Roaming vehicle with a looping voice clip (sfx) |
| 37 | Ice-cream cart bell | Push-cart coconut ice cream with a hand bell | Roaming NPC (sfx bell) |
| 38 | สองแถว "ไปไหน" | Songthaew driver asking where you're going | Vehicle NPC |
| 39 | วินมอไซค์ | Motorbike taxi rank in orange vests, haggling | Motorbike taxi NPC + mad system `motorbike_taxi_overcharge` |
| 40 | เจ๊ / เฮีย / พี่ / น้อง / ป้า / ลุง | Address terms | All dialogue (see `lines.json → _meta.address_terms`) |
| 41 | เด็กเสิร์ฟ | Waiter kid, usually the owner's child | Hireable helper (future); NPC |
| 42 | ฝรั่ง backpackers | Western tourists: "no spicy", "same same", flip-flops | Customer archetype; "ไม่เผ็ด" orders |
| 43 | เหล้าขาว / ลุงเมา | Rice liquor, drunk uncle at night | Mad-system `drunk_uncle` |
| 44 | ไก่ชน | Fighting roosters kept in bamboo cages in sois | Ambient prop + crowing sfx at dawn (no fights shown) |
| 45 | หมาจร / แมวส้ม | Soi dogs; the meme that orange cats are chaotic ("แมวส้ม") | Stray dog (adoptable); orange cat on Day 5 |
| 46 | รถติดเพราะฝนตก | Rain = instant gridlock + flooding | Weather event; news; motorbike-taxi line |
| 47 | น้ำท่วมขัง | Street flooding after 30 min of rain | Disaster-day event with puddle physics |
| 48 | เทศกิจ | City inspectors who chase vendors off pavements | Mad-system consequence; future event |
| 49 | กาแฟโบราณ / โอเลี้ยง / ชาไทย in a plastic bag | Street drinks, bag with a straw tied by a rubber band | Items; promo poster `promo_8twelve_thai_tea.png` |
| 50 | ตักบาตร | Morning alms round of monks | Respectful morning event: offer food, monk blesses (`lines.json → monk`) |
| 51 | ศาลพระภูมิ | Spirit house with red Fanta, garlands, zebra figurines | World prop; offering a drink gives a small luck buff (respectful) |

## D. Luck, lottery & superstition
| # | Thai | Gloss | How to use |
|---|---|---|---|
| 52 | หวย / สลากกินแบ่ง | Government lottery, drawn on the 1st and 16th, official price 80 baht (resellers often charge 100+; digital tickets via an app since 2022) ✅ | Lottery seller NPC; poster `poster_lottery.png`; buyable ticket that resolves on days 1/16 |
| 53 | เลขเด็ด | "Hot numbers" from dreams, licence plates, accidents | News box "เลขเด็ดงวดนี้"; recipe-book doodles 58 / 85 / 471 |
| 54 | ขูดต้นไม้หาเลข | Rubbing powder on tree bark (banana / old trees) to read numbers | Easter egg: rub the banana tree near นางตานี's tree to get a number |
| 55 | นางตานี | Banana-tree ghost (female) | Ghost at night (lines.json) |
| 56 | พระเครื่อง / ตะกรุด | Amulets / rolled-metal takrut charms for luck in sales | Market stall item; newspaper ad "ตะกรุดเรียกลูกค้า" (parody) |
| 57 | ยาดองสมุนไพร | Herbal-pickled liquor "for aches" | Newspaper ad "ยาดองตราเสือหลับ" |
| 58 | ดูดวง | Fortune telling ("แม่หมอ") | Classified ad; NPC |
| 59 | ทำบุญ / กรวดน้ำ | Making merit / pouring water for spirits | เปรต ghost line; homeless-man blessings |
| 60 | ขอให้ขายดีเป็นเทน้ำเทท่า | "May you sell like pouring water" (blessing) | Homeless-man blessing; buff text |

## E. Viral animals, events & fairs
| # | Thai | Gloss | How to use |
|---|---|---|---|
| 61 | หมูเด้ง (Moo Deng) | Pygmy-hippo calf at Khao Kheow Open Zoo, viral since Sept 2024. Turned 2 on 10 July 2026 (zoo party); a new "Hippo Village" exhibit is planned for 2027 🆕 | **Parody only**: "น้องหมูดึ๋ง" (`posters/poster_hippo_moodueng.png`, newspaper small story). Never use the real name or zoo branding |
| 62 | งานวัด | Temple fair: Ferris wheel, darts, fishing game, ลิเก, outdoor cinema, ขนมโตเกียว | `poster_temple_fair.png`; seasonal event (respectful) |
| 63 | หมอลำซิ่ง | Isan mo lam concerts with dancers and big stages | `poster_molam_concert.png` (made-up troupe "คณะเสียงแคนแสนซิ่ง") |
| 64 | สงกรานต์ | Songkran water festival (April) | Possible seasonal event: water guns, wet customers |
| 65 | ลอยกระทง | Krathong floating on the canal (November) | Canal event idea |
| 66 | ตลาดนัด | Night market with plastic stools | Ambient chatter; magazine backdrop |

## F. Ad slogans, parodied
| # | Thai | How to use |
|---|---|---|
| 67 | "จ่ายครบ จบที่เดียว"-style slogans | Parody "ผัดครบ จบที่เฮีย", "ข่าวจริง ข่าวลือ ข่าวรั่ว ครบ จบ ในฉบับเดียว" (newspaper tagline) |
| 68 | "อิ่มง่าย ใกล้บ้าน 24 ชม." | 8-Twelve promo tagline |
| 69 | "ห้องว่างให้เช่า แอร์ เฟอร์ฯ น้ำไฟตามมิเตอร์" | `poster_room_for_rent.png` (tear-off tabs) |
| 70 | "หมาหาย ให้รางวัล" | `poster_missing_dog.png` (photocopy look). Ties to the stray-dog storyline |
| 71 | "ดื่มแต่พอดี ขับไม่ดื่ม" | Small print on the herbal-liquor ad |

## Notes on tone
- Customers are honest and a bit petty, never cruel. Aunties are bossy-kind. Friends swear softly (กู/มึง/เว้ย) but nothing nastier.
- Isan flavour (อิหยังวะ, ม่วนซื่น, โฮแซว) is affectionate, never "bumpkin" mockery.
- Keep English glosses short so they work as subtitle lines under Thai bubbles.

## Sources checked (Oct 2026)
- Moo Deng 2nd birthday & zoo plans: Khaosod English, 10 Jul 2026 (khaosodenglish.com/life/2026/07/10/moo-deng-turns-two…); Africanews 10 Jul 2026.
- 2024/25 slang (ชีเสิร์ฟ, เกิดแต่กับกู, มันจะไอนั่น, เหยิน, ฮ้อบ): marketingoops.com (Wisesight data Nov 2024 – Jan 2025).
- 2023 viral phrases (ฉ่ำ etc.): Thai PBS, "เปิดที่มา 10 วลีเด็ดโซเชียล ปี 2566". 2022 ranking (ตัวแม่, ตัวตึง): Brand Buffet / Wisesight.
- "kiki" (political, avoid): Chiang Rai Times explainer 2025. "555" explainer: Khaosod English, 26 Aug 2026.
- Kaprao long-bean debate: Daily News, Sanook Campus, Matichon (กฤช เหลือลมัย).
- Lottery 80-baht price / overpricing / digital tickets: Thai PBS World, Bangkok Post.
- TikTok Shop scale in Thailand 2026: we-interactive.com, thailand-business-news.com (agency figures, treat as indicative).
