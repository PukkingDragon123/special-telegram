"""Build game-ready label textures from real product photos (client rule change 2026-10-19).
Usage: python3 -I process_labels.py [name ...]
Config: JOBS entries; coordinates are normalised (0..1) to the source image.
"""
import json
import os
import sys

sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import numpy as np  # noqa: E402

import flatten as FL  # noqa: E402

RAW = "/home/user/special-telegram/references/food/_raw/realprod"
OUT = "/home/user/special-telegram/public/assets/img/labels"

# method: cyl (y0,y1[,xl,xr,max_deg,top_curve]) | persp (pts TL,TR,BR,BL + out aspect w/h) | crop (x0,y0,x1,y1)
JOBS = {}


def job(name, src, method, product, brand, package, dims, cap="", out_w=1024, **kw):
    JOBS[name] = dict(name=name, src=src, method=method, product=product, brand=brand, package=package,
                      real_dims_cm=dims, cap=cap, out_w=out_w, **kw)


# ---------------------------------------------------------------------------- sauces
job("seasoning_sauce_golden_mountain", "gm_sauce/gm_sauce_02.jpg", "cyl", "ซอสปรุงรส ฝาเขียว (seasoning sauce)",
    "ภูเขาทอง Golden Mountain", "glass bottle (200-600 ml); main body label, front ~140° unwrapped",
    {"bottle_h": 24.5, "bottle_d": 7.2, "label_h": 9.0}, cap="green plastic cap (#1f8a3c)",
    y0=0.475, y1=0.865, max_deg=76, top_curve=0.0, worn=True)

job("fish_sauce_tiparos", "tiparos/tiparos_08.jpg", "cyl", "น้ำปลาแท้ (fish sauce)", "ทิพรส Tiparos",
    "PET bottle 700 ml; front label unwrapped", {"bottle_h": 29.0, "bottle_d": 7.5, "label_h": 8.5},
    cap="white plastic cap", y0=0.495, y1=0.742, xl=0.345, xr=0.655, max_deg=74, worn=True)

job("fish_sauce_squid", "squid_fishsauce/squid_fishsauce_08.jpg", "cyl", "น้ำปลาแท้ (fish sauce)",
    "ตราปลาหมึก Squid Brand", "glass bottle 725 ml; front label unwrapped",
    {"bottle_h": 28.0, "bottle_d": 7.6, "label_h": 9.5}, cap="green plastic cap", y0=0.56, y1=0.875, max_deg=68)

job("oyster_sauce_maekrua", "maekrua/maekrua_06.jpg", "cyl", "ซอสหอยนางรม (oyster sauce)", "แม่ครัว Maekrua",
    "glass bottle 600 cc; main label unwrapped (neck foil label not included)",
    {"bottle_h": 25.5, "bottle_d": 7.6, "label_h": 10.0}, cap="red cap + gold neck foil",
    y0=0.575, y1=0.915, max_deg=66, worn=True)


job("light_soy_healthy_boy", "hb_lightsoy/hb_lightsoy_03.jpg", "cyl", "ซีอิ๊วขาว สูตร 1 (thin soy sauce)",
    "เด็กสมบูรณ์ Healthy Boy / Dek Som Boon", "glass bottle 700 ml; front label unwrapped from a close-up",
    {"bottle_h": 27.0, "bottle_d": 7.0, "label_h": 11.0}, cap="yellow cap / plastic sleeve",
    y0=0.195, y1=0.905, cx_n=0.325, r_n=0.292, max_deg=68, worn=True)

job("dark_soy_healthy_boy", "hb_darksoy/hb_darksoy_03.jpg", "cyl", "ซีอิ๊วดำหวาน (sweet dark soy sauce)",
    "เด็กสมบูรณ์ Healthy Boy", "PET/glass bottle 970 g; green front label unwrapped",
    {"bottle_h": 26.0, "bottle_d": 7.6, "label_h": 9.0}, cap="white/red cap", y0=0.615, y1=0.92,
    cx_n=0.473, r_n=0.157, max_deg=66, worn=True)

