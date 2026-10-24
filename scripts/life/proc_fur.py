# Make tileable fur textures from real photos (inpaint specks, seamless blend, grayscale detail).
import sys, numpy as np, cv2
def flatten(img):
    # remove low-frequency colour/brightness variation (keeps fur detail, kills tiling seams)
    f = img.astype(np.float32)
    low = cv2.GaussianBlur(f, (0, 0), 40)
    mean = f.reshape(-1, f.shape[-1]).mean(0) if f.ndim == 3 else f.mean()
    return np.clip(f - low + mean, 0, 255)
def tileable(img):
    h, w = img.shape[:2]
    out = flatten(img)
    sh = np.roll(np.roll(out, h // 2, 0), w // 2, 1)
    y = np.linspace(-1, 1, h)[:, None]; x = np.linspace(-1, 1, w)[None, :]
    r = np.clip(np.maximum(np.abs(x), np.abs(y)), 0, 1)
    m = 0.5 - 0.5 * np.cos(np.clip((r - 0.55) / 0.45, 0, 1) * np.pi)
    m = m[..., None] if out.ndim == 3 else m
    res = out * (1 - m) + sh * m
    return np.clip(res, 0, 255).astype(np.uint8)
src, out_col, out_det, x0, y0, sz = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
img = cv2.imread(src)
crop = img[y0:y0 + sz, x0:x0 + sz]
# remove bright specks (snow) by inpainting
g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
mask = ((hsv[..., 1] < 95) & (g > 135)).astype(np.uint8) * 255
mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=3)
crop = cv2.inpaint(crop, mask, 7, cv2.INPAINT_TELEA)
crop = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_AREA)
t = tileable(crop)
cv2.imwrite(out_col, t, [cv2.IMWRITE_JPEG_QUALITY, 88])
gray = cv2.cvtColor(t, cv2.COLOR_BGR2GRAY).astype(np.float32)
blur = cv2.GaussianBlur(gray, (0, 0), 18)
det = np.clip(128 + (gray - blur) * 2.2, 0, 255).astype(np.uint8)
cv2.imwrite(out_det, det, [cv2.IMWRITE_JPEG_QUALITY, 90])
print('ok', out_col, out_det, int(mask.mean() / 2.55), '% specks')
