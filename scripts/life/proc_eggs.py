# Crops / composites for life easter eggs from REAL photos (sources: references/credits/life.md)
import sys, numpy as np, cv2
D, T = sys.argv[1], sys.argv[2]
def crop(src, box, out, size=None, q=88):
    im = cv2.imread(D + '/' + src)
    x0, y0, x1, y1 = box
    c = im[y0:y1, x0:x1]
    if size: c = cv2.resize(c, size, interpolation=cv2.INTER_AREA)
    cv2.imwrite(T + '/' + out, c, [cv2.IMWRITE_JPEG_QUALITY, q]); print('ok', out, c.shape)
    return c
crop('moodeng/01.jpg', (220, 150, 1600, 1170), 'moodeng_photo.jpg', (690, 510))
skin = crop('moodeng/01.jpg', (731, 274, 1097, 548), 'moodeng_skin.jpg', (256, 192))
crop('dogfood/00.jpg', (832, 611, 1124, 718), 'dogfood_bag.jpg', (512, 188))
im = cv2.imread(D + '/lottery/02.jpg'); h, w = im.shape[:2]
crop('lottery/02.jpg', (int(w * 0.36), int(h * 0.05), int(w * 0.99), int(h * 0.98)), 'lottery_board.jpg', (512, 512))
im = cv2.imread(D + '/amulet/10.jpg'); h, w = im.shape[:2]
crop('amulet/10.jpg', (0, int(h * 0.62), w, h), 'amulet_table.jpg', (512, 320))
crop('amulet/10.jpg', (int(w * 0.35), int(h * 0.75), int(w * 0.55), int(h * 0.85)), 'amulet_face.jpg', (128, 128))
im = cv2.imread(D + '/flowers_yellow/06.jpg'); h, w = im.shape[:2]
crop('flowers_yellow/06.jpg', (int(w * 0.18), 0, int(w * 0.86), h), 'rose_yellow.jpg', (512, 512))
im = cv2.imread(D + '/garland/00.jpg'); h, w = im.shape[:2]
crop('garland/00.jpg', (int(w * 0.25), int(h * 0.25), int(w * 0.75), int(h * 0.75)), 'garland_jasmine.jpg', (256, 256))
crop('garland/00.jpg', (int(w * 0.4), int(h * 0.4), int(w * 0.6), int(h * 0.6)), 'garland_rose.jpg', (128, 128))