job("sugar_mitr_phol_1kg", "mitrphol/mitrphol_04.jpg", "crop", "น้ำตาลทรายขาว 1 กก. (refined sugar bag)",
    "มิตรผล Mitr Phol", "PE pillow bag 1 kg, front face", {"bag_w": 16.0, "bag_h": 26.0}, cap="heat-sealed",
    box=(0.567, 0.198, 0.905, 0.905), deshade=0, worn=True)

job("msg_ajinomoto_500g", "ajinomoto/ajinomoto_01.jpg", "crop", "ผงชูรส 500 ก. (MSG pouch)",
    "อายิโนะโมะโต๊ะ ตราถ้วยแดง Ajinomoto", "printed PE pouch 500 g, front face",
    {"bag_w": 17.0, "bag_h": 20.0}, cap="heat-sealed", box=(0.105, 0.065, 0.915, 0.935), deshade=0, worn=True)

job("white_pepper_hand_brand_jar", "hand_pepper/hand_pepper_05.jpg", "cyl", "พริกไทยขาวป่น (ground white pepper)",
    "ตรามือที่ 1 Hand Brand (Nguan Soon)", "glass/PET shaker jar; label sleeve unwrapped",
    {"jar_h": 13.0, "jar_d": 5.5, "label_h": 5.8}, cap="green shaker cap", y0=0.27, y1=0.565, max_deg=70,
    worn=True)

job("white_pepper_hand_brand_tin", "hand_pepper/hand_pepper_01.jpg", "cyl", "พริกไทยขาวป่น กระป๋อง (pepper tin)",
    "ตรามือที่ 1 Hand Brand", "tin can 20 g/50 g, printed body unwrapped", {"tin_h": 9.5, "tin_d": 4.8},
    cap="red plastic cap", y0=0.165, y1=0.865, max_deg=70)

job("chili_powder_hand_brand", "chili_powder/chili_powder_02.jpg", "cyl", "พริกขี้หนูป่น (ground chili)",
    "ตรามือที่ 1 Hand Brand", "glass shaker jar; red label sleeve unwrapped", {"jar_h": 11.5, "jar_d": 5.5},
    cap="red cap", y0=0.40, y1=0.83, max_deg=68)


job("palm_oil_morakot_1l", "palm_oil/palm_oil_01.jpg", "cyl", "น้ำมันปาล์ม 1 ลิตร (palm cooking oil)",
    "มรกต Morakot", "PET bottle 1 L; green front label unwrapped", {"bottle_h": 30.0, "bottle_d": 8.4,
                                                                    "label_h": 10.5},
    cap="green plastic cap", y0=0.545, y1=0.858, cx_n=0.50, r_n=0.123, max_deg=66, worn=True)

job("vinegar_osor", "vinegar/vinegar_06.jpg", "cyl", "น้ำส้มสายชูกลั่น 5% (distilled vinegar)", "อสร. (OSOR)",
    "PET bottle 250-750 ml; front label unwrapped (low-res source)", {"bottle_h": 23.0, "bottle_d": 6.5,
                                                                      "label_h": 7.0},
    cap="white cap", y0=0.455, y1=0.735, cx_n=0.505, r_n=0.095, max_deg=64)

job("eggs_cp_pack_label", "eggs/eggs_04.jpg", "crop", "ไข่ไก่สด (eggs pack sleeve/label)", "ซีพี CP Selection",
    "printed paper sleeve on a 6/10-egg pulp tray (use as tray band / top label)", {"label_w": 14.0, "label_h": 20.0},
    cap="n/a", box=(0.195, 0.13, 0.75, 0.875), deshade=0)

job("rice_5kg_tra_chat", "rice5/rice5_02.jpg", "crop", "ข้าวหอม 100% 5 กก. (jasmine rice bag)", "ตราฉัตร Royal Umbrella",
    "PE rice bag 5 kg, front face", {"bag_w": 30.0, "bag_h": 45.0}, cap="heat-sealed",
    box=(0.19, 0.06, 0.815, 0.945), deshade=0, worn=True)

