"""渲染开机动画 assets/boot.mp4（1280×720 / 24fps / 带声音，横版全屏，无文字）。

思路和 dsh-video-skin 的 boot.mp4 一样：黑场 → 霓虹光带扫过 → 光线一笔一笔勾出人物轮廓 →
线条过曝成白光 → 颜色从线稿底下渗出来（这时是闭着眼的）→ 睁眼 → 定格。
区别是那边的片子是现成素材，这里是从一张立绘现场算出来的：

  - 人物：assets/claude-portraits.webp 里正面上半身那张，Real-ESRGAN anime 4× 放大
    （tools/upscale.py），GrabCut 抠出来放到深色背景上
  - 闭眼版：tools/eyes.py（inpaint 掉眼睛 + 画眼睑线）
  - 线稿：闭眼版的 Canny 边缘 + 剪影外轮廓；每个连通笔画从最上面的点开始 BFS，按"沿笔画的距离"
    决定什么时候亮起来 —— 所以看起来是被一支光笔顺着笔画描出来的，而不是整片淡入
  - 声音：numpy 现场合成（垫底 + 光带呼啸 + 描线时的电子琶音 + 过曝冲击 + 睁眼铃音）。
    "Welcome back!" 不在片子里，是启动器在睁眼那一刻用系统 TTS 说的（见 config.voice）

用法：
  pip install -r tools/requirements.txt
  python tools/render_boot.py [--out assets/boot.mp4] [--preview contact.png]
"""
import argparse
import os
import subprocess
import sys
import tempfile
from collections import deque

import cv2
import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, lfilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eyes import close_eyes, eye_regions  # noqa: E402
from upscale import CACHE, upscale  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, FPS = 1280, 720, 24
DUR = 9.0
N = int(DUR * FPS)
SR = 44100

# 立绘：assets/claude-portraits.webp 第一行中间那张（正面上半身），4× 放大后在这个坐标系里量的眼睛
PORTRAIT_FILE = 'claude-portraits.webp'
PORTRAIT = (518, 0, 1019, 510)
EYES_X4 = [
    dict(outer=(660, 765), inner=(848, 785), top=(760, 708), bottom=(780, 828), sag=6.0, grow=1.4, skin=0.6),
    dict(outer=(1325, 665), inner=(1142, 715), top=(1250, 628), bottom=(1220, 765), sag=6.0, grow=1.4, skin=0.6),
]
CW, CX0 = W, 0  # 人物层和画面一样大

# 时间轴（秒）
RIB_IN, RIB_OUT = 0.15, 4.2
TRACE0, TRACE1 = 0.9, 3.9
FLARE0, FLARE_PEAK, FLARE1 = 3.6, 4.35, 5.4
COLOR0, COLOR1 = 4.25, 6.4
LINES_OFF0, LINES_OFF1 = 5.0, 7.1
EYE0, EYE1 = 6.65, 7.1

rng = np.random.default_rng(20261024)


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def ramp(t, a, b):
    return smooth((t - a) / (b - a))


# ---------------------------------------------------------------- 素材准备


