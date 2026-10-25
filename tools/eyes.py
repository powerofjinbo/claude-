"""闭眼版立绘：把睁着的眼睛 inpaint 成皮肤，再画上闭合的眼睑线。

坐标都是 claude-sheet.webp（1536×1024）上的像素。在 SS 倍超采样画布上画，最后缩回来，线条才顺滑。
"""
import cv2
import numpy as np

SS = 4

# 每只眼：外眼角、内眼角、上眼睑最高点、下眼睑最低点（原图像素），以及眼睑线往下弯的程度
EYES = [
    # 画面左边那只（她的右眼）
    dict(outer=(305, 284), inner=(361, 272), top=(334, 262), bottom=(334, 292), sag=7.0),
    # 画面右边那只（她的左眼）
    dict(outer=(453, 219), inner=(409, 245), top=(428, 210), bottom=(433, 248), sag=6.0),
]

LID = (24, 34, 78)       # 眼睑线颜色（BGR，深棕）
SHADOW = (118, 120, 200)  # 眼睑上方一点点阴影（BGR，偏粉）


def _bezier(p0, p1, p2, n=64):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2


def eye_mask(shape, eye, grow=1.0):
    """覆盖整只睁眼（含上睫毛）的多边形 mask，shape 为超采样画布尺寸。"""
    o = np.array(eye['outer'], float)
    i = np.array(eye['inner'], float)
    top = np.array(eye['top'], float)
    bot = np.array(eye['bottom'], float)
    c = (o + i + top + bot) / 4
    upper = _bezier(o, 2 * top - (o + i) / 2, i)
    lower = _bezier(i, 2 * bot - (o + i) / 2, o)
    poly = np.concatenate([upper, lower])
    poly = c + (poly - c) * grow
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(m, [np.round(poly * SS).astype(np.int32)], 255, lineType=cv2.LINE_AA)
    return m


def close_eyes(bgr):
    """bgr: 整张设定图（原分辨率）。返回同尺寸的闭眼版。"""
    h, w = bgr.shape[:2]
    big = cv2.resize(bgr, (w * SS, h * SS), interpolation=cv2.INTER_CUBIC)
    mask = np.zeros(big.shape[:2], np.uint8)
    for eye in EYES:
        mask = np.maximum(mask, eye_mask(big.shape, eye, grow=1.12))
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
    filled = cv2.inpaint(big, mask, 9 * SS, cv2.INPAINT_TELEA)
    # inpaint 的结果有点"抹"，用大半径模糊再柔和一次，和周围皮肤的质感接上
    soft = cv2.GaussianBlur(filled, (0, 0), 3 * SS)
    fm = cv2.GaussianBlur(mask, (0, 0), 2 * SS).astype(np.float32)[..., None] / 255
    out = (big * (1 - fm) + (soft * 0.55 + filled * 0.45) * fm).astype(np.float32)

    lines = np.zeros(big.shape[:2], np.float32)
    shade = np.zeros(big.shape[:2], np.float32)
    for eye in EYES:
        o = np.array(eye['outer'], float)
        i = np.array(eye['inner'], float)
        mid = (o + i) / 2
        # 法线（指向下方）
        d = i - o
        n = np.array([-d[1], d[0]]) / np.linalg.norm(d)
        if n[1] < 0:
            n = -n
        ctrl = mid + n * eye['sag'] * 1.6
        pts = _bezier(o + n * 2, ctrl, i + n * 1.0, 80)
        # 粗细从外眼角到内眼角渐细
        for k in range(len(pts) - 1):
            t = k / (len(pts) - 1)
            th = (3.0 - 1.9 * t) * SS
            a = tuple(np.round(pts[k] * SS).astype(int))
            b = tuple(np.round(pts[k + 1] * SS).astype(int))
            cv2.line(lines, a, b, 1.0, max(1, int(th)), cv2.LINE_AA)
        # 外眼角几根睫毛
        for j, (ang, ln) in enumerate([(0.0, 7.0), (0.35, 6.0), (0.7, 4.5)]):
            base = pts[2 + j * 4]
            dirv = -(d / np.linalg.norm(d)) * np.cos(ang) + n * np.sin(ang + 0.5)
            tip = base + dirv * ln
            cv2.line(lines, tuple(np.round(base * SS).astype(int)), tuple(np.round(tip * SS).astype(int)), 1.0, int(1.6 * SS), cv2.LINE_AA)
        # 眼睑上方淡淡的一层阴影
        sh = _bezier(o - n * 3, mid - n * 4, i - n * 3, 40)
        cv2.polylines(shade, [np.round(sh * SS).astype(np.int32)], False, 1.0, int(5 * SS), cv2.LINE_AA)

    shade = cv2.GaussianBlur(shade, (0, 0), 3 * SS)[..., None] * 0.10
    out = out * (1 - shade) + np.array(SHADOW, np.float32) * shade
    lines = cv2.GaussianBlur(lines, (0, 0), 0.6 * SS)[..., None]
    out = out * (1 - lines) + np.array(LID, np.float32) * lines
    small = cv2.resize(np.clip(out, 0, 255).astype(np.uint8), (w, h), interpolation=cv2.INTER_AREA)
    return small


def eye_regions():
    """(cx, cy, rx, ry, angle) 原图像素，给"睁眼"动画用。"""
    out = []
    for eye in EYES:
        o = np.array(eye['outer'], float)
        i = np.array(eye['inner'], float)
        c = (o + i) / 2
        rx = np.linalg.norm(i - o) / 2 * 1.2
        ry = abs(eye['bottom'][1] - eye['top'][1]) / 2 * 1.35
        ang = np.degrees(np.arctan2(i[1] - o[1], i[0] - o[0]))
        cy = (eye['top'][1] + eye['bottom'][1]) / 2
        out.append((c[0], cy, rx, ry, ang))
    return out


if __name__ == '__main__':
    import sys
    src = cv2.imread(sys.argv[1])
    closed = close_eyes(src)
    crop = lambda im: cv2.resize(im[180:330, 290:520], (920, 600), interpolation=cv2.INTER_LANCZOS4)
    cv2.imwrite(sys.argv[2], np.concatenate([crop(src), crop(closed)], axis=0))