job("rice_5kg_hong_thong", "rice5/rice5_01.jpg", "crop", "ข้าวหอมมะลิ 5 กก. (jasmine rice bag)", "หงษ์ทอง Golden Phoenix",
    "PE rice bag 5 kg, front face", {"bag_w": 30.0, "bag_h": 45.0}, cap="heat-sealed",
    box=(0.255, 0.10, 0.745, 0.905), deshade=0)

job("rice_15kg_sack_surin", "rice15/rice15_03.jpg", "crop", "ข้าวขาวหอมมะลิ 15 กก. (woven PP rice sack)",
    "สกต. สุรินทร์ (green elephant print)", "woven polypropylene sack 15 kg, printed front (photo crop)",
    {"sack_w": 50.0, "sack_h": 80.0}, cap="sewn top", box=(0.465, 0.13, 0.935, 0.785), deshade=0)


job("lpg_cylinder_world_gas", "lpg/lpg_01.jpg", "cyl", "ก๊าซหุงต้ม LPG 15 กก. (cylinder body print)", "เวิลด์แก๊ส World Gas",
    "steel LPG cylinder 15 kg; painted body band unwrapped (logo centred)", {"cylinder_h": 59.0, "cylinder_d": 30.0},
    cap="brass valve + regulator", y0=0.33, y1=0.775, cx_n=0.305, r_n=0.170, max_deg=70, deshade=0.5)

job("water_crystal_600ml", "water/water_02.jpg", "cyl", "น้ำดื่ม (drinking water)", "คริสตัล Crystal",
    "PET bottle 600 ml-1.5 L; film label unwrapped", {"bottle_h": 22.0, "bottle_d": 6.5, "label_h": 5.5},
    cap="light-blue cap", y0=0.385, y1=0.575, cx_n=0.197, r_n=0.106, max_deg=68, deshade=0.4, wb=False)

job("cola_coke_can_325", "coke/coke_02.jpg", "cyl", "โค้ก รสชาติออริจินัล (cola can)", "Coca-Cola โค้ก",
    "aluminium can 325 ml; printed body unwrapped", {"can_h": 11.5, "can_d": 6.6}, cap="pull-tab top",
    y0=0.135, y1=0.83, max_deg=70, deshade=0.5)

job("soda_fanta_orange_can", "fanta_orange/fanta_orange_06.jpg", "cyl", "แฟนต้า กลิ่นส้ม (orange soda can)",
    "Fanta แฟนต้า", "aluminium can 325 ml; printed body unwrapped", {"can_h": 11.5, "can_d": 6.6},
    cap="pull-tab top", y0=0.085, y1=0.905, max_deg=70, deshade=0.5)

job("soda_fanta_red_bottle", "fanta_red/fanta_red_05.jpg", "cyl", "แฟนต้า น้ำแดง กลิ่นสตรอเบอร์รี่ (red soda)",
    "Fanta แฟนต้า", "PET bottle 1.25-1.95 L; label unwrapped", {"bottle_h": 32.0, "bottle_d": 9.5, "label_h": 9.0},
    cap="blue cap", y0=0.335, y1=0.52, max_deg=68, deshade=0.4)

job("soda_fanta_green_can", "fanta_green/fanta_green_06.jpg", "cyl", "แฟนต้า น้ำเขียว (green cream soda can)",
    "Fanta แฟนต้า", "aluminium can 325 ml; printed body unwrapped", {"can_h": 11.5, "can_d": 6.6},
    cap="pull-tab top", y0=0.135, y1=0.935, cx_n=0.52, r_n=0.242, max_deg=70, deshade=0.5)

job("energy_krating_daeng", "kratingdaeng/kratingdaeng_06.jpg", "cyl", "เครื่องดื่มชูกำลัง (energy drink)",
    "กระทิงแดง Krating Daeng", "brown glass bottle 150 ml; label unwrapped", {"bottle_h": 12.5, "bottle_d": 5.2,
                                                                              "label_h": 5.5},
    cap="red/gold metal cap", y0=0.37, y1=0.722, max_deg=70, deshade=0.4)