def portrait_x4():
    """立绘 4× 放大（Real-ESRGAN anime，结果缓存在 tools/.cache/）。"""
    path = os.path.join(CACHE, 'portrait-x4.png')
    if os.path.exists(path):
        return cv2.imread(path)
    src = cv2.imread(os.path.join(ROOT, 'assets', PORTRAIT_FILE))
    x0, y0, x1, y1 = PORTRAIT
    rgb = cv2.cvtColor(src[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
    big = cv2.cvtColor(upscale(rgb), cv2.COLOR_RGB2BGR)
    os.makedirs(CACHE, exist_ok=True)
    cv2.imwrite(path, big)
    return big


def cutout(img):
    """GrabCut 抠出人物（img 已经是成片尺寸），返回 0..1 的 alpha。"""
    h, w = img.shape[:2]
    m = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
    m[:6] = cv2.GC_BGD
    m[:, :6] = cv2.GC_BGD
    m[:, -6:] = cv2.GC_BGD
    cv2.ellipse(m, (w // 2, int(h * 0.6)), (int(w * 0.42), int(h * 0.62)), 0, 0, 360, cv2.GC_PR_FGD, -1)
    cv2.ellipse(m, (int(w * 0.49), int(h * 0.39)), (int(w * 0.155), int(h * 0.18)), 0, 0, 360, cv2.GC_FGD, -1)  # 脸
    cv2.rectangle(m, (int(w * 0.31), int(h * 0.58)), (int(w * 0.69), h - 1), cv2.GC_FGD, -1)  # 躯干
    cv2.rectangle(m, (int(w * 0.04), int(h * 0.80)), (int(w * 0.96), h - 1), cv2.GC_FGD, -1)  # 两边的袖子
    cv2.rectangle(m, (int(w * 0.68), int(h * 0.04)), (int(w * 0.90), int(h * 0.52)), cv2.GC_PR_FGD, -1)  # 发饰
    cv2.rectangle(m, (int(w * 0.74), int(h * 0.10)), (int(w * 0.82), int(h * 0.34)), cv2.GC_FGD, -1)
    bgm = np.zeros((1, 65), np.float64)
    fgm = np.zeros((1, 65), np.float64)
    cv2.grabCut(img, m, None, bgm, fgm, 8, cv2.GC_INIT_WITH_MASK)
    fg = np.where((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    if n > 1:  # 只留最大的连通块
        keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        fg = np.where(lab == keep, 255, 0).astype(np.uint8)
    return cv2.GaussianBlur(fg, (0, 0), 1.2).astype(np.float32) / 255


def load_layers():
    big = portrait_x4()
    ph = H
    pw = int(round(big.shape[1] * H / big.shape[0]))
    k = H / big.shape[0]
    px = (W - pw) // 2
    small = cv2.resize(big, (pw, ph), interpolation=cv2.INTER_AREA)
    eyes_px = [{key: ((v[0] * k, v[1] * k) if isinstance(v, tuple) else v) for key, v in e.items()} for e in EYES_X4]
    closed_small = close_eyes(small, eyes_px)
    alpha_small = cutout(small)
    # 立绘左右两边是画框切断的头发：羽化掉
    xx = np.arange(pw, dtype=np.float32)
    alpha_small *= np.minimum(smooth(xx / 70), smooth((pw - 1 - xx) / 70))[None, :]
    yy = np.arange(ph, dtype=np.float32)
    alpha_small *= smooth((ph - 1 - yy) / 90)[:, None]  # 画面下沿切断身体的地方也羽化

    def full(img):
        out = np.zeros((H, W) + img.shape[2:], img.dtype)
        out[:, px:px + pw] = img
        return out

    def rgb(img):
        return cv2.cvtColor(full(img), cv2.COLOR_BGR2RGB).astype(np.float32) / 255

    open_rgb = rgb(small)
    closed_rgb = rgb(closed_small)
    alpha = full(alpha_small)
    feather = alpha[..., None]

    # 线稿：人物内部的 Canny + 剪影外轮廓，背景一根线都没有
    gray = cv2.cvtColor((closed_rgb * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    soft = cv2.bilateralFilter(gray, 9, 50, 9)
    soft = cv2.GaussianBlur(soft, (0, 0), 1.0)
    edges = cv2.Canny(soft, 30, 80)
    inner = cv2.erode((alpha > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8))
    edges[inner == 0] = 0
    edges |= cv2.Canny((alpha * 255).astype(np.uint8), 60, 160)

    # 柔边（过曝阶段的"白光素描"）
    gx = cv2.Sobel(soft.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(soft.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy) * alpha
    mag = np.clip(mag / np.percentile(mag[alpha > 0.5], 97), 0, 1) ** 0.8
    sketch = cv2.GaussianBlur(mag, (0, 0), 0.8)

    reveal = trace_order(edges)

    eyes = [(px + cx, cy, rx, ry, ang) for (cx, cy, rx, ry, ang) in eye_regions(eyes_px)]

    # 背景板：立绘自己的背景（城堡、烛光）大幅模糊、压暗、铺满整个横版画面
    plate = cv2.resize(small, (W, int(W * ph / pw)), interpolation=cv2.INTER_LINEAR)
    oy = (plate.shape[0] - H) // 3
    plate = cv2.cvtColor(plate[oy:oy + H], cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    plate = cv2.GaussianBlur(plate, (0, 0), 26) * np.array([0.42, 0.34, 0.42], np.float32)

    return dict(plate=plate, open=open_rgb, closed=closed_rgb, feather=feather, edges=edges > 0,
                reveal=reveal, sketch=sketch, eyes=eyes)


def trace_order(edges):
    """每个边缘像素"什么时候被描到"（秒）。没被描的像素是 inf。"""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(edges, connectivity=8)
    reveal = np.full(edges.shape, np.inf, np.float32)
    ys, xs = np.nonzero(edges)
    by_label = {}
    for y, x in zip(ys, xs):
        by_label.setdefault(labels[y, x], []).append((y, x))
    span = TRACE1 - TRACE0
    for lab, pix in by_label.items():
        if len(pix) < 10:
            continue
        seed = min(pix, key=lambda p: (p[0], p[1]))
        dist = {seed: 0}
        q = deque([seed])
        members = set(pix)
        while q:
            p = q.popleft()
            d = dist[p] + 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nb = (p[0] + dy, p[1] + dx)
                    if nb in members and nb not in dist:
                        dist[nb] = d
                        q.append(nb)
        longest = max(dist.values()) or 1
        start = TRACE0 + (seed[0] / H) * 0.55 * span + rng.random() * 0.22 * span
        speed = max(240.0, longest / max(0.25, TRACE1 - start))
        for (y, x), d in dist.items():
            reveal[y, x] = start + d / speed
    return reveal


PALETTE = np.array([
    [0.25, 0.95, 1.00],  # 青
    [0.55, 0.40, 1.00],  # 紫
    [1.00, 0.30, 0.78],  # 品红
    [1.00, 0.52, 0.28],  # Claude 橙
    [1.00, 0.84, 0.46],  # 金
], np.float32)


def palette(u):
    u = np.clip(u, 0, 0.9999) * (len(PALETTE) - 1)
    i = np.floor(u).astype(int)
    f = (u - i)[..., None]
    return PALETTE[i] * (1 - f) + PALETTE[i + 1] * f


# ---------------------------------------------------------------- 光带


class Ribbon:
    def __init__(self, k):
        self.y0 = 140 + k * 115 + rng.uniform(-30, 30)
        self.amp = rng.uniform(90, 170)
        self.freq = rng.uniform(0.7, 1.3)
        self.phase = rng.uniform(0, 1)
        self.t0 = RIB_IN + k * 0.22 + rng.uniform(0, 0.15)
        self.dur = rng.uniform(1.6, 2.2)
        self.hue0 = rng.uniform(0, 0.6)
        self.flip = k % 2 == 1
        self.width = rng.uniform(2.4, 4.0)

    def points(self, t, u):
        x = -120 + u * (W + 240)
        if self.flip:
            x = W - x
        drift = 0.08 * t
        y = self.y0 + self.amp * np.sin(2 * np.pi * (self.freq * u + self.phase + drift)) \
            + 35 * np.sin(2 * np.pi * (2.3 * u + 0.4 * t))
        return np.stack([x, y], -1)

    def draw(self, img, t):
        head = (t - self.t0) / self.dur
        if head <= 0:
            return
        head = min(1.35, head * 1.15)
        tail = head - 0.6
        fade = 1 - ramp(t, RIB_OUT - 1.0, RIB_OUT)
        if fade <= 0:
            return
        u = np.linspace(max(0, tail), min(1, head), 160)
        if len(u) < 2 or u[-1] <= u[0]:
            return
        pts = self.points(t, u)
        cols = palette((self.hue0 + u * 0.5) % 1.0)
        bright = ((u - tail) / (head - tail)) ** 1.6 * fade
        for i in range(len(u) - 1):
            c = tuple(float(v) for v in cols[i] * bright[i])
            p = tuple(np.round(pts[i] * 4).astype(int))
            q = tuple(np.round(pts[i + 1] * 4).astype(int))
            cv2.line(img, p, q, c, int(self.width * 4), cv2.LINE_AA, shift=2)


# ---------------------------------------------------------------- 粒子


class Dust:
    def __init__(self, n=140):
        self.x = rng.uniform(0, W, n)
        self.y = rng.uniform(0, H, n)
        self.vy = rng.uniform(10, 38, n)
        self.r = rng.uniform(0.8, 2.6, n)
        self.tw = rng.uniform(0, 6.28, n)
        self.col = palette(rng.uniform(0.0, 1.0, n))
        self.t0 = rng.uniform(1.0, 5.0, n)

    def draw(self, img, t):
        for i in range(len(self.x)):
            if t < self.t0[i]:
                continue
            a = ramp(t, self.t0[i], self.t0[i] + 0.8) * (0.45 + 0.55 * np.sin(t * 2.3 + self.tw[i]) ** 2)
            y = (self.y[i] - self.vy[i] * t) % (H + 40) - 20
            c = tuple(float(v) for v in self.col[i] * a)
            cv2.circle(img, (int(self.x[i] * 4), int(y * 4)), int(self.r[i] * 4), c, -1, cv2.LINE_AA, shift=2)


# ---------------------------------------------------------------- 一帧


def glow(img, sigmas, gains):
    out = img.copy()
    for s, g in zip(sigmas, gains):
        out += cv2.GaussianBlur(img, (0, 0), s) * g
    return out


def star(img, cx, cy, size, intensity, color):
    """四角星芒（睁眼时眼里的那一下闪光）。"""
    for ang, ln in ((0, 1.0), (90, 1.0), (45, 0.45), (135, 0.45)):
        a = np.radians(ang)
        dx, dy = np.cos(a) * size * ln, np.sin(a) * size * ln
        p = (int((cx - dx) * 4), int((cy - dy) * 4))
        q = (int((cx + dx) * 4), int((cy + dy) * 4))
        cv2.line(img, p, q, tuple(float(v) * intensity for v in color), 4, cv2.LINE_AA, shift=2)
    cv2.circle(img, (int(cx * 4), int(cy * 4)), int(size * 0.18 * 4), tuple(float(v) * intensity for v in color), -1, cv2.LINE_AA, shift=2)


def render_frame(L, ribbons, dust, t, line_col):
    frame = np.zeros((H, W, 3), np.float32)

    # 背景：深紫黑，越到后面越暖
    warm = ramp(t, COLOR0, COLOR1)
    frame[:] = np.array([0.012, 0.010, 0.030], np.float32)
    frame += BG_GLOW * (0.25 + 0.75 * warm)

    # 颜色层（闭眼 → 睁眼）
    col_amt = ramp(t, COLOR0, COLOR1)
    if col_amt > 0:
        frame += L['plate'] * col_amt
        img = L['closed']
        if t >= EYE0:
            k = ramp(t, EYE0, EYE1)
            m = np.zeros((H, CW), np.float32)
            for (cx, cy, rx, ry, ang) in L['eyes']:
                cv2.ellipse(m, (int(cx * 4), int(cy * 4)), (int(rx * 4), max(1, int(ry * k * 4))), ang, 0, 360, 1.0, -1, cv2.LINE_AA, shift=2)
            m = cv2.GaussianBlur(m, (0, 0), 1.6)[..., None]
            img = img * (1 - m) + L['open'] * m
        gray = img.mean(axis=2, keepdims=True)
        sat = 0.25 + 0.75 * ramp(t, COLOR0 + 0.3, COLOR1 + 0.3)
        img = gray + (img - gray) * sat
        tint = np.array([0.80, 0.86, 1.12], np.float32) * (1 - warm) + np.array([1, 1, 1], np.float32) * warm
        img = img * tint * (0.55 + 0.45 * col_amt)
        a = L['feather'] * col_amt
        region = frame[:, CX0:CX0 + CW]
        frame[:, CX0:CX0 + CW] = region * (1 - a) + img * a

    # 线稿层
    lines = np.zeros((H, CW, 3), np.float32)
    since = t - L['reveal']
    on = np.clip(since / 0.10, 0, 1)
    tip = np.exp(-((since - 0.02) / 0.05) ** 2) * (since > -0.05)
    flare = ramp(t, FLARE0, FLARE_PEAK) * (1 - ramp(t, FLARE_PEAK, FLARE1))
    whiten = ramp(t, FLARE0, FLARE_PEAK + 0.3)
    fade = 1 - ramp(t, LINES_OFF0, LINES_OFF1) * 0.92
    col = line_col * (1 - whiten) + np.array([1.0, 0.96, 0.9], np.float32) * whiten
    lines += col * (on * (0.9 + 0.8 * flare) * fade)[..., None]
    lines += np.array([1.0, 0.95, 0.88], np.float32) * (tip * 1.6)[..., None]
    # 过曝阶段：整张柔边素描一起亮起来
    sk = L['sketch'] * (flare * 0.45 + ramp(t, FLARE0, FLARE_PEAK) * 0.25 * fade * (1 - col_amt))
    lines += np.array([0.85, 0.9, 1.0], np.float32) * sk[..., None]
    lines = glow(lines, (1.4, 5, 16), (0.9, 0.7 + flare * 0.5, 0.45 + flare * 0.5))
    frame += lines  # 线稿只在人物里，辉光允许溢出去

    # 光带 / 粒子 / 星芒（超采样画在 uint8 之外的 float 画布上）
    fx = np.zeros((H, W, 3), np.float32)
    for r in ribbons:
        r.draw(fx, t)
    dust.draw(fx, t)
    if t >= EYE1 - 0.15:
        k = ramp(t, EYE1 - 0.15, EYE1 + 0.15) * (1 - ramp(t, EYE1 + 0.25, EYE1 + 0.8))
        if k > 0:
            for (cx, cy, rx, ry, ang) in L['eyes']:
                star(fx, CX0 + cx + rx * 0.15, cy - ry * 0.25, 9 + 6 * k, 1.0 * k, (1.0, 0.92, 0.8))
    frame += glow(fx, (2, 7, 20), (1.0, 0.8, 0.5))

    # 过曝那一下的全屏白光
    frame += np.array([1.0, 0.93, 0.86], np.float32) * (flare ** 3 * 0.12)

    # 呼吸式推镜
    z = 1.0 + 0.045 * ramp(t, 0, DUR)
    M = cv2.getRotationMatrix2D((CX0 + CW / 2, H * 0.45), 0, z)
    frame = cv2.warpAffine(frame, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    frame *= VIGNETTE
    # 柔和高光压缩
    knee = 0.82
    over = np.maximum(frame - knee, 0)
    frame = np.where(frame > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), frame)
    # 片尾不黑场：最后一帧要停在画面上，等 Claude 窗口出来再由启动器淡出
    return np.clip(frame * 255 + rng.uniform(-0.5, 0.5, frame.shape), 0, 255).astype(np.uint8)


yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
_d = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H / 2) / (H * 0.62)) ** 2)
VIGNETTE = (1 - 0.55 * smooth(_d - 0.35))[..., None]
_g = np.exp(-(((xx - (CX0 + CW / 2)) / 520) ** 2 + ((yy - H * 0.42) / 420) ** 2))
BG_GLOW = (_g[..., None] * np.array([0.10, 0.045, 0.06], np.float32))


# ---------------------------------------------------------------- 声音


def audio():
    n = int(DUR * SR)
    t = np.arange(n) / SR
    L = np.zeros(n)
    R = np.zeros(n)

    def env(a, b, attack, release):
        e = np.zeros(n)
        i0, i1 = int(a * SR), min(n, int(b * SR))
        tt = t[i0:i1] - a
        e[i0:i1] = np.minimum(1, tt / attack) * np.minimum(1, (b - a - tt) / release)
        return np.clip(e, 0, 1)

    def add(sig, pan=0.0, gain=1.0):
        nonlocal L, R
        L += sig * gain * np.sqrt(0.5 * (1 - pan))
        R += sig * gain * np.sqrt(0.5 * (1 + pan))

    def hz(m):
        return 440 * 2 ** ((m - 69) / 12)

    # 垫底：低频嗡鸣，过曝时鼓起来
    drone = np.sin(2 * np.pi * 55 * t) + 0.5 * np.sin(2 * np.pi * 110.3 * t)
    add(drone * env(0, DUR, 2.0, 1.0) * (0.5 + 0.8 * np.exp(-((t - FLARE_PEAK) / 0.8) ** 2)), 0, 0.05)

    # 光带呼啸：带通噪声扫频，左右声像移动
    for k, (t0, d, pan) in enumerate([(0.2, 1.4, -0.7), (0.6, 1.5, 0.6), (1.1, 1.4, -0.3), (1.6, 1.3, 0.8)]):
        seg = int(d * SR)
        noise = rng.standard_normal(seg)
        out = np.zeros(seg)
        zi = np.zeros(2)
        block = 512
        for b in range(0, seg, block):
            fr = 300 * (14 ** (b / seg))
            w0 = 2 * np.pi * fr / SR
            alpha = np.sin(w0) / (2 * 1.6)
            bb = np.array([alpha, 0, -alpha])
            aa = np.array([1 + alpha, -2 * np.cos(w0), 1 - alpha])
            out[b:b + block], zi = lfilter(bb / aa[0], aa / aa[0], noise[b:b + block], zi=zi)
        e = np.sin(np.pi * np.linspace(0, 1, seg)) ** 2
        sig = np.zeros(n)
        i0 = int(t0 * SR)
        sig[i0:i0 + seg] = (out * e)[: n - i0]
        add(sig, pan, 0.22)

    # 描线：电子琶音（A 小调五声），每声短促，左右随机
    notes = [81, 84, 86, 88, 91, 93, 96]
    step = 0.115
    k = 0
    for tt in np.arange(TRACE0, TRACE1 + 0.2, step):
        m = notes[(k * 3 + (k // 4)) % len(notes)]
        k += 1
        i0 = int(tt * SR)
        ln = int(0.18 * SR)
        x = np.arange(ln) / SR
        tone = (np.sin(2 * np.pi * hz(m) * x) + 0.25 * np.sin(2 * np.pi * hz(m) * 3 * x)) * np.exp(-x * 26)
        sig = np.zeros(n)
        sig[i0:i0 + ln] = tone[: n - i0]
        add(sig, rng.uniform(-0.8, 0.8), 0.05 * (0.6 + 0.4 * ramp(tt, TRACE0, TRACE1)))

    # 过曝前的上升音 + 冲击
    rise = env(FLARE0 - 0.6, FLARE_PEAK, 1.0, 0.05)
    add(np.sin(2 * np.pi * (200 + 900 * ramp(t, FLARE0 - 0.6, FLARE_PEAK)) * t) * rise * 0.5 + rng.standard_normal(n) * rise * 0.35, 0, 0.12)
    i0 = int(FLARE_PEAK * SR)
    x = np.arange(n - i0) / SR
    boom = np.sin(2 * np.pi * (85 * np.exp(-x * 2.5) + 38) * x) * np.exp(-x * 2.2)
    add(np.concatenate([np.zeros(i0), boom]), 0, 0.55)

    # 颜色渗出：A 大调暖垫
    pad = np.zeros(n)
    for m in (57, 61, 64, 69):
        pad += np.sin(2 * np.pi * hz(m) * t) + 0.3 * np.sin(2 * np.pi * hz(m) * 2.003 * t)
    pad *= env(FLARE_PEAK, DUR, 1.4, 1.2)
    add(pad, 0, 0.035)

    # 睁眼：铃音琶音 + 亮晶晶
    for j, m in enumerate((88, 93, 97, 100, 105)):
        tt = EYE0 + 0.05 + j * 0.07
        i0 = int(tt * SR)
        x = np.arange(n - i0) / SR
        f = hz(m)
        bell = (np.sin(2 * np.pi * f * x) + 0.35 * np.sin(2 * np.pi * f * 2 * x) * np.exp(-x * 3)) * np.exp(-x * 2.4)
        add(np.concatenate([np.zeros(i0), bell]), (j - 2) * 0.3, 0.09)

    mix = np.stack([L, R], 1)
    # 混响
    ir_len = int(2.4 * SR)
    ir = rng.standard_normal((ir_len, 2)) * (np.linspace(1, 0, ir_len) ** 3)[:, None]
    wet = np.stack([fftconvolve(mix[:, c], ir[:, c])[:n] for c in range(2)], 1)
    wet /= np.max(np.abs(wet)) + 1e-9
    mix = mix / (np.max(np.abs(mix)) + 1e-9) + wet * 0.35
    fade = np.ones(n)
    fade[-int(0.5 * SR):] = np.linspace(1, 0, int(0.5 * SR))
    mix *= fade[:, None]
    mix *= 0.89 / np.max(np.abs(mix))
    return (mix * 32767).astype(np.int16)


# ---------------------------------------------------------------- 主流程


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'assets', 'boot.mp4'))
    ap.add_argument('--preview', help='额外输出一张联系表 PNG')
    ap.add_argument('--frames', type=int, default=N)
    args = ap.parse_args()

    L = load_layers()
    print(f'edges: {int(L["edges"].sum())} px, character {CW}x{H} at x={CX0}', flush=True)
    ys, xs = np.mgrid[0:H, 0:CW]
    line_col = palette(((ys / H) * 0.75 + (xs / CW) * 0.25 + 0.08 * np.sin(xs / 37.0)) % 1.0)
    ribbons = [Ribbon(k) for k in range(5)]
    dust = Dust()

    tmp = tempfile.mkdtemp()
    wav = os.path.join(tmp, 'a.wav')
    wavfile.write(wav, SR, audio())

    ff = subprocess.Popen([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
        '-i', wav,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart',
        args.out,
    ], stdin=subprocess.PIPE)
    sheet = []
    for i in range(args.frames):
        t = i / FPS
        f = render_frame(L, ribbons, dust, t, line_col)
        ff.stdin.write(f.tobytes())
        if args.preview and i % 12 == 0:
            sheet.append(cv2.resize(f, (320, 180), interpolation=cv2.INTER_AREA))
        if i % 24 == 0:
            print(f'frame {i}/{args.frames}', flush=True)
    ff.stdin.close()
    if ff.wait() != 0:
        sys.exit('ffmpeg failed')
    if args.preview and sheet:
        while len(sheet) % 4:
            sheet.append(np.zeros_like(sheet[0]))
        rows = [np.concatenate(sheet[r:r + 4], 1) for r in range(0, len(sheet), 4)]
        cv2.imwrite(args.preview, cv2.cvtColor(np.concatenate(rows, 0), cv2.COLOR_RGB2BGR))
    print('wrote', args.out)


if __name__ == '__main__':
    main()
