"""Real-ESRGAN（RealESRGAN_x4plus_anime_6B）4× 放大，不依赖 torch。

.pth 是 torch 的 zip 存档：自己解 pickle 拿出权重 → 用 onnx 拼出 RRDBNet → onnxruntime 跑。
模型第一次用时从 GitHub release 下载到 tools/.cache/。

  python tools/upscale.py in.png out.png
"""
import io
import os
import pickle
import sys
import urllib.request
import zipfile

import numpy as np

URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth'
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')


def _fetch():
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, os.path.basename(URL))
    if not os.path.exists(path):
        print('downloading', URL, flush=True)
        urllib.request.urlretrieve(URL, path + '.part')
        os.replace(path + '.part', path)
    return path


def load_pth(path):
    """最小 torch 存档读取器：只认 float32 张量。"""
    z = zipfile.ZipFile(path)
    prefix = z.namelist()[0].split('/')[0]
    dtypes = {'FloatStorage': np.float32, 'HalfStorage': np.float16}

    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if name == '_rebuild_tensor_v2':
                def rebuild(storage, offset, size, stride, *_):
                    arr, = storage
                    n = int(np.prod(size)) if size else 1
                    flat = arr[offset:offset + max(n, 1) + (int(np.dot(np.array(size) - 1, stride)) if size else 0)]
                    return np.lib.stride_tricks.as_strided(flat, size, [s * flat.itemsize for s in stride]).copy()
                return rebuild
            if name == 'OrderedDict':
                from collections import OrderedDict
                return OrderedDict
            if name in dtypes:
                return dtypes[name]
            return super().find_class(mod, name)

        def persistent_load(self, pid):
            _, dtype, key, _loc, _n = pid
            raw = z.read(f'{prefix}/data/{key}')
            return (np.frombuffer(raw, dtype),)

    state = U(io.BytesIO(z.read(f'{prefix}/data.pkl'))).load()
    return state.get('params_ema') or state.get('params') or state


def build_model(w, num_block=6):
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    nodes, inits = [], []
    counter = [0]

    def name(p):
        counter[0] += 1
        return f'{p}_{counter[0]}'

    def const(arr):
        n = name('c')
        inits.append(numpy_helper.from_array(np.asarray(arr, np.float32), n))
        return n

    def conv(x, key):
        wn, bn = name('w'), name('b')
        inits.append(numpy_helper.from_array(w[key + '.weight'].astype(np.float32), wn))
        inits.append(numpy_helper.from_array(w[key + '.bias'].astype(np.float32), bn))
        y = name('conv')
        nodes.append(helper.make_node('Conv', [x, wn, bn], [y], pads=[1, 1, 1, 1], kernel_shape=[3, 3]))
        return y

    def lrelu(x):
        y = name('lr')
        nodes.append(helper.make_node('LeakyRelu', [x], [y], alpha=0.2))
        return y

    def op(t, *xs, **kw):
        y = name(t.lower())
        nodes.append(helper.make_node(t, list(xs), [y], **kw))
        return y

    def rdb(x, key):
        feats = [x]
        for i in range(1, 5):
            inp = feats[0] if len(feats) == 1 else op('Concat', *feats, axis=1)
            feats.append(lrelu(conv(inp, f'{key}.conv{i}')))
        x5 = conv(op('Concat', *feats, axis=1), f'{key}.conv5')
        return op('Add', op('Mul', x5, const(0.2)), x)

    def up(x):
        scales = const([1, 1, 2, 2])
        return op('Resize', x, '', scales, mode='nearest')

    feat = conv('input', 'conv_first')
    body = feat
    for b in range(num_block):
        o = body
        for r in (1, 2, 3):
            o = rdb(o, f'body.{b}.rdb{r}')
        body = op('Add', op('Mul', o, const(0.2)), body)
    feat = op('Add', feat, conv(body, 'conv_body'))
    feat = lrelu(conv(up(feat), 'conv_up1'))
    feat = lrelu(conv(up(feat), 'conv_up2'))
    out = conv(lrelu(conv(feat, 'conv_hr')), 'conv_last')
    nodes.append(helper.make_node('Identity', [out], ['output']))
    graph = helper.make_graph(
        nodes, 'rrdbnet',
        [helper.make_tensor_value_info('input', TensorProto.FLOAT, [1, 3, None, None])],
        [helper.make_tensor_value_info('output', TensorProto.FLOAT, [1, 3, None, None])],
        inits,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)])
    model.ir_version = 8
    return model.SerializeToString()


def upscale(rgb):
    """rgb: HxWx3 uint8 → (4H)x(4W)x3 uint8"""
    import onnxruntime as ort

    sess = ort.InferenceSession(build_model(load_pth(_fetch())), providers=['CPUExecutionProvider'])
    x = rgb.astype(np.float32).transpose(2, 0, 1)[None] / 255
    y = sess.run(None, {'input': x})[0][0]
    return np.clip(y.transpose(1, 2, 0) * 255 + 0.5, 0, 255).astype(np.uint8)


if __name__ == '__main__':
    from PIL import Image
    im = np.array(Image.open(sys.argv[1]).convert('RGB'))
    Image.fromarray(upscale(im)).save(sys.argv[2])