job("energy_m150", "m150/m150_05.jpg", "cyl", "เครื่องดื่มชูกำลัง (energy drink)", "เอ็ม-150 M-150",
    "brown glass bottle 150 ml; label unwrapped", {"bottle_h": 12.5, "bottle_d": 5.2, "label_h": 6.0},
    cap="gold metal screw cap", y0=0.39, y1=0.805, max_deg=70, deshade=0.4)

job("instant_noodle_mama_cup", "mama_cup/mama_cup_01.jpg", "frustum", "บะหมี่กึ่งสำเร็จรูป คัพ (instant noodle cup)",
    "มาม่า MAMA Cup (Shrimp Creamy Tom Yum)", "paper/PS cup 60 g, conical; side print unwrapped (approx.)",
    {"cup_h": 10.0, "top_d": 9.5, "bottom_d": 6.5}, cap="foil lid", y0=0.115, y1=0.955, max_deg=66, deshade=0.35)

job("beer_chang_can", "chang_can/chang_can_03.jpg", "cyl", "เบียร์ (beer can)", "ช้าง Chang Classic",
    "aluminium can 320-490 ml; printed body unwrapped", {"can_h": 12.2, "can_d": 6.6}, cap="pull-tab top",
    y0=0.36, y1=0.905, cx_n=0.358, r_n=0.162, max_deg=70, deshade=0.4)

job("beer_singha_bottle", "singha_bottle/singha_bottle_06.jpg", "cyl", "เบียร์ (beer bottle label)",
    "สิงห์ Singha", "brown glass bottle 620 ml; body label unwrapped (neck label not included)",
    {"bottle_h": 28.5, "bottle_d": 7.4, "label_h": 9.0}, cap="gold crown cap", y0=0.495, y1=0.79,
    max_deg=68, deshade=0.4)

job("whisky_sangsom", "sangsom/sangsom_03.jpg", "cyl", "สุรา (Thai rum) front label", "แสงโสม SangSom",
    "glass bottle 700 ml; front label unwrapped", {"bottle_h": 28.0, "bottle_d": 8.5, "label_h": 9.5},
    cap="gold metal screw cap", y0=0.468, y1=0.792, max_deg=60, deshade=0.4)

job("ice_bag_siri_mit_tube_ice", "ice_bag/ice_bag_08.jpg", "crop", "น้ำแข็งหลอด (tube ice bag)", "ศิริมิตร Sirimit",
    "clear PE ice bag (print on clear film) 1.4-20 kg; front face crop", {"bag_w": 30.0, "bag_h": 45.0},
    cap="tied/heat-sealed", box=(0.10, 0.02, 0.86, 0.985), deshade=0, wb=False)

job("chayen_chatramue_cup_logo", "chatramue/chatramue_04.jpg", "crop", "โลโก้แก้วชาเย็น (Thai tea cup logo)",
    "ชาตรามือ ChaTraMue", "printed logo on clear PP cup (crop incl. tea behind)", {"logo_w": 7.0, "logo_h": 5.0},
    cap="dome/sealed lid", box=(0.385, 0.565, 0.615, 0.735), deshade=0, wb=False, out_w=512)


job("pork_tray_cp_top", "pork_tray/pork_tray_02.jpg", "crop", "หมูสดปลอดสาร ถาด (pork tray top film incl. meat window)",
    "ซีพี CP Selection", "PS foam/PET tray with printed top film; whole top face", {"tray_w": 22.0, "tray_h": 16.0},
    cap="cling film", box=(0.07, 0.165, 0.935, 0.815), deshade=0, wb=False)

job("pork_tray_cp_price_sticker", "pork_tray/pork_tray_02.jpg", "crop", "สติ๊กเกอร์ราคา/น้ำหนัก ถาดหมู (scale label)",
    "ซีพี CP", "paper scale sticker on tray film", {"sticker_w": 6.0, "sticker_h": 4.5}, cap="n/a",
    box=(0.745, 0.555, 0.93, 0.81), deshade=0, wb=False, out_w=512)

