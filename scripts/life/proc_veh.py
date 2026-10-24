# Build vehicle texture atlases (1024²: side = top half, front = bottom-left, rear = bottom-right)
# from REAL photos by perspective rectification of hand-picked quads.
import sys, json, numpy as np, cv2
def warp(img, quad, w, h):
    src = np.float32(quad); dst = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
def mirror_face(side, x0, x1, y0, y1):
    """symmetric front/rear face from a strip of the side photo (left half + its mirror)"""
    crop = side[y0:y1, x0:x1]
    half = cv2.resize(crop, (256, 512))
    return np.hstack([half, cv2.flip(half, 1)])
cfg = json.load(open(sys.argv[1]))
root = sys.argv[2]; out = sys.argv[3]
for v in cfg:
    img = cv2.imread(root + '/' + v['src'])
    side = warp(img, v['side'], 1024, 512)
    if v.get('flip'): side = cv2.flip(side, 1)
    atlas = np.zeros((1024, 1024, 3), np.uint8)
    atlas[0:512] = side
    if 'front' in v:
        fimg = cv2.imread(root + '/' + v.get('front_src', v['src']))
        atlas[512:1024, 0:512] = warp(fimg, v['front'], 512, 512)
    else:
        fx = v.get('front_strip', [0, 120, 180, 470])
        atlas[512:1024, 0:512] = mirror_face(side, *fx)
    rx = v.get('rear_strip', [904, 1024, 180, 470])
    atlas[512:1024, 512:1024] = mirror_face(side, *rx)
    alpha = v.get('alpha')
    if alpha:  # tuk-tuk style open cabin: transparent band between body and roof
        a = np.full((1024, 1024), 255, np.uint8)
        y0, y1 = int((1 - alpha[1]) * 512), int((1 - alpha[0]) * 512)
        a[y0:y1, :] = 0
        rgba = np.dstack([atlas, a])
        cv2.imwrite(out + '/veh_' + v['id'] + '.png', rgba)
    else:
        cv2.imwrite(out + '/veh_' + v['id'] + ('.png' if v.get('png') else '.jpg'), atlas, [cv2.IMWRITE_JPEG_QUALITY, 86])
    print('ok', v['id'])
