"""Generate references/culture/lines.json (bilingual dialogue; natural spoken Thai + English gloss).
Run: python3 -I scripts/research/R4/build_lines.py
Placeholders: {dish} {price} {money} {customers} {rating} {day} {name} {total} {change}"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import content_th as C

OUT = "/home/user/special-telegram/references/culture/lines.json"


def L(*pairs):
    """L(('th','en'), ...) -> list of dicts"""
    return [dict(th=t, en=e) for t, e in pairs]


D = {}
D["_meta"] = {
    "language": "Thai (spoken, casual street register) + English gloss",
    "address_terms": {
        "เฮีย": "older brother (Sino-Thai) — customers call the cook this; the shop is named after it",
        "เจ๊": "older sister (Sino-Thai) — female shopkeepers / auntie vendors",
        "พี่": "older sibling, polite default for strangers older than you",
        "น้อง": "younger sibling — vendors call young customers / staff this",
        "ป้า / ลุง": "auntie / uncle (older than your parents)",
        "หลวงพี่ / หลวงพ่อ": "how laypeople address a monk (young / old); monks call themselves อาตมา",
        "ครับ / ค่ะ / คะ / จ้ะ / จ้า": "polite particles: ครับ (male), ค่ะ statement / คะ question (female), จ้ะ/จ้า friendly",
    },
    "placeholders": "{dish} {price} {money} {customers} {rating} {day} {name} {total} {change} {item}",
    "guardrails": "No royals, politicians, real celebrities or brands. Monks/temples respectful. Ghost folklore OK.",
}

D["customer_greet"] = L(
    ("เฮีย! เปิดยังครับ", "Hia! Are you open yet?"),
    ("สวัสดีค่ะ ขอดูเมนูหน่อยค่ะ", "Hello, can I see the menu?"),
    ("มีที่นั่งไหมพี่", "Got a seat, bro?"),
    ("พี่ๆ ร้านใหม่เหรอ ไม่เคยเห็นเลย", "Hey, is this a new shop? Never seen it before"),
    ("หิวมาก ขออะไรเร็วๆ หน่อย", "Starving. Something quick, please"),
    ("ได้ยินว่ากะเพราร้านนี้เด็ดนะ", "Heard your kaprao is legit"),
    ("น้องๆ นั่งตรงไหนก็ได้ใช่ไหม", "Kid, I can sit anywhere, right?"),
    ("เฮียยังจำผมได้ไหม มาอีกแล้ว", "Hia, remember me? I'm back again"),
    ("เพื่อนบอกให้มาลอง", "My friend told me to try this place"),
    ("ร้อนจัง ขอน้ำแข็งเปล่าก่อนได้ไหม", "So hot. Can I get a cup of ice first?"),
)

D["customer_order"] = {
    "kaprao_moo_sap": L(
        ("กะเพราหมูสับจานนึงครับ", "One minced-pork kaprao, please"),
        ("เอากะเพราหมูสับ ราดข้าวค่ะ", "Kaprao pork over rice"),
        ("กะเพราหมูสับ ใส่กล่องกลับบ้านครับ", "Minced-pork kaprao to take away"),
        ("ขอกะเพราหมูสับ ไม่ใส่ถั่วฝักยาวนะ", "Kaprao pork — no long beans, OK?"),
        ("กะเพราหมูสับ พิเศษครับ", "Kaprao pork, large (พิเศษ)"),
        ("เหมือนเดิมครับเฮีย กะเพราหมูสับ", "The usual, hia — kaprao pork"),
        ("กะเพราหมูสับสองจาน แยกข้าวนะคะ", "Two kaprao pork, rice on the side"),
        ("กะเพราหมูสับ ข้าวเยอะๆ นะพี่", "Kaprao pork, lots of rice please"),
    ),
    "plus_khai_dao": L(
        ("กะเพราหมูสับไข่ดาวครับ", "Kaprao pork with a fried egg"),
        ("เพิ่มไข่ดาวด้วยค่ะ", "Add a fried egg too"),
        ("ไข่ดาวกรอบๆ นะ ขอบไหม้ๆ", "Crispy fried egg, burnt lacy edges"),
        ("ไข่ดาวสองฟองเลยเฮีย วันนี้รวย", "Two fried eggs, hia — I'm rich today"),
        ("ไข่ดาวสุกๆ นะครับ ไม่เอาเยิ้ม", "Egg well done, not runny"),
        ("กะเพราไข่ดาว เมนูสิ้นคิดประจำชาติ", "Kaprao + fried egg, the national 'no-idea' dish"),
        ("ไข่ดาวแยกจานนะ จะได้ไม่เละ", "Egg on a separate plate so it doesn't get soggy"),
        ("มีไข่เป็ดไหม ขอไข่ดาวไข่เป็ด", "Got duck eggs? Fried duck egg please"),
    ),
    "khai_dao_mai_suk": L(
        ("ไข่ดาวไม่สุกนะครับ", "Fried egg, not cooked (runny)"),
        ("ไข่ดาวเยิ้มๆ ไข่แดงไหลๆ", "Runny yolk, flowing"),
        ("ไข่ดาวไม่สุก แต่ไข่ขาวต้องสุกนะ", "Runny yolk but the white must be cooked"),
        ("ไข่แดงเยิ้มนะเฮีย ถ้าแข็งไม่จ่าย", "Runny yolk, hia — if it's hard I'm not paying"),
        ("ไม่สุกค่ะ เอาไว้จิ้มข้าว", "Runny, so I can dip the rice"),
        ("ไข่ดาวไม่สุกกกก ย้ำสามรอบ", "Not cooked — I'm saying it three times"),
        ("แบบเยิ้มๆ ที่เจาะแล้วไหลอะ", "The kind that oozes when you poke it"),
        ("ไข่ดาวไม่สุก กรอบนอกนิ่มใน", "Runny egg: crispy outside, soft inside"),
    ),
    "mai_phet": L(
        ("ไม่เผ็ดนะครับ", "Not spicy please"),
        ("ไม่เผ็ดเลยค่ะ พริกเม็ดเดียวก็ไม่เอา", "Not spicy at all — not even one chilli"),
        ("เผ็ดน้อยๆ นะ ท้องไม่ดี", "Only a little spicy, my stomach's bad"),
        ("ไม่เผ็ด... แต่ขอพริกน้ำปลาข้างนอก", "Not spicy... but give me chilli fish sauce on the side"),
        ("ลูกกินด้วย ไม่เผ็ดนะคะ", "My kid's eating too, not spicy"),
        ("No spicy! ไม่เผ็ดๆ", "No spicy! (backpacker)"),
        ("เผ็ดนิดเดียว นิดเดียวจริงๆ", "Just a tiny bit spicy, really tiny"),
        ("ไม่เผ็ดครับ เดี๋ยวปรุงเอง", "Not spicy, I'll season it myself"),
    ),
    "phet_mak": L(
        ("เผ็ดมากครับ", "Very spicy"),
        ("เผ็ดๆ เลยเฮีย พริกสิบเม็ด", "Spicy, hia — ten chillies"),
        ("เผ็ดแบบคนอีสานนะ", "Isan-level spicy"),
        ("เผ็ดจนหูอื้อเลย", "So spicy my ears ring"),
        ("เอาเผ็ดแบบร้องไห้", "Make me cry spicy"),
        ("พริกเยอะๆ ไม่เผ็ดไม่กิน", "Lots of chilli, I don't eat it if it isn't spicy"),
        ("เผ็ดสะใจครับ วันนี้อกหัก", "Satisfyingly spicy, I just got dumped"),
        ("ขอเผ็ดๆ ค่ะ แต่ถ้าเผ็ดเกินจะด่านะ", "Spicy please — but if it's too spicy I'll complain"),
    ),
    "arai_ko_dai": L(
        ("อะไรก็ได้ครับ", "Whatever"),
        ("อะไรก็ได้ที่อร่อย", "Whatever's tasty"),
        ("เฮียทำอะไรเก่งสุด เอาอันนั้น", "What are you best at? That one"),
        ("อะไรก็ได้... แต่ไม่เอาไข่เจียวนะ", "Whatever... but not omelette"),
        ("อะไรก็ได้ ไม่เผ็ด ไม่มัน ไม่เค็ม ไม่หวาน", "Whatever — not spicy, not oily, not salty, not sweet"),
        ("แล้วแต่เฮียเลย", "Up to you, hia"),
        ("อะไรก็ได้ที่เร็วที่สุด", "Whatever's fastest"),
        ("อะไรก็ได้ค่ะ เดี๋ยวแฟนเลือก... แฟนก็บอกอะไรก็ได้", "Whatever — my partner will pick... they also said whatever"),
    ),
    "khai_jiao": L(("ข้าวไข่เจียวครับ", "Rice with omelette"), ("ไข่เจียวฟูๆ ราดซอสพริก", "Fluffy omelette with chilli sauce"),
                   ("ไข่เจียวหมูสับค่ะ", "Minced-pork omelette"), ("ไข่เจียวกรอบๆ นะ", "Crispy omelette please")),
    "khao_phat": L(("ข้าวผัดหมูครับ", "Pork fried rice"), ("ข้าวผัดไข่ ใส่มะนาวเยอะๆ", "Egg fried rice, lots of lime"),
                   ("ข้าวผัดพิเศษ ไม่ใส่ต้นหอม", "Large fried rice, no spring onion"), ("ข้าวผัดกุ้งได้ไหม", "Can I get shrimp fried rice?")),
    "other_dishes": L(("ผัดพริกแกงหมูราดข้าว", "Red curry stir-fry pork over rice"), ("ผัดซีอิ๊วหมู ใส่ไข่", "Pad see ew pork with egg"),
                      ("ราดหน้าหมูหมัก", "Rad na with marinated pork"), ("ต้มยำกุ้งน้ำใส ถ้วยนึง", "One clear tom yum shrimp"),
                      ("หมูกระเทียมไข่ดาว", "Garlic pork with fried egg"), ("ผัดผักบุ้งไฟแดง ไม่ใส่พริก", "Red-fire morning glory, no chilli")),
    "drinks": L(("น้ำเปล่าขวดนึง", "One bottle of water"), ("โอเลี้ยงมีไหม", "Got Thai iced black coffee?"),
                ("น้ำแข็งเปล่าแก้วนึงครับ", "A cup of plain ice"), ("โค้กก็ได้... เอ้ย น้ำดำอะ", "Soda... I mean the black fizzy one")),
}

D["customer_wait_long"] = L(
    ("เฮีย อีกนานไหม", "Hia, how much longer?"),
    ("ของผมได้ยังครับ", "Is mine ready yet?"),
    ("รอจนหิวรอบสองแล้วนะ", "I've waited so long I'm hungry again"),
    ("ลืมของหนูหรือเปล่าคะ", "Did you forget mine?"),
    ("โต๊ะนู้นมาทีหลังได้ก่อนอีก", "That table came after me and got served first"),
    ("ยกเลิกได้ไหม ไม่ทันแล้ว", "Can I cancel? I'm late"),
    ("ผัดอยู่หรือปลูกกะเพราอยู่", "Are you cooking it or growing the basil?"),
    ("ข้าวเย็นหมดแล้ว รอกับข้าวอยู่", "My rice is cold, still waiting on the topping"),
    ("พักเที่ยงหมดแล้วเนี่ย", "My lunch break is over"),
    ("โทษนะ คิวผมที่เท่าไหร่", "Excuse me, what number am I in the queue?"),
)


def asp(**kw):
    return {k: L(*v) for k, v in kw.items()}


D["customer_review_good"] = asp(
    taste=[("อร่อยมากเฮีย!", "So good, hia!"), ("ถึงเครื่องจริงๆ", "Properly seasoned — the real deal"), ("กลิ่นกระทะหอมมาก", "Love the wok smell"),
           ("กะเพราหอมฟุ้ง อร่อยกว่าร้านเดิมอีก", "Fragrant basil, better than the old place"), ("ไข่ดาวกรอบกำลังดี", "The egg is perfectly crispy"),
           ("รสชาติกลมกล่อม", "Well-rounded flavour"), ("อร่อยจนต้องถ่ายรูปลงสตอรี่", "So good I'm posting it on my story"), ("ชีเสิร์ฟ! (เขาเสิร์ฟ)", "It serves! (slang)")],
    portion=[("ให้เยอะดี อิ่มมาก", "Generous, I'm full"), ("ข้าวพูนจานเลย", "Rice piled up high"), ("คุ้มสุดๆ", "Super worth it")],
    price_cheap=[("ราคาเป็นกันเอง", "Friendly price"), ("ถูกขนาดนี้ อยู่ได้ไง", "This cheap? How do you survive?"), ("ห้าสิบบาทอิ่มท้อง", "Full for fifty baht")],
    wait=[("ได้ไวมาก", "Super fast"), ("สั่งปุ๊บได้ปั๊บ", "Ordered and boom, here it is"), ("เร็วกว่าเดลิเวอรี่อีก", "Faster than delivery")],
    clean=[("ร้านสะอาดดี", "Clean shop"), ("โต๊ะเช็ดสะอาด นั่งสบาย", "Tables wiped, comfy"), ("จานช้อนสะอาด", "Clean plates and spoons")],
)
D["customer_review_ok"] = asp(
    taste=[("ก็โอเคนะ", "It's OK"), ("กินได้ ไม่ได้ว้าว", "Edible, not wow"), ("ธรรมดาๆ", "Ordinary"), ("รสชาติพอใช้", "Decent"),
           ("อร่อยแหละ แต่ร้านป้าข้างๆ ก็อร่อย", "Tasty, but auntie's next door is too"), ("ขาดอะไรไปนิดนึง", "Missing a little something")],
    portion=[("น้อยไปนิด", "A bit small"), ("ข้าวพอดี กับข้าวน้อยไปหน่อย", "Rice fine, topping a bit little")],
    price=[("ราคาก็แล้วแต่ร้านแหละ", "Price is... the shop's call"), ("แพงนิดๆ แต่โอเค", "Slightly pricey but OK")],
    wait=[("รอนานนิดนึง", "Waited a bit"), ("ได้ช้าแต่ก็ได้", "Slow but it came")],
)
D["customer_review_bad"] = asp(
    taste=[("ไม่อร่อยเลย", "Not tasty at all"), ("อิหยังวะเนี่ย", "What the heck is this"), ("กินไปสองคำพอ", "Two bites was enough")],
    too_salty=[("เค็มปี๋!", "Way too salty!"), ("ใส่น้ำปลาทั้งขวดเหรอ", "Did you pour in the whole bottle of fish sauce?"), ("เค็มจนไตร้อง", "So salty my kidneys are crying"),
               ("กินเสร็จต้องซื้อน้ำสามขวด", "I'll need three bottles of water after this")],
    too_bland=[("จืดสนิท", "Totally bland"), ("ลืมใส่ซอสหรือเปล่า", "Did you forget the sauce?"), ("จืดเหมือนชีวิตผม", "Bland as my life"),
               ("ต้องปรุงเองทั้งจาน", "I had to season the whole plate myself")],
    too_spicy=[("เผ็ดมาก! บอกแล้วว่าไม่เผ็ด", "Too spicy! I said not spicy"), ("ปากพังแล้ว", "My mouth is destroyed"), ("น้ำตาไหลเลยเนี่ย", "I'm literally crying"),
               ("เผ็ดจนเห็นแม่นาค", "So spicy I saw Mae Nak")],
    burnt=[("ไหม้!", "Burnt!"), ("ขมเลย กระเทียมไหม้", "Bitter — the garlic's burnt"), ("ดำปี๋อย่างกับถ่าน", "Black as charcoal"), ("กลิ่นไหม้ทั้งซอย", "The whole soi smells burnt")],
    portion=[("น้อยมาก กินสองคำหมด", "Tiny — gone in two bites"), ("หมูสับนับเม็ดได้", "I can count the pieces of pork"), ("แมวยังกินไม่อิ่ม", "Even a cat wouldn't be full")],
    price_too_high=[("แพงไป!", "Too expensive!"), ("แพงกว่าในห้างอีก", "Pricier than the mall"), ("ราคานี้ต้องมีกุ้งมังกร", "At this price there'd better be lobster"),
                    ("ร้อยนึงจานนึง? บ้าไปแล้ว", "A hundred a plate? Insane")],
    wait=[("รอนานมาก", "Waited forever"), ("รอจนหิวรอบสอง", "Waited till I got hungry twice"), ("ไม่มาอีกแล้ว", "Never coming back")],
    dirty_table=[("โต๊ะสกปรก", "Dirty table"), ("แมลงวันเต็มโต๊ะ", "Flies all over the table"), ("จานคนก่อนยังไม่เก็บเลย", "Last person's plates are still here"),
                 ("โต๊ะเหนียวหนึบ", "The table is sticky")],
    served_wrong_dish=[("ผมสั่งไข่เจียว ไม่ใช่ไข่ดาว", "I ordered omelette, not fried egg"), ("อันนี้ไม่ใช่ของหนู", "This isn't mine"),
                       ("บอกไม่เผ็ด ได้เผ็ดมาก", "Said not spicy, got very spicy"), ("ไข่ดาวสุก บอกไม่สุก!", "Egg's cooked, I said runny!")],
    no_spoon=[("ไม่มีช้อนจะกินยังไง", "No spoon, how do I eat?"), ("ขอช้อนส้อมด้วย", "Spoon and fork please"), ("ต้องกินด้วยมือเหรอ", "Do I eat with my hands?")],
)

D["customer_pay"] = L(
    ("เก็บเงินด้วยครับ", "Check please"), ("เท่าไหร่คะ", "How much?"), ("เฮีย ตังค์วางไว้ที่โต๊ะนะ", "Hia, money's on the table"),
    ("สแกนจ่ายได้ไหม", "Can I pay by QR scan?"), ("แบงค์พันทอนได้ไหม", "Got change for a thousand?"), ("ไม่ต้องทอนครับ", "Keep the change"),
    ("ขอเหรียญสิบนะ จะเอาไปหยอดตู้", "Give me ten-baht coins, I need them for the machine"), ("{total} บาทใช่ไหม นี่ครับ", "{total} baht right? Here"),
    ("ติดไว้ก่อนได้ไหม เดี๋ยวพรุ่งนี้จ่าย", "Can I owe you till tomorrow?"), ("อร่อยมาก ไว้มาใหม่นะ", "Delicious, I'll come again"),
)

D["customer_angry"] = L(
    ("นี่มันอะไรเนี่ย!", "What on earth is this!"), ("เรียกเจ้าของร้านมาคุยเลย", "Get me the owner"), ("จะรีวิวหนึ่งดาว!", "I'm giving one star!"),
    ("ไม่จ่าย!", "I'm not paying!"), ("โพสต์ลงกลุ่มแน่!", "I'm posting this in the neighbourhood group!"), ("เสียเวลามาก!", "What a waste of time!"),
    ("ลูกค้าคือพระเจ้านะ!", "The customer is god!"), ("บริการแบบนี้ไม่ต้องขายแล้ว", "With service like this, quit selling"),
)

# ----------------------------------------------------------------- mad system (3-second choices)
def opt(th, en, kind, outcome, mood=0, money=0):
    return dict(th=th, en=en, type=kind, correct=(kind == "correct"), funny=(kind == "funny"), outcome=outcome, mood_delta=mood, money_delta=money)


D["mad_system_choices"] = [
    dict(id="too_salty", who="customer", trigger="dish salt > threshold", time_limit_s=3,
         prompt=dict(th="เค็มขนาดนี้ จะให้กินยังไง!", en="How am I supposed to eat something this salty!"),
         options=[opt("ขอโทษครับ เดี๋ยวทำให้ใหม่ ไม่คิดเงินเพิ่ม", "Sorry, I'll remake it at no extra cost", "correct", "customer calms down, waits for remake", +2),
                  opt("ก็กินกับข้าวเยอะๆ สิ", "Then eat it with more rice", "incorrect", "customer leaves without paying", -3),
                  opt("เค็มแปลว่ารักนะครับ", "Salty means love, you know", "funny", "50% laughs and pays half, 50% storms off", 0)]),
    dict(id="not_spicy_got_spicy", who="customer", trigger="ordered mai phet, chilli > 2", time_limit_s=3,
         prompt=dict(th="บอกแล้วว่าไม่เผ็ด! ปากพังหมดแล้ว!", en="I said NOT spicy! My mouth is wrecked!"),
         options=[opt("ขอโทษครับ เอาน้ำแข็งกับน้ำหวานไปก่อน เดี๋ยวผัดใหม่", "Sorry — ice and a sweet drink first, I'll cook a new one", "correct", "mood recovers, drink costs you 10", +2, -10),
                  opt("แค่นี้เผ็ดเหรอ", "You call that spicy?", "incorrect", "1-star review", -3),
                  opt("ลองคิดซะว่าซาวน่าปากฟรี", "Think of it as a free mouth sauna", "funny", "backpackers laugh; Thai aunties don't", 0)]),
    dict(id="waited_too_long", who="customer", trigger="wait > 6 min", time_limit_s=3,
         prompt=dict(th="รอมาครึ่งชั่วโมงแล้วนะ!", en="I've been waiting half an hour!"),
         options=[opt("ขอโทษครับ จานต่อไปของพี่เลย แถมไข่ดาวฟรี", "Sorry, yours is next — free fried egg", "correct", "waits happily, egg costs you", +2, -5),
                  opt("คนเยอะอะ รอไปก่อน", "It's busy, just wait", "incorrect", "leaves, tells friends", -2),
                  opt("รอเป็นมิตรภาพ ได้เป็นความทรงจำ", "The waiting is friendship, the food is memories", "funny", "confused silence, waits 1 more minute", 0)]),
    dict(id="wrong_dish", who="customer", trigger="served wrong dish", time_limit_s=3,
         prompt=dict(th="ผมสั่งไข่เจียว นี่มันไข่ดาว!", en="I ordered an omelette, this is a fried egg!"),
         options=[opt("ขอโทษครับ เดี๋ยวเปลี่ยนให้ทันที", "Sorry, I'll swap it right away", "correct", "OK, waits", +1),
                  opt("ไข่เหมือนกันแหละพี่", "Egg is egg, bro", "incorrect", "angry, -1 star", -2),
                  opt("ไข่ดาวคือไข่เจียวที่ยังไม่ได้ตี", "A fried egg is just an omelette that hasn't been beaten yet", "funny", "customer thinks... accepts it and pays", 0)]),
    dict(id="dirty_table", who="customer", trigger="table dirt > threshold", time_limit_s=3,
         prompt=dict(th="โต๊ะสกปรกขนาดนี้ จะให้นั่งตรงไหน", en="The table's this filthy — where do I sit?"),
         options=[opt("ขอโทษครับ เช็ดให้เดี๋ยวนี้เลย", "Sorry, wiping it right now", "correct", "sits after the wipe minigame", +1),
                  opt("นั่งพื้นก็ได้นะ", "You can sit on the floor", "incorrect", "leaves", -3),
                  opt("แมลงวันเขาจองไว้ก่อนครับ", "The flies reserved it first", "funny", "laughs, but wants a discount", 0, -5)]),
    dict(id="price_too_high", who="customer", trigger="price > area fair price * 1.4", time_limit_s=3,
         prompt=dict(th="จานละ {price}? ปล้นกันเหรอ!", en="{price} a plate? Is this a robbery!"),
         options=[opt("ของดีครับพี่ หมูสด ไข่เป็ด ลองก่อนได้ ไม่อร่อยไม่เอาเงิน", "Quality stuff: fresh pork, duck egg. Try it — not good, no charge", "correct", "pays if taste >= good", +1),
                  opt("ไม่มีตังค์ก็ไปกินที่อื่น", "No money? Eat somewhere else", "incorrect", "leaves, area reputation -", -3),
                  opt("ราคานี้รวมค่าความหล่อเชฟแล้ว", "Price includes the chef's handsomeness", "funny", "aunties pay and giggle; men leave", 0)]),
    dict(id="no_spoon", who="customer", trigger="served without spoon", time_limit_s=3,
         prompt=dict(th="ไม่มีช้อน จะให้กินด้วยมือเหรอ", en="No spoon — eat with my hands?"),
         options=[opt("ขอโทษครับ นี่ครับช้อนส้อม", "Sorry, here's a spoon and fork", "correct", "fine", +1),
                  opt("ใช้ตะเกียบไปก่อน", "Use chopsticks for now", "incorrect", "annoyed, -tip", -1),
                  opt("กินมือแบบอินเดีย ได้บุญด้วย", "Eat with your hand like in India, good karma too", "funny", "customer stares, then laughs", 0)]),
    dict(id="burnt", who="customer", trigger="burnt > threshold", time_limit_s=3,
         prompt=dict(th="ไหม้ดำขนาดนี้ เอาถ่านมาให้กินเหรอ", en="Burnt this black — are you serving me charcoal?"),
         options=[opt("ขอโทษครับ ทำใหม่ให้ครับ", "Sorry, I'll make a new one", "correct", "waits", +1),
                  opt("ไหม้นิดเดียวเอง", "It's only a little burnt", "incorrect", "refuses to pay", -2),
                  opt("สูตรใหม่ครับ กะเพราถ่านกัมมันต์ ดีท็อกซ์", "New recipe: activated-charcoal detox kaprao", "funny", "health nut customer buys it", 0)]),
    dict(id="hair_in_food", who="customer", trigger="random 2% when cleanliness low", time_limit_s=3,
         prompt=dict(th="มีเส้นผมในข้าว!", en="There's a hair in my rice!"),
         options=[opt("ขอโทษจริงๆ ครับ เปลี่ยนจานใหม่ และไม่คิดเงิน", "Truly sorry — new plate, on the house", "correct", "forgives", +1, -50),
                  opt("ผมใคร ผมผมเหรอ ผมผมไม่ยาวขนาดนั้น", "Whose hair? Mine? My hair isn't that long", "funny", "a friend gets accused, slap minigame", 0),
                  opt("แค่เส้นเดียวเอง", "It's just one", "incorrect", "leaves, posts in group", -3)]),
    dict(id="drunk_uncle", who="customer", trigger="night, random", time_limit_s=3,
         prompt=dict(th="ไอ้หนู! ขอเหล้าขาวกับกับแกล้มหน่อย!", en="Kid! Bring me white liquor and some drinking snacks!"),
         options=[opt("ร้านไม่มีเหล้าครับลุง ขอเป็นต้มยำร้อนๆ ไหม", "No liquor here, uncle — how about a hot tom yum?", "correct", "orders tom yum, sobers up a bit", +1),
                  opt("ลุงเมาแล้ว กลับบ้านไป", "You're drunk, go home", "incorrect", "uncle sings loudly, scares customers", -2),
                  opt("เหล้าหมด แต่มีน้ำปลาครับ", "Out of liquor, but we've got fish sauce", "funny", "uncle laughs, leaves a 20 tip", 0, 20)]),
    dict(id="auntie_haggle_fail", who="shopkeeper", trigger="lowball offer at market", time_limit_s=3,
         prompt=dict(th="สามสิบ? นี่พริกนะไม่ใช่ใบไม้! ป้าขายมายี่สิบปีแล้ว", en="Thirty? These are chillies, not leaves! I've sold here twenty years"),
         options=[opt("ขอโทษครับป้า เอาสี่สิบห้า แถมกะเพราสักกำได้ไหมครับ", "Sorry auntie — forty-five, and maybe throw in some basil?", "correct", "deal + free basil", +2),
                  opt("ร้านอื่นถูกกว่านี้อีก", "Other stalls are cheaper", "incorrect", "auntie refuses to sell today", -3),
                  opt("ป้าสวยจัง ยังไม่ถึงสิบแปดเลย", "Auntie, you look under eighteen", "funny", "auntie blushes, gives 10% off", +1)]),
    dict(id="wholesale_short_change", who="shopkeeper", trigger="you count change wrong", time_limit_s=3,
         prompt=dict(th="เงินไม่ครบนะน้อง ขาดอีกยี่สิบ", en="That's short, kid — you're twenty missing"),
         options=[opt("ขอโทษครับเจ๊ นี่ครับยี่สิบ", "Sorry, sister, here's twenty", "correct", "fine", +1, -20),
                  opt("ครบแล้ว เจ๊นับผิด", "It's all there, you counted wrong", "incorrect", "shop prices +10% for you", -2),
                  opt("ยี่สิบนั้นผมเก็บไว้ทำบุญให้เจ๊", "I kept that twenty to make merit for you", "funny", "she laughs, lets it go once", 0)]),
    dict(id="motorbike_taxi_overcharge", who="shopkeeper", trigger="motorbike taxi ride", time_limit_s=3,
         prompt=dict(th="ไปตลาด ร้อยนึง", en="To the market — one hundred"),
         options=[opt("ปกติสี่สิบนี่พี่ ขอสี่สิบห้าละกัน", "It's usually forty, bro — forty-five OK?", "correct", "pay 45", 0, -45),
                  opt("โอเค ร้อยนึง", "OK, a hundred", "incorrect", "you overpay", 0, -100),
                  opt("ร้อยนึงผมขับเองดีกว่า พี่ซ้อนไหม", "For a hundred I'll drive — want to ride pillion?", "funny", "he laughs, 40 baht", +1, -40)]),
    dict(id="convenience_no_bag", who="shopkeeper", trigger="checkout at 8-Twelve", time_limit_s=3,
         prompt=dict(th="รับถุงไหมคะ ถุงละสองบาทนะคะ", en="Want a bag? Two baht each"),
         options=[opt("ไม่รับครับ ถือเอง", "No thanks, I'll carry it", "correct", "items go to inventory", 0),
                  opt("ทำไมต้องเสียเงินค่าถุง!", "Why should I pay for a bag!", "incorrect", "clerk sighs, queue glares", -1),
                  opt("ใส่หัวกลับบ้านก็ได้ครับ", "I'll carry them home on my head", "funny", "items stack on your head (physical gag)", 0)]),
    dict(id="landlord_cart_spot", who="shopkeeper", trigger="you park the cart in front of a shophouse", time_limit_s=3,
         prompt=dict(th="ใครให้มาจอดหน้าร้านฉัน!", en="Who said you could park in front of my shop!"),
         options=[opt("ขอโทษครับเจ๊ ขอจอดแค่เย็นนี้ เดี๋ยวเอากะเพรามาฝาก", "Sorry, sister — just this evening, I'll bring you some kaprao", "correct", "allowed; owes 1 free plate", +1),
                  opt("ทางสาธารณะ ใครก็จอดได้", "It's public, anyone can park", "incorrect", "she calls the เทศกิจ (city inspectors)", -3),
                  opt("ร้านเจ๊จะได้มีกลิ่นกะเพราฟรีไงครับ", "Your shop gets free kaprao aroma!", "funny", "50/50", 0)]),
    dict(id="customer_wants_free_refill", who="customer", trigger="random", time_limit_s=3,
         prompt=dict(th="เฮีย ข้าวเติมฟรีป่ะ", en="Hia, free rice refills?"),
         options=[opt("ได้ครับ ทัพพีนึง", "Sure, one scoop", "correct", "happy, -rice", +1),
                  opt("เติมสิบบาท", "Refill is ten baht", "incorrect", "grumbles but pays", -1, 10),
                  opt("เติมฟรี ถ้าร้องเพลงให้ฟังหนึ่งเพลง", "Free if you sing me a song", "funny", "customer sings (audio gag)", +1)]),
    dict(id="ghost_customer", who="customer", trigger="after midnight, ghost visits", time_limit_s=3,
         prompt=dict(th="ขอ... กะเพรา... ไม่ใส่... หัวหอม...", en="One... kaprao... no... onion..."),
         options=[opt("ได้ครับ ไม่ใส่หัวหอม (ขาสั่น)", "Yes, no onion (legs shaking)", "correct", "ghost pays with a mysterious old coin", 0, 30),
                  opt("ผีีีีี!!", "GHOOOST!!", "incorrect", "everyone drops what they carry", -1),
                  opt("ร้านปิดแล้ว... เปิดใหม่ชาติหน้าครับ", "We're closed... reopening next life", "funny", "ghost giggles and vanishes", 0)]),
]

# ----------------------------------------------------------------- bargaining
D["bargaining"] = {
    "shopkeeper_opening": L(("กิโลละแปดสิบจ้า", "Eighty a kilo, dear"), ("หมูสดๆ เพิ่งมาเมื่อเช้า กิโลละร้อยหกสิบ", "Fresh pork, came in this morning — 160 a kilo"),
                            ("กะเพรากำละสิบ สามกำยี่สิบห้า", "Basil ten a bunch, three for twenty-five"), ("ไข่แผงละร้อยสิบ ไข่ใหญ่นะ", "A tray of eggs 110, big ones"),
                            ("ราคานี้ถูกที่สุดในตลาดแล้วจ้า", "This is the cheapest in the market"), ("เอาไปเลยสองร้อย ป้าไม่ได้กำไรหรอก", "Take it for two hundred, I'm not making a profit"),
                            ("โต๊ะพลาสติกตัวละสามร้อย เก้าอี้ร้อยนึง", "Plastic table 300, stools 100"), ("กระทะเหล็กใบนี้ หกร้อยห้าสิบ ใช้ได้สิบปี", "This iron wok 650, lasts ten years")),
    "player_options": {
        "polite": L(("ลดหน่อยได้ไหมครับป้า", "Could you give a little discount, auntie?"), ("ซื้อเยอะ ลดให้หน่อยนะครับ", "I'm buying a lot, a little off please?"),
                    ("ลูกค้าประจำแล้วนะครับ", "I'm a regular now"), ("ขอราคาพ่อค้าแม่ค้าได้ไหมครับ", "Vendor price, please?"),
                    ("ถ้าเอาสองโล ลดเหลือเท่าไหร่ครับ", "If I take two kilos, how much?"), ("ปัดเศษให้หน่อยนะครับ", "Round it down for me?")),
        "rude": L(("แพงจัง ปล้นกันชัดๆ", "So expensive, daylight robbery"), ("ร้านข้างๆ ถูกกว่าตั้งเยอะ", "Next stall's way cheaper"),
                  ("ห้าสิบ ไม่ขายก็ไม่เอา", "Fifty, take it or leave it"), ("ของเหี่ยวแบบนี้ยังกล้าขาย", "Wilted stuff and you still sell it?")),
        "funny": L(("ป้าครับ ผมหล่อ ลดได้ไหม", "Auntie, I'm handsome — discount?"), ("ลดให้หน่อย เดี๋ยวผมไปขอหวยให้", "Discount and I'll ask the spirits for lottery numbers for you"),
                   ("ผมนอนลังกระดาษอยู่นะป้า", "Auntie, I sleep on cardboard"), ("ลดสิบบาท ผมร้องเพลงให้ฟัง", "Ten off and I'll sing for you"),
                   ("ซื้อป้าแล้วแถมพริกได้ไหม", "Buy from you and get chillies free?"), ("ราคานี้ขอแถมรอยยิ้มป้าด้วย", "At this price, throw in your smile")),
    },
    "auntie_success": L(("เอ้า! เอาไปๆ ป้าใจดี", "Fine! Take it, auntie's kind"), ("แถมกะเพราให้กำนึงนะ", "Here's a free bunch of basil"),
                        ("น่ารักอย่างนี้ ลดให้", "Since you're cute, discount"), ("ครั้งนี้ครั้งเดียวนะ ห้ามบอกใคร", "Just this once, don't tell anyone"),
                        ("หล่ออย่างนี้ เอาไปห้าสิบ", "Handsome like that, fifty"), ("ขายดีนะลูก ซื้อเยอะๆ มาบ่อยๆ", "Sell well, dear — buy lots, come often")),
    "auntie_counter": L(("ไม่ได้หรอก ต่ำสุดเจ็ดสิบ", "Can't, seventy is the lowest"), ("เอางี้ ลดห้าบาทพอ", "Tell you what, five off"),
                        ("ซื้อสองกิโลค่อยลด", "Buy two kilos then I'll discount"), ("ป้าขาดทุนแล้วนะเนี่ย", "Auntie's losing money here")),
    "auntie_fail": L(("ไม่ขาย! ไปซื้อร้านอื่นเลย", "Not selling! Go buy elsewhere"), ("ต่อเก่งนักก็ไปปลูกเองสิ", "If you haggle that well, grow it yourself"),
                     ("หนุ่มสมัยนี้ ไม่รู้จักราคาของ", "Young men these days don't know what things cost"), ("วันนี้ป้าไม่ขายให้แล้ว", "Auntie's not selling to you today"),
                     ("ไปๆ ป้าจะขายของ", "Shoo, auntie needs to sell"), ("อย่ามายืนบังร้าน", "Don't stand blocking my stall")),
}

D["auntie_market_stall"] = L(
    ("มาจ้า มาดูก่อนได้ ผักสดๆ", "Come, come, have a look, fresh veggies"), ("กะเพราใบสวยๆ เพิ่งเด็ดเมื่อเช้า", "Pretty basil, picked this morning"),
    ("พริกขี้หนูสวน เผ็ดจริงไม่จกตา", "Garden chillies, really spicy, no scam"), ("หมูสับบดให้ใหม่ๆ เลยนะ", "I'll mince the pork fresh for you"),
    ("ไข่เป็ด ไข่ไก่ ไข่ใหญ่ ไข่เล็ก มีหมด", "Duck eggs, chicken eggs, big, small, got them all"), ("ลูกสาวป้าโสดนะ สนใจไหม", "My daughter's single, interested?"),
    ("เมื่อวานหนูไปไหนมา ไม่เห็นมาซื้อ", "Where were you yesterday? Didn't see you buy anything"), ("ฝากร้านด้วยนะจ๊ะ", "Please support my stall (ฝากร้าน)"),
    ("เงินทอนไม่มีนะ มีเหรียญไหม", "No change — got coins?"), ("อันนี้ป้าแถม เอาไปผัดให้อร่อยๆ", "This one's free, go make it tasty"),
    ("วันนี้ขายไม่ดีเลย ฝนตก", "Selling badly today, it rained"), ("ระวังหมานะ มันชอบมาขโมยหมู", "Watch out for the dog, it steals pork"),
)

D["old_man_cart"] = {
    "catch": L(("เฮ้ย! ไอ้หนู! จะเข็นไปไหน!", "Hey! Boys! Where are you pushing that!"), ("รถเข็นลุงนะนั่น!", "That's my cart!"),
               ("ตัวโตกันเท่าควาย มาขโมยรถเข็นคนแก่", "Big as buffaloes, stealing an old man's cart"), ("หยุดเลย! ลุงเห็นนะ", "Stop! I saw that")),
    "excuse_options": L(("เปล่าครับลุง แค่... ช่วยเข็นให้", "No uncle, we were just... helping push it"), ("นึกว่าไม่มีเจ้าของครับ", "We thought it had no owner"),
                        ("พวกผมหิวครับลุง", "We're hungry, uncle"), ("ทางลาดครับ มันไหลมาเอง", "It's a slope, it rolled by itself")),
    "offer": L(("ลุงแก่แล้ว ผัดไม่ไหวแล้ว", "I'm old, can't cook anymore"), ("เอางี้ ลุงขายให้ ร้อยบาทพอ", "Tell you what, I'll sell it to you — one hundred baht"),
               ("ร้อยเดียว ได้ทั้งรถเข็น กระทะ แล้วก็สมุดสูตรลับของลุง", "Just a hundred: the cart, the wok and my secret recipe book"),
               ("แต่สัญญานะ ต้องผัดให้อร่อย ห้ามใส่ถั่วฝักยาว", "But promise to cook it well — no long beans")),
    "coins_count": L(("ผมมียี่สิบห้า", "I've got twenty-five"), ("สามสิบ... บวกเหรียญห้าที่เจอในรองเท้า", "Thirty... plus a five I found in my shoe"),
                     ("ยี่สิบ... แล้วก็เหรียญบาทอีกห้าเหรียญ", "Twenty... and five one-baht coins"), ("เหลือยี่สิบพอดี! ครบร้อย!!", "Twenty left — exactly a hundred!!"),
                     ("ร้อยพอดีเป๊ะ! ฟ้าลิขิต!", "Exactly a hundred! It's fate!")),
    "handover": L(("เอ้า รับไป ดูแลมันดีๆ นะ", "Here, take good care of her"), ("สมุดอยู่ในลิ้นชัก อ่านดีๆ ลายมือลุงไม่สวย", "The book's in the drawer — read carefully, my handwriting's bad"),
                  ("ข้าว หมูสับ กะเพรา เครื่องปรุง ลุงทิ้งไว้ให้", "I left you rice, minced pork, basil, seasonings"), ("โชคดีนะไอ้หนู", "Good luck, boys")),
    "dog_steals": L(("เฮ้ย! หมา!!", "Hey! The dog!!"), ("มันกินข้าวกับหมูหมดเลย!", "It ate all the rice and the pork!"),
                    ("ไล่มันไป! เอ้ย ไม่ทันแล้ว", "Chase it! ...too late"), ("ฮ่าๆ หมาตัวนั้นมันขโมยของลุงทุกวัน ไปตลาดป้าเลย", "Haha, that dog robs me every day. Go to auntie's market")),
    "later_visits": L(("ขายดีไหมไอ้หนู", "Selling well, boys?"), ("ไหนลองผัดให้ลุงชิมซิ", "Cook one for me to taste"),
                      ("เค็มไปนิด แต่ใช้ได้", "A bit salty, but not bad"), ("ลุงคิดถูกที่ขายให้พวกแก", "I was right to sell it to you")),
}

D["stray_dog"] = {
    "sounds": ["โฮ่ง!", "โฮ่งๆ!", "งื้ด...", "แฮ่!", "หงิงๆ", "ฮื่ออ..."],
    "thought_bubbles": L(("หมูสับ...", "Minced pork..."), ("ข้าว...", "Rice..."), ("ให้หน่อยดิ", "Gimme some"), ("รักนะ (ถ้ามีหมู)", "Love you (if there's pork)"),
                         ("คนนี้ใจดี", "This one's kind"), ("ขอนอนตรงนี้", "I'm sleeping here")),
    "npc_reactions": L(("หมาใครเนี่ย", "Whose dog is this?"), ("อย่าให้อาหารมันนะ เดี๋ยวมาทุกวัน", "Don't feed it, it'll come every day"),
                       ("น่ารักจัง เจ้าตูบ", "So cute, little doggo"), ("ระวังมันกัดนะ", "Careful, it bites")),
    "player_feed": L(("มาๆ กินนี่", "Here, eat this"), ("เอาไป แต่อย่าขโมยหมูอีกนะ", "Take it, but don't steal pork again"),
                     ("ตั้งชื่อว่าอะไรดี... ไอ้ด่าง", "What should we call you... Spotty"), ("ตามมาสิ ไปอยู่ด้วยกัน", "Come on, live with us")),
    "adopted": L(("ไอ้ด่างเฝ้าร้านให้เฮีย", "Spotty guards the shop for Hia"), ("หมาร้านเฮียผัด ดังกว่าเจ้าของ", "Hia Phat's dog is more famous than the owners")),
}

D["homeless_man"] = {
    "ask": L(("พ่อหนุ่ม มีเศษตังค์ไหม", "Young man, any spare change?"), ("ขอข้าวกินสักมื้อนะ", "Could you spare a meal?"), ("หิวตั้งแต่เมื่อวานแล้ว", "Haven't eaten since yesterday")),
    "thanks": L(("ขอบใจมากนะลูก", "Thank you so much, son"), ("ใจบุญจริงๆ", "Such a generous heart"), ("พระคุณนี้ไม่ลืม", "I won't forget this kindness"),
                ("อร่อยที่สุดในชีวิตเลย", "Best meal of my life"), ("ขอบคุณที่ไม่ไล่", "Thanks for not chasing me away"), ("แจกคนอื่นด้วยนะ ใจดีแบบนี้", "Share with others too, kind like that")),
    "blessings": L(("ขอให้ขายดีเป็นเทน้ำเทท่านะ", "May your shop sell like pouring water"), ("ขอให้ถูกหวย", "May you win the lottery"),
                   ("ขอให้ลูกค้าเต็มร้าน", "May your shop be full of customers"), ("ขอให้รวยๆ เฮงๆ", "May you be rich and lucky"),
                   ("ขอให้หล่อขึ้นทุกวัน", "May you get more handsome every day"), ("ขอให้ผีไม่หลอก", "May ghosts never haunt you")),
    "wisdom": L(("เงินหายได้ แต่กะเพราต้องหอม", "Money can be lost, but the kaprao must be fragrant"),
                ("ชีวิตก็เหมือนไข่ดาว ไฟแรงไปก็ไหม้ ไฟอ่อนไปก็ไม่กรอบ", "Life is like a fried egg: too hot it burns, too low it's never crispy"),
                ("ลุงก็เคยมีรถเบนซ์ ตอนนี้มีลังกระดาษ ลังกระดาษหลับสบายกว่า", "I once had a Benz; now I have cardboard. Cardboard sleeps better"),
                ("อย่าเล่นการพนัน... พวกแกรู้ดีแล้วนี่", "Don't gamble... but you boys already know"),
                ("คนรวยกินข้าวจานละพัน คนจนกินจานละสี่สิบ อิ่มเท่ากัน", "Rich eat thousand-baht plates, poor eat forty-baht ones — equally full"),
                ("หมาจรมันรู้ว่าใครใจดี", "Stray dogs know who's kind"), ("ฝนตกเดี๋ยวก็หยุด หนี้ไม่หยุด", "Rain stops eventually; debt doesn't"),
                ("รีบผัด รีบรวย รีบตาย", "Cook fast, get rich fast, die fast")),
    "refused": L(("ไม่เป็นไรลูก", "It's alright, son"), ("พรุ่งนี้ค่อยว่ากัน", "Maybe tomorrow"), ("เข้าใจๆ ทุกคนก็ลำบาก", "I understand, everyone's struggling")),
}

D["ghosts"] = {
    "motorcycle_ghost": L(("(เสียงเครื่องยนต์บิดลั่นซอย ไม่มีหัว)", "(engine revving down the soi — no head)"), ("...ไปไหน...", "...where to..."),
                          ("ซื้อกะเพรากลับบ้าน... หัวผมอยู่ไหน", "Kaprao to go... where's my head"), ("ใส่หมวกกันน็อกด้วยนะ", "Wear a helmet, OK?")),
    "krasue": L(("หิว... อยากกินของคาว", "Hungry... craving something raw"), ("ไส้ฉันลอยได้ ไม่ต้องห่วง", "My guts float, don't worry about them"),
                ("ไข่ดาวไม่สุกมีไหม", "Got a runny fried egg?"), ("ปิดไฟทำไม ฉันเรืองแสงเองได้", "Why turn off the light, I glow by myself")),
    "phi_pop": L(("กลิ่นตับหอมจัง...", "Liver smells so good..."), ("อยู่ในร่างยายข้างบ้านนะ อย่าบอกใคร", "I'm in the old lady next door, don't tell"),
                 ("ขอกินดิบๆ ไม่ต้องผัด", "Raw please, no need to cook")),
    "nang_tani": L(("ใต้ต้นกล้วยนี่บ้านฉัน", "Under this banana tree is my home"), ("ขอข้าวต้มมัดสักห่อ", "A sticky-rice banana parcel, please"),
                   ("อย่าตัดต้นกล้วยนะ", "Don't cut down the banana tree"), ("เลขเด็ดเหรอ... ลองดูที่ลำต้นสิ", "Lucky numbers? Look at the trunk...")),
    "pret": L(("หิว... หิว...", "Hungry... hungry..."), ("ปากฉันเท่ารูเข็ม กินไม่ได้", "My mouth is a pinhole, I can't eat"),
              ("ช่วยกรวดน้ำให้หน่อย", "Please pour water for merit for me"), ("สูงสามเมตร หิวสามพันปี", "Three metres tall, hungry for three thousand years")),
    "phi_tai_hong": L(("ซอยนี้... ฉันตายตรงนี้...", "This soi... I died right here..."), ("ขับช้าๆ นะ", "Drive slowly")),
    "player_reactions": L(("ผีีีี!!", "GHOOOST!!"), ("วิ่ง!!", "RUN!!"), ("พระช่วยด้วย!", "Somebody help!"), ("ไม่กลัวๆ... กลัวสุดๆ", "Not scared... SO scared"),
                          ("เอ็งอยู่ข้างหลังข้าใช่ไหม", "You're right behind me, aren't you?")),
}

D["girl_scream"] = L(
    ("ว้ายยย! โรคจิต!!", "Eeek! Pervert!!"), ("กรี๊ดดด! ใส่เสื้อหน่อย!", "Aaah! Put some clothes on!"),
    ("แม่จ๋า! มีคนยืนกางแขนกลางถนน!", "Mum! There's a guy standing in the road with his arms out!"),
    ("อี๋! ยืนทำอะไรน่ะ!", "Ew! What are you doing!"), ("ตำรวจ! ตำรวจ!", "Police! Police!"), ("เดี๋ยวโพสต์ลงกลุ่มหมู่บ้านเลย!", "I'm posting you in the village group!"),
)

D["friends_banter"] = {
    "slap": L(("ตื่น!", "Wake up!"), ("ตั้งสติ!", "Get it together!"), ("อันนี้ค่าที่ทำไข่ไหม้", "That's for burning the egg"),
              ("ตบเบาๆ ด้วยความรัก", "A gentle slap with love"), ("ฝันอะไรอยู่!", "What are you daydreaming!"), ("เพียะ!", "SLAP!")),
    "slapped": L(("โอ๊ย! อะไรของมึง", "Ow! What's your problem"), ("เดี๋ยวเหอะ!", "Just you wait!"), ("ตบหน้าหล่อๆ ของกูทำไม", "Why slap my handsome face"),
                 ("เจ็บนะเว้ย", "That hurt, man"), ("แก้แค้นแน่", "I'll get revenge")),
    "high_five": L(("เยส!", "Yes!"), ("ทีมเวิร์ค!", "Teamwork!"), ("แปะ!", "Slap (high five)!"), ("เก่งมากเพื่อน", "Nice one, buddy"), ("ตึงๆ!", "Hardcore! (ตึง)")),
    "snatch": L(("ขอยืมนะ", "Borrowing this"), ("ของกู!", "Mine!"), ("ช้าไป!", "Too slow!"), ("อ่านจบแล้ว ส่งมา", "You're done reading, hand it over")),
    "snatched": L(("เฮ้ย! คืนมา!", "Hey! Give it back!"), ("กูอ่านอยู่!", "I was reading that!"), ("มาแย่งกันเลยมา!", "Come on then, fight me for it!")),
    "tug_win": L(("ของกูแล้ว!", "It's mine now!"), ("แรงช้างสาร!", "Strength of an elephant!"), ("อ่อนแอก็แพ้ไป", "The weak lose")),
    "tug_lose": L(("มือลื่น!", "My hand slipped!"), ("ปล่อยให้ชนะหรอก", "I let you win"), ("กินข้าวน้อยไป", "Didn't eat enough rice")),
    "give_money": L(("เอาไป ไปซื้อไข่", "Here, go buy eggs"), ("ยืมก่อน เดี๋ยวคืน... มั้ง", "A loan... I'll pay back... maybe"), ("นี่ค่าแรงวันนี้", "Today's wages")),
    "receive_money": L(("ขอบใจเพื่อน!", "Thanks, buddy!"), ("รวยแล้วโว้ย!", "I'm rich, baby!"), ("แค่นี้เองเหรอ", "That's it?")),
    "idle": L(("หิวว่ะ", "I'm hungry"), ("ร้อนชิบ", "Damn it's hot"), ("คิดถึงบ่อน... ไม่! ไม่คิดถึง!", "Miss the casino... no! I don't!"),
              ("วันนี้ขายได้เท่าไหร่", "How much did we make today?"), ("ใครล้างจาน", "Who's washing dishes?"), ("ไม่ใช่กู", "Not me"),
              ("อิหยังวะ", "What the heck"), ("555555", "hahahahaha (5 = ha)")),
}

D["sleeping_on_cardboard"] = L(
    ("เที่ยงคืนแล้ว... หาลังกระดาษ", "Midnight... find some cardboard"), ("ลังนี้ของกู ลังมาม่า นุ่มสุด", "This box is mine, the noodle box is the softest"),
    ("ยุงเยอะชิบ", "So many mosquitoes"), ("ฝันดีนะเพื่อน", "Sweet dreams, buddy"), ("พรุ่งนี้ต้องขายให้ได้สองพัน", "Tomorrow we sell two thousand"),
    ("ใครกรน!", "Who's snoring!"), ("เมื่อก่อนนอนโรงแรมห้าดาว", "We used to sleep in five-star hotels"), ("หมาจรมานอนด้วย อุ่นดี", "The stray dog's sleeping with us — warm"),
    ("ได้ยินเสียงมอไซค์ไหม... ไม่มีหัวด้วย", "Hear that motorbike?... it has no head"), ("ลังเปียก ฝนตก ชีวิต", "Wet box, rain, life"),
)

D["skill_tree_thoughts"] = L(
    ("ถ้าผัดเร็วขึ้น... จะรวยไหมนะ", "If I cook faster... will I get rich?"), ("ล้างจานด้วยใจ... ใจก็สะอาด", "Wash dishes with heart... the heart gets clean"),
    ("หั่นกระเทียมเร็วๆ นิ้วยังครบไหมนะ", "Chop garlic fast... do I still have all my fingers?"), ("ถ้ามีแขนสี่แขน จะผัดได้สองกระทะ", "With four arms I could work two woks"),
    ("ไข่ดาวลอยอยู่ในอวกาศ...", "Fried eggs floating in space..."), ("กะเพรา คือ ชีวิต", "Kaprao. Is. Life."), ("เสิร์ฟเร็ว = ทิปเยอะ = ไข่เยอะ", "Serve fast = more tips = more eggs"),
    ("ถ้าตะหลิวพูดได้ มันจะพูดว่าอะไร", "If the spatula could talk, what would it say?"), ("อัปสกิลนี้แล้ว... เท่ขึ้นไหม", "If I upgrade this... will I look cooler?"),
    ("กระทะร้อน ใจเย็น", "Hot wok, cool heart"), ("ลืมไปแล้วว่ามาคิดอะไร", "Forgot what I came here to think about"),
    ("สกิลนอนลังกระดาษ มีไหม", "Is there a sleeping-on-cardboard skill?"), ("ล้างจาน... หรือจานล้างเรา", "Do I wash the dishes... or do the dishes wash me?"),
    ("ทำไมไข่ดาวกลม... ทำไมโลกกลม", "Why is a fried egg round... why is the world round"),
)

D["newspaper_headlines"] = [dict(mood=h["mood"], th=h["th"], en=h["en"]) for h in C.HEADLINES]

D["shop_names"] = L(("เฮียผัด", "Hia Phat (Big Bro Stir-fry)"), ("กะเพราสี่สหาย", "Four Friends Kaprao"), ("ตามสั่งหมดตัว", "Broke Made-to-Order"),
                    ("ร้อยบาทสร้างตัว", "100-Baht Comeback"), ("กะเพราลังกระดาษ", "Cardboard Kaprao"), ("ไข่ดาวไม่สุก", "Runny Egg"),
                    ("เฮียผัด สาขาซอยเก้า", "Hia Phat, Soi 9 branch"), ("ครัวคนเคยรวย", "Kitchen of the Formerly Rich"),
                    ("ผัดไปบ่นไป", "Stir and Grumble"), ("ตามสั่งตามใจ", "Order As You Like"))

D["convenience_store_clerk"] = {
    "door_chime": "ติ๊งต่อง (two-tone door chime, plays on enter/exit)",
    "greet": L(("สวัสดีค่ะ ยินดีต้อนรับค่ะ", "Hello, welcome!"), ("สวัสดีครับ ยินดีต้อนรับครับ", "Hello, welcome! (male)")),
    "upsell": L(("รับขนมจีบซาลาเปาเพิ่มไหมคะ", "Would you like dumplings or buns?"), ("ไส้กรอกชิ้นที่สองลดครึ่งราคานะคะ", "Second sausage half price"),
                ("สะสมแสตมป์ไหมคะ", "Collect stamps?"), ("อุ่นไหมคะ", "Shall I heat it?"), ("รับถุงไหมคะ", "Need a bag?")),
    "checkout": L(("ทั้งหมด {total} บาทค่ะ", "That's {total} baht"), ("รับเงิน {money} บาท ทอน {change} บาทค่ะ", "Received {money}, your change is {change}"),
                  ("มีบัตรสมาชิกไหมคะ", "Do you have a member card?"), ("สแกนจ่ายได้ค่ะ", "You can scan to pay")),
    "bye": L(("ขอบคุณค่ะ", "Thank you"), ("ขอบคุณครับ แล้วแวะมาใหม่นะครับ", "Thanks, come again")),
}

D["motorbike_taxi"] = {
    "call": L(("ไปไหนครับ", "Where to?"), ("ซ้อนไหมพี่", "Need a ride?"), ("วินครับวิน", "Motorbike taxi!")),
    "price": L(("ปากซอยยี่สิบ", "Soi entrance, twenty"), ("ตลาดสี่สิบ", "Market, forty"), ("ไกลนะนั่น ห้าสิบ", "That's far, fifty")),
    "ride": L(("จับแน่นๆ นะ", "Hold on tight"), ("หมวกไม่มี ไม่เป็นไรใกล้ๆ", "No helmet, it's fine, it's close"), ("ทางลัดครับ", "Shortcut!"),
              ("รถติดอีกแล้ว ฝนตกทีไรติดทุกที", "Traffic again — every time it rains")),
}

D["songthaew"] = L(("ไปไหน", "Where you going?"), ("ขึ้นเลยๆ ทางเดียวกัน", "Hop on, same way"), ("สิบบาทตลอดสาย", "Ten baht the whole route"), ("กดกริ่งด้วยนะ", "Press the buzzer"))

D["monk"] = {
    "note": "Respectful only. No slapping/snatching on monks (interaction disabled). Players should bow (ไหว้) and offer food in the morning; women do not hand items directly to a monk.",
    "player_offer": L(("นิมนต์ครับหลวงพี่", "Please, venerable brother (inviting to receive alms)"), ("ขอถวายกะเพราครับ", "May I offer this kaprao"),
                      ("กราบนมัสการครับ", "I pay my respects")),
    "monk_lines": L(("เจริญพร", "Blessings (monk's polite greeting/thanks)"), ("ขอให้เจริญในธรรม", "May you prosper in the dhamma"),
                    ("อายุ วัณโณ สุขัง พะลัง", "Long life, beauty, happiness, strength (standard short blessing)"), ("ทำงานสุจริตนะโยม", "Work honestly, layman"),
                    ("ขายดีๆ นะโยม อย่าลืมแบ่งปัน", "May your shop do well; remember to share"), ("อาตมาฉันเพลแล้ว ขอบใจโยม", "I've already had my meal, thank you")),
}

D["loudspeaker_vendors"] = {
    "junk_buyer_truck": L(("รับซื้อ ทีวีเก่า ตู้เย็นเก่า แอร์เก่า เครื่องซักผ้าเก่า", "Buying old TVs, old fridges, old ACs, old washing machines"),
                          ("ขายได้ค่ะ ของเก่า เสียแล้ว พังแล้ว ขายได้", "Sell them! Old, broken, busted — we buy")),
    "ice_cream_cart": "กริ๊งๆๆ (hand bell) + 'ไอติมจ้า ไอติมกะทิ'",
    "lottery_seller": L(("หวยจ้า หวย เลขสวยๆ", "Lottery, lottery, pretty numbers"), ("งวดนี้เลขเด็ด เหลือใบสุดท้าย", "Hot numbers this draw, last ticket")),
    "fruit_pickup": L(("มะม่วงจ้า มะม่วง สามกิโลร้อย", "Mangoes, three kilos a hundred"),),
}

D["ambient_chatter"] = {
    "morning": L(("ตักบาตรเสร็จยัง", "Done giving alms?"), ("กาแฟโบราณแก้วนึง", "One old-style coffee"), ("รถติดตั้งแต่หกโมง", "Traffic since six"),
                 ("สวัสดีวันจันทร์จ้า (ป้าส่งรูปดอกไม้ในไลน์)", "Happy Monday! (auntie sends flower pics on LINE)"), ("ไปทำงานสายอีกแล้ว", "Late for work again")),
    "noon": L(("เที่ยงนี้กินอะไรดี", "What's for lunch?"), ("อะไรก็ได้", "Whatever"), ("ร้อนจะตายอยู่แล้ว", "So hot I'm dying"), ("คิวยาวจัง", "Such a long queue"),
              ("ทักแชทมาได้เลยค่ะ ราคาเป็นกันเอง", "DM us, friendly prices! (online seller)")),
    "afternoon": L(("ฝนจะตกแล้ว เก็บผ้า!", "Rain's coming, bring in the laundry!"), ("รถติดเพราะฝนตก", "Traffic because of the rain"),
                   ("ไลฟ์สดขายของ CF ได้เลยค่ะ", "Live-selling — comment CF to buy!"), ("เด็กนักเรียนเลิกแล้ว", "School's out")),
    "evening": L(("ตลาดนัดเปิดแล้ว", "Night market's open"), ("ส้มตำครกนึง ปูปลาร้า", "One som tam with pickled crab"), ("เล่นบอลกันไหม", "Football, anyone?"),
                 ("ไปกินหมูกระทะกัน", "Let's go eat moo kratha")),
    "night": L(("ดึกแล้ว กลับบ้านเถอะ", "It's late, go home"), ("ได้ยินเสียงอะไรไหม", "Did you hear something?"), ("เซเว่น... เอ้ย 8-Twelve ยังเปิดอยู่", "Seven... I mean 8-Twelve is still open"),
               ("หมาหอนอีกแล้ว", "The dogs are howling again")),
    "late_night": L(("ซอยนี้ผีดุนะ", "Ghosts in this soi are fierce"), ("อย่าเหลียวหลัง", "Don't look back"), ("ใครมาซื้อกะเพราตอนตีสอง", "Who buys kaprao at 2 a.m.?")),
}

D["memes_and_slang_quick"] = L(
    ("555", "lol (5 = ha)"), ("ตึงๆ", "hardcore / intense"), ("อิหยังวะ", "what the heck (Isan)"), ("ชีเสิร์ฟ", "she serves / slays (2025)"),
    ("ฉ่ำ", "a lot / very (2023)"), ("เกิดแต่กับกู", "why does this only happen to me (2025)"), ("จึ้ง", "wow, stunning"), ("เกือบตุย", "almost died"),
    ("ปังมาก", "awesome"), ("นอยด์", "paranoid / upset"), ("เท", "to ghost / dump someone"), ("ตัวตึง", "the hardcore one / big shot"),
)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(D, f, ensure_ascii=False, indent=1)


def count(o):
    if isinstance(o, list):
        return len(o)
    if isinstance(o, dict):
        return sum(count(v) for v in o.values())
    return 0


print("keys", len(D), "lines", count(D), "mad situations", len(D["mad_system_choices"]), "headlines", len(D["newspaper_headlines"]))