job("pork_tray_cheeva_sleeve", "pork_tray/pork_tray_01.jpg", "crop", "ปลอกฉลากถาดหมู (pork tray sleeve)",
    "หมูชีวา CHEEVA", "paper sleeve around foam tray", {"sleeve_w": 7.0, "sleeve_h": 16.0}, cap="n/a",
    box=(0.13, 0.19, 0.395, 0.815), deshade=0, wb=False, out_w=512)

job("basil_pack_sleeve", "basil_pack/basil_pack_05.jpg", "crop", "ใบกะเพรา แพ็ค (packaged holy basil sleeve)",
    "We Fresh ผักสดปลอดภัย", "printed PP sleeve with basil inside (supermarket pack)", {"pack_w": 10.0, "pack_h": 28.0},
    cap="n/a", box=(0.355, 0.095, 0.655, 0.905), deshade=0, wb=False, out_w=512)

job("carton_mama_face", "mama_carton/mama_carton_07.jpg", "persp", "ลังมาม่า หน้ากล่อง (Mama carton face)",
    "มาม่า MAMA (ต้มยำกุ้งน้ำข้น 30 ซอง)", "corrugated carton face, perspective-flattened (for cardboard props)",
    {"face_w": 37.0, "face_h": 40.0}, cap="n/a", pts=[(0.065, 0.075), (0.795, 0.02), (0.825, 0.862), (0.025, 0.885)],
    aspect=0.92, px_w=1100, deshade=0, wb=False)

job("carton_chang_3pack", "chang_carton/chang_carton_01.jpg", "crop", "แพ็คเบียร์ช้าง 3 ขวด (printed paperboard carrier)",
    "ช้าง Chang Classic", "printed paperboard bottle carrier front", {"face_w": 23.0, "face_h": 14.0}, cap="n/a",
    box=(0.025, 0.415, 0.975, 0.975), deshade=0)


job("beer_leo_bottle", "leo_bottle2/leo_bottle2_02.jpg", "cyl", "เบียร์ (beer bottle body label)", "ลีโอ LEO",
    "brown glass bottle 620 ml; oval body label unwrapped (neck label not included)",
    {"bottle_h": 28.5, "bottle_d": 7.4, "label_h": 8.5}, cap="gold crown cap", y0=0.545, y1=0.845,
    max_deg=66, deshade=0.4)

job("beer_leo_can", "leo_can/leo_can_01.jpg", "cyl", "เบียร์ กระป๋อง (beer can)", "ลีโอ LEO",
    "aluminium can 490 ml; printed body unwrapped", {"can_h": 16.8, "can_d": 6.6}, cap="pull-tab top",
    y0=0.07, y1=0.93, max_deg=70, deshade=0.35)

job("beer_chang_bottle", "chang_bottle/chang_bottle_04.jpg", "cyl", "เบียร์ (beer bottle body label)",
    "ช้าง Chang Classic", "green glass bottle 620 ml; body label unwrapped (neck foil not included)",
    {"bottle_h": 28.5, "bottle_d": 7.4, "label_h": 9.0}, cap="green/gold crown cap", y0=0.515, y1=0.80,
    max_deg=66, deshade=0.4)

job("soybean_oil_angoon_1l", "angoon_oil/angoon_oil_04.jpg", "cyl", "น้ำมันถั่วเหลือง 1 ลิตร (soybean cooking oil)",
    "องุ่น Angoon", "PET bottle 1 L; front label unwrapped", {"bottle_h": 30.0, "bottle_d": 8.4, "label_h": 10.0},
    cap="yellow cap", y0=0.585, y1=0.885, cx_n=0.50, r_n=0.095, max_deg=64, deshade=0.4, worn=True,
    worn_kw={"base_col": (170, 130, 40)})


