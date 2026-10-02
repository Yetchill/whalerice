# Whale Rice 0.2.1 素材记录

角色保持蓝发、鲸鱼耳、尾巴与蓝白女仆装的身份特征，并采用更圆润的 Q 版比例。各姿态保持一致的普通眼神和简单表情，只有入口时闭眼张嘴，吃完闭嘴并在脸上留一粒米。饭碗、熟米饭、持勺手和勺子与人物一起绘制在每一张透明 PNG 中。运行时按当前余额保留对应饭量图的碗区域，再绘制动作帧中的人物、表情与持勺手。

所有新素材均使用 Codex 内置 `imagegen` 单张生成，设置 `transparent_background: true`。每个动作对应独立文件，没有使用网格图或精灵图切割。完整生成方法、文件名和逐张提示词保存在 [assets/frames/generation.json](assets/frames/generation.json)。

## 静止饭量

| 文件 | 用途 |
| --- | --- |
| `assets/frames/idle-full.png` | 满碗，持勺停在饭碗边缘，普通眼神与自然闭嘴表情 |
| `assets/frames/idle-half.png` | 半碗，露出碗内壁 |
| `assets/frames/idle-low.png` | 碗底薄薄一层米饭 |
| `assets/frames/idle-empty.png` | 空碗，显示干净的陶瓷内部 |

米饭按蓬松的熟短粒米表现，使用细长米粒、暖色高光和米粒间阴影。四张静止图用于离散饭量档位，没有逐粒米的物理模拟。

## 吃饭动作

| 文件 | 姿态与表情 |
| --- | --- |
| `assets/frames/eat-01.png` | 持勺待机；复用 `idle-full.png`，作为动作起点和回位姿态 |
| `assets/frames/eat-02.png` | 勺子探入米饭，保持普通眼神与闭嘴表情 |
| `assets/frames/eat-02b.png` | 刚舀起一口，满勺米饭停在碗上方，嘴仍闭着 |
| `assets/frames/eat-03.png` | 抬起一勺米饭，向嘴边移动 |
| `assets/frames/eat-03b.png` | 勺子靠近嘴唇，保持普通眼神与闭嘴表情 |
| `assets/frames/eat-04.png` | 米饭与嘴接触，闭眼张嘴吃下一口 |
| `assets/frames/eat-05.png` | 吃完恢复普通眼神、闭嘴，勺子离开嘴边，脸上留一粒米 |

吃饭序列使用七个姿态文件，其中 `eat-01.png` 复用满碗静止图，其他六个动作帧独立生成；加上四张静止饭量图，共十张独立生成的图像、十一个运行时 PNG 文件。运行时按时间顺序直接切换动作帧，`eat-02b.png` 和 `eat-03b.png` 衔接舀饭与送到嘴边的过程；收尾重复停留在 `eat-05.png`，随后回到 `eat-01.png`，总动作约 1.36 秒。动画期间保留当前余额对应的碗与饭量，结束后回到静止图。

生成提示词要求沿用同一角色参考、画布尺寸、构图、头发和尾巴轮廓、服装、饭碗位置、持碗手和光照；吃饭帧主要改变表情与持勺手，饭量帧主要改变碗内米饭。各帧都是完整的透明插画。

## 其他文件

`assets/whale.png` 是上一版用内置 imagegen 生成的透明角色图，目前用于托盘图标；桌面人物显示使用 `assets/frames/` 下的新素材。

素材为非官方鲸鱼娘风格插画。社区形象背景参考：[deepseek-whalechan](https://github.com/Neko3000/deepseek-whalechan)。

