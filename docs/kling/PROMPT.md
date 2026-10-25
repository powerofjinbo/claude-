# 用可灵生成"睁眼 + Welcome back"那一段

参考帧（1920×1080，深色背景，和光线勾勒的开场是同一套图层）：

- `start-eyes-closed.png`：首帧，闭眼
- `end-eyes-open.png`：尾帧，睁眼（可选）

## 设置

- 图生视频，**首尾帧**模式：首帧 `start-eyes-closed.png`，尾帧可不传（只传首帧动作更自然），想严格收在原图就传 `end-eyes-open.png`
- 比例 16:9，时长 5 秒（想更从容选 10 秒），专业 / 高品质模式
- 创意相关性（cfg）偏高一点，比如 0.6～0.7，防止人物跑形
- 运镜：固定镜头

## 正向提示词

```
动漫风格的橙发少女，正面半身，静止固定机位。开始时双眼轻闭、神情安静，
约1秒后睫毛轻轻颤动，缓缓睁开眼睛，琥珀色瞳孔里有柔和的高光；
睁眼后目光看向镜头，露出温柔的微笑，嘴唇自然地开合，像在轻声说 "Welcome back"，
说完后保持甜美的微笑并自然眨一次眼。
长发被微风轻轻吹动，发丝末端和鬓角细碎发丝有细腻的飘动，头上的花饰与流苏随之轻轻摇晃，
胸口有轻微的呼吸起伏，头部有极轻微的自然晃动。
暖橙色烛光从侧面照亮，背景是虚化的暗色烛光与光斑，画面干净、通透、高细节，
线条清晰，二次元赛璐璐质感，动作流畅自然，60帧般顺滑。
```

## 负向提示词

```
镜头移动, 镜头推拉, 转场, 变形, 五官扭曲, 多余的手, 手指畸形, 换脸, 人物走动,
剧烈动作, 大幅转头, 头发静止僵硬, 闪烁, 噪点, 模糊, 低清晰度, 文字, 水印, 字幕, 写实风格, 3D
```

## English version (if you prefer)

```
Anime girl with long orange hair, front-facing upper body, static locked-off camera.
She starts with her eyes gently closed and a calm expression. After about one second her
eyelashes flutter and she slowly opens her eyes, amber irises with soft highlights.
She looks at the camera, gives a gentle warm smile, and her lips move naturally as if softly
saying "Welcome back", then keeps a sweet smile and blinks once naturally.
Her long hair sways softly in a light breeze, fine strands at the tips and around the face
flutter delicately, the flower hair ornament and tassels sway slightly, subtle breathing
motion in the chest, very slight natural head movement. Warm orange candlelight from the side,
dark blurred candle-light bokeh background, clean, crisp, highly detailed cel-shaded anime
style, smooth fluid animation.
```

Negative: `camera movement, zoom, cut, morphing, distorted face, extra hands, deformed fingers,
face change, walking, large head turn, frozen hair, flicker, noise, blur, low resolution, text,
watermark, subtitles, realistic, 3d`

## 生成之后

挑一段满意的 mp4 发给我（或者放进仓库 `assets/kling.mp4`）。我会：

1. 用它的第一帧重新跑线稿，光线勾勒 → 过曝 → 上色之后**无缝接进**可灵这段
2. 按她嘴型的时间对齐 "Welcome back!" 语音
3. 重新导出 `assets/boot.mp4`，启动器不用改