job("red_curry_paste_mae_ploy", "curry_paste/curry_paste_07.jpg", "frustum_x", "น้ำพริกแกงเผ็ด (red curry paste) พริกแกง",
    "แม่พลอย Mae Ploy", "PP tub 400 g-1 kg, tapered; printed body unwrapped", {"tub_h": 11.0, "tub_d_top": 11.5,
                                                                                    "tub_d_bottom": 10.0},
    cap="white snap lid", y0=0.14, y1=0.955, l0=0.025, r0=0.955, l1=0.065, r1=0.915, max_deg=62, deshade=0.4)

job("chili_paste_mae_pranom", "chili_paste/chili_paste_07.jpg", "cyl", "น้ำพริกเผา (roasted chili paste in oil)",
    "แม่ประนอม Maepranom", "glass jar 228 g; label unwrapped", {"jar_h": 10.5, "jar_d": 7.0, "label_h": 4.5},
    cap="blue metal lid", y0=0.335, y1=0.745, max_deg=66, deshade=0.4)

job("tapioca_starch_fish_brand", "tapioca/tapioca_05.jpg", "crop", "แป้งท้าว / แป้งมัน (tapioca flour / starch for gravy thickening)",
    "ปลาไทย Fish brand", "PE bag 400-500 g, front face", {"bag_w": 13.0, "bag_h": 20.0}, cap="heat-sealed",
    box=(0.30, 0.17, 0.735, 0.83), deshade=0)

job("noodle_sen_yai_pack", "../foodtex/noodle_raw_wide/noodle_raw_wide_02.jpg", "crop",
    "ก๋วยเตี๋ยวเส้นใหญ่ชนิดแผ่น (sen yai, fresh wide rice noodle pack 1 kg)", "เส้นสด (local brand)",
    "clear PE pack with orange print, noodles visible", {"pack_w": 20.0, "pack_h": 28.0}, cap="heat-sealed",
    box=(0.185, 0.055, 0.81, 0.94), deshade=0, wb=False)


def run(j):
    img = FL.load(os.path.join(RAW, j["src"]))
    H, W = img.shape[:2]
    m = j["method"]
    if m == "cyl":
        xl = j.get("xl")
        xr = j.get("xr")
        out = FL.cyl_unwrap(img, j["y0"] * H, j["y1"] * H, xl=xl * W if xl is not None else None,
                            xr=xr * W if xr is not None else None, max_deg=j.get("max_deg", 68),
                            top_curve=j.get("top_curve", 0.0), thresh=j.get("thresh", 238),
                            cx=j["cx_n"] * W if "cx_n" in j else None, radius=j["r_n"] * W if "r_n" in j else None)
    elif m == "frustum_x":  # cone with explicit edges (normalised) at y0 / y1
        import cv2
        y0, y1 = j["y0"] * H, j["y1"] * H
        l0, r0, l1, r1 = j["l0"] * W, j["r0"] * W, j["l1"] * W, j["r1"] * W
        lim = np.radians(j.get("max_deg", 64))
        rmean = ((r0 - l0) + (r1 - l1)) / 4
        ow, oh = int(rmean * 2 * lim), int(y1 - y0)
        th = np.linspace(-lim, lim, ow)
        ys = np.linspace(y0, y1, oh)
        t = (ys - y0) / (y1 - y0)
        rad = (r0 - l0) / 2 + ((r1 - l1) / 2 - (r0 - l0) / 2) * t
        cxs = (l0 + r0) / 2 + ((l1 + r1) / 2 - (l0 + r0) / 2) * t
        mx = (cxs[:, None] + rad[:, None] * np.sin(th)[None, :]).astype(np.float32)
        my = np.tile(ys[:, None], (1, ow)).astype(np.float32)
        out = cv2.remap(img.astype(np.float32), mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    elif m == "frustum":
        out = FL.frustum_unwrap(img, j["y0"] * H, j["y1"] * H, max_deg=j.get("max_deg", 66),
                                thresh=j.get("thresh", 238))
    elif m == "persp":
        pts = [(x * W, y * H) for x, y in j["pts"]]
        ow = j.get("px_w", 1200)
        oh = int(ow / j["aspect"])
        out = FL.persp(img, pts, ow, oh)
    else:
        x0, y0, x1, y1 = j["box"]
        out = img[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)].astype(np.float32)
    if j.get("despec", False):
        out, _ = FL.despecular(out, l_thresh=j.get("spec_l", 244), s_thresh=j.get("spec_s", 30))
    if j.get("deshade", 0.75):
        out = FL.deshade(out, strength=j.get("deshade", 0.75))
    if j.get("wb", True):
        out = FL.white_balance(out)
    out = FL.levels(out, sat=j.get("sat", 1.06))
    out = FL.unsharp(out, 0.3)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, j["name"] + ".png")
    size = FL.save(out, path, out_w=min(j["out_w"], max(256, out.shape[1])) if out.shape[1] >= out.shape[0]
                   else None, out_h=min(j["out_w"], out.shape[0]) if out.shape[1] < out.shape[0] else None)
    return size


