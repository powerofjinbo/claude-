"""导出给 AI 视频工具（可灵 / 即梦）用的首帧、尾帧：深色背景上的正面立绘，闭眼版 / 睁眼版。

  python tools/export_frames.py [--size 1920x1080] [--out docs/kling]

和 render_boot.py 用的是同一套图层，所以生成出来的片子能和光线勾勒的开场无缝接上。
"""
import argparse
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_boot as rb  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', default='1920x1080')
    ap.add_argument('--out', default=os.path.join(rb.ROOT, 'docs', 'kling'))
    args = ap.parse_args()
    rb.W, rb.H = (int(v) for v in args.size.split('x'))
    rb.CW = rb.W
    rb.trace_order = lambda edges: np.zeros(edges.shape, np.float32)  # 描线顺序用不上，跳过
    L = rb.load_layers()
    os.makedirs(args.out, exist_ok=True)
    yy, xx = np.mgrid[0:rb.H, 0:rb.W].astype(np.float32)
    d = np.sqrt(((xx - rb.W / 2) / (rb.W * 0.62)) ** 2 + ((yy - rb.H / 2) / (rb.H * 0.62)) ** 2)
    vignette = (1 - 0.55 * rb.smooth(d - 0.35))[..., None]
    for name, img in (('start-eyes-closed', L['closed']), ('end-eyes-open', L['open'])):
        a = L['feather']
        frame = (L['plate'] + np.array([0.012, 0.010, 0.030], np.float32)) * (1 - a) + img * a
        frame = np.clip(frame * vignette, 0, 1)
        path = os.path.join(args.out, name + '.png')
        cv2.imwrite(path, cv2.cvtColor((frame * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
        print('wrote', path)

    # 可灵第一段（光线勾勒）的首帧：黑底上的霓虹线稿，和闭眼版完全对齐
    edges = L['edges'].astype(np.float32)
    ys, xs = np.mgrid[0:rb.H, 0:rb.W]
    col = rb.palette(((ys / rb.H) * 0.75 + (xs / rb.W) * 0.25 + 0.08 * np.sin(xs / 55.0)) % 1.0)
    lines = col * edges[..., None]
    lines = rb.glow(lines, (1.6, 6, 20), (0.9, 0.7, 0.45))
    lines += np.array([0.85, 0.9, 1.0], np.float32) * (L['sketch'] * 0.12)[..., None]
    frame = np.array([0.012, 0.010, 0.030], np.float32) + lines
    knee = 0.82
    over = np.maximum(frame - knee, 0)
    frame = np.where(frame > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), frame)
    path = os.path.join(args.out, 'a-first-lineart.png')
    cv2.imwrite(path, cv2.cvtColor((np.clip(frame * vignette, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
    print('wrote', path)


if __name__ == '__main__':
    main()
