# 用可灵生成开机动画（推荐：一段 10 秒，一镜到底）

## 第一步：生成视频

- 首帧 `a-first-lineart.png`（彩色霓虹线稿），尾帧 `end-eyes-open.png`（睁眼）
  —— 尾帧要用睁眼版，否则可灵会让她睁眼后最后一帧又跳回闭眼
- 16:9，**10 秒**，专业 / 高品质模式，固定镜头，创意相关性 0.5
- **关掉**「生成音频 / 音效 / 配乐」

正向提示词：

```
赛博朋克霓虹光影风格的动漫开场动画，静止固定机位，全程一镜到底、动作连续流畅、没有任何停顿和卡顿。

【0–3秒】纯黑背景中，少女的线稿轮廓由五彩霓虹光线构成：青蓝、电光紫、品红、粉色、橙金色，
颜色沿着发丝从上到下渐变。光线像电流一样沿着每一根发丝、衣领蕾丝、蝴蝶结和花饰流动、明暗闪烁，
几条彩色霓虹光带从画面左右两侧划过、在她身边缠绕盘旋，细小的彩色光粒子不断向上飘散。
线条始终保持鲜艳的彩色，不要变成单色。

【3–5秒】彩色线条越来越亮，整个轮廓泛起柔和的白色辉光，光芒中颜色一层层从线条里渗透出来：
橙红色长发、白皙的皮肤、白色蕾丝衣领、黑色蝴蝶结、金色花饰与白色流苏依次上色，
背景亮起温暖的暗红色烛光与虚化光斑。少女双眼紧闭，神情安静。

【5–6.5秒】完整上色的少女，双眼依然闭着，长发被微风轻轻吹动，发梢细碎飘动，胸口有轻微的呼吸起伏。

【6.5–8.5秒】她非常缓慢、连续地睁开眼睛：先是睫毛轻轻颤动，上眼皮一点一点平滑地抬起，
琥珀色的瞳孔逐渐露出、亮起柔和的高光，整个睁眼过程匀速、一气呵成，持续约两秒，
中途不停顿、不反复、不再闭上。

【8.5–10秒】睁开眼后目光温柔地看向镜头，嘴角微微上扬露出浅浅的微笑，嘴唇自然放松、
可以轻轻开合，头发和流苏继续随风轻轻摆动。

整体：二次元赛璐璐画风，线条清晰、高细节、色彩绚丽，光影过渡柔和，动作像60帧一样顺滑，
人物五官、发型、服装和参考图完全一致。
```

负向提示词：

```
停顿, 卡顿, 跳帧, 定格, 慢动作抽帧, 闪回, 画面突变, 转场硬切, 睁眼又闭眼, 反复眨眼, 眼睛忽开忽闭,
单色线条, 白色线条开场, 镜头移动, 镜头推拉, 变形, 五官扭曲, 换脸, 头部大幅转动, 人物动作过大,
多余的手, 写实风格, 3D, 文字, 水印, 字幕, 噪点, 闪烁过度, 低清晰度
```

## 第二步：对口型

可灵「对口型」→ 上传第一步的视频 → 文本朗读：`Welcome back!`，英文年轻女声（温柔 / 甜美），
语速约 0.9 倍；能选起始时间就放在约 8.5 秒（刚睁开眼之后）。

---

以下是之前分两段生成的做法（留作参考）。

## 分段做法

整段分三截，接缝处的画面完全一致，所以拼起来是一镜到底：

| 段 | 谁生成 | 首帧 → 尾帧 | 内容 |
| --- | --- | --- | --- |
| 0 | 我（tools/render_boot.py） | 黑场 → `a-first-lineart.png` | 霓虹光带扫过，光线按笔画一笔一笔描出轮廓 |
| A | 可灵 | `a-first-lineart.png` → `start-eyes-closed.png` | 线稿流光、过曝成白光，颜色从线条里渗出来，闭着眼 |
| B | 可灵（已生成：`assets/kling/awake.mp4`） | `start-eyes-closed.png` → 自由 | 睁眼、微笑、说 Welcome back |

## A 段：光线 → 上色（首尾帧）

- 首帧 `a-first-lineart.png`，尾帧 `start-eyes-closed.png`（两张都要传）
- 16:9，5 秒，专业 / 高品质模式，固定镜头，创意相关性 0.5～0.6

正向提示词：

```
赛博朋克风格的霓虹光影动画，静止固定机位。黑色背景中，由青色、紫色、品红、橙金色霓虹光线勾勒出的
动漫少女线稿轮廓，线条像电流一样沿着发丝和衣褶流动、明暗闪烁，几条彩色霓虹光带从画面两侧划过、
缠绕在她身边，细小的光粒子和光点向上飘散。随后线条越来越亮，整个轮廓过曝成柔和的白色辉光，
光芒中颜色一层层从线条里渗透出来：橙色长发、白色蕾丝衣领、黑色蝴蝶结、花饰与流苏逐渐上色，
背景亮起温暖的暗红色烛光虚化光斑。少女全程双眼紧闭、神情安静，长发被微风轻轻吹动。
最终定格为完整上色的闭眼少女。二次元赛璐璐风格，高细节，光影绚丽，过渡流畅。
```

负向提示词：

```
镜头移动, 镜头推拉, 转场硬切, 睁眼, 变形, 五官扭曲, 换脸, 人物动作过大, 多余的手, 写实风格, 3D,
文字, 水印, 字幕, 噪点, 闪烁过度, 低清晰度
```

## B 段：睁眼 + Welcome back（已经生成好了）

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

A 段生成好发给我。我会把 0 → A → B 三截拼成一段、去掉 B 段最后一秒的杂音、
按 B 段嘴型对齐 "Welcome back!" 女声，重新导出 `assets/boot.mp4`，启动器不用改。