def worn_variant(name, strength=0.75, base_col=(92, 52, 18)):
    """Greasy / worn copy of a finished label (oil soak, sauce drips, scuffs, edge wear)."""
    import labelkit as LK
    from PIL import Image
    src = os.path.join(OUT, name + ".png")
    im = Image.open(src).convert("RGBA")
    g = LK.greasy(im, seed=abs(hash(name)) % 997, strength=strength, base_col=base_col)
    g = LK.finish(g, seed=3, grain=3.0, misreg=0, blur=0.0, uneven=0.0)
    g.convert("RGB").save(os.path.join(OUT, name + "_worn.png"), optimize=True)
    return name + "_worn.png"


def write_manifest():
    logs = {}
    for p, prefix in ((os.path.join(RAW, "_log.jsonl"), ""),
                      (os.path.join(os.path.dirname(RAW), "foodtex", "_log.jsonl"), "../foodtex/")):
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                d = json.loads(line)
                logs[prefix + d["file"]] = d
    entries = []
    for n, j in JOBS.items():
        f = os.path.join(OUT, n + ".png")
        if not os.path.exists(f):
            continue
        from PIL import Image
        w, h = Image.open(f).size
        src = logs.get(j["src"], {})
        files = [n + ".png"] + ([n + "_worn.png"] if os.path.exists(os.path.join(OUT, n + "_worn.png")) else [])
        entries.append({
            "name": n, "files": files, "size_px": [w, h], "aspect_w_over_h": round(w / h, 3),
            "product": j["product"], "brand_real": j["brand"], "package": j["package"],
            "real_dims_cm": j["real_dims_cm"], "cap": j["cap"],
            "method": {"cyl": "cylindrical unwrap of front photo (~120-150 deg of circumference)",
                       "frustum": "conical (cup) unwrap", "frustum_x": "conical (tub) unwrap",
                       "persp": "4-point perspective flatten",
                       "crop": "straight crop"}[j["method"]],
            "uv_note": "front panel centred at u=0.5; texture covers only the photographed front arc, "
                       "map it to the front of the container and tint the back with the edge colour"
            if j["method"] in ("cyl", "frustum", "frustum_x") else "flat face",
            "source_image_url": src.get("image", ""), "source_page_url": src.get("page", ""),
            "licence": "unknown (real commercial product photo, used per client instruction 2026-10-19)",
        })
    data = {"note": "Real Thai product label textures, flattened from web product photos (client rule 2026-10-19: "
                    "use real products, any licence). *_worn.png = greasy/worn variant. PNG kept because src/modules/shops "
                    "references these file names.",
            "labels": entries}
    json.dump(data, open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return len(entries)


def main():
    args = sys.argv[1:]
    if args == ["--manifest"]:
        print("manifest entries:", write_manifest())
        return
    names = args or list(JOBS)
    for n in names:
        size = run(JOBS[n])
        extra = ""
        if JOBS[n].get("worn"):
            extra = worn_variant(n, **JOBS[n].get("worn_kw", {}))
        print(n, size, extra, flush=True)
    print("manifest entries:", write_manifest())


if __name__ == "__main__":
    main()
