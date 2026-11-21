# 2026-11-21 · AdsPower 多 Profile 对照

沿用[指纹配置组合复测](2026-11-21-limits.md)，用独立新建的三个桌面 profile 比较 WebGL 图像噪声开启时的回读值，以及同一种回读差异能否跨配置复现。

## 环境与方法

同一台 Apple M4 Mac，AdsPower Global `8.9.23`、补丁 `2.9.0.2`、SunBrowser `157.0.8103.15`。独立新建 `FP-Multi-A`、`FP-Multi-B`、`FP-Multi-C`。UA、屏幕自定义尺寸 `1440 × 900`、Canvas Real、WebGL metadata Real 和默认字体设置一致。

用[本机探针](../tools/probe/README.md)对每个 profile 依次采集 WebGL Image Real、WebGL Image Noise，以及保持噪声设置后切换到自定义字体列表的结果。每组独立启动两次，每次采三页，读取主页面、同源 iframe、跨源 iframe 和 Dedicated Worker。字体组核对保存后的名单，三份名单均排除 `PingFang SC` 和 `PingFangSC-Regular`，保留 Arial 阳性对照。三个配置依次运行。

## WebGL 噪声值与回读路径

WebGL 1 和 2 在 `alpha:false` 的画布上分别画 `96 × 64` 的分段清屏图案和确定性着色器图案。同一 profile 以 Real 模式输出为基线，统一行顺序后逐像素比较数组直读及重复直读、PNG 解码、Canvas 2D 复制、WebGL 2 像素缓冲区回读。

| Profile | Real 有效上下文 | Noise 有效上下文 | Noise 数组回读 RGBA | 与 Real 基线不同的位置 |
| --- | --- | --- | --- | --- |
| A | 24/24 | 24/24 | `[56, 56, 54, 48]` | `(0, 63)` |
| B | 23/24 | 21/24 | `[56, 55, 51, 48]` | `(0, 63)` |
| C | 23/24 | 23/24 | `[57, 56, 53, 49]` | `(0, 63)` |

坐标以图像左上角为原点，基线像素值为 `[17, 31, 47, 255]`。三个 profile 的 Real 组共 70 个有效上下文，全部 1260 次回读都与预期一致。Noise 组共 68 个有效上下文，WebGL 1 和 WebGL 2 的着色器图案数组直读和重复读取合计 272 次，每次均只有上表位置的 RGBA 与基线不同。两次重开后，同一 profile 的值保持稳定，三个 profile 之间的值各不相同。

Noise 组另外 952 次取到的 RGBA 与各自的 Real 基线完全一致，其中 612 次属于清屏图案，340 次属于着色器图案的 PNG 解码、Canvas 2D 复制及像素缓冲区。三个 profile 均出现相同的回读路径差异。确定性图案用于验证像素值的差异，跨设备的图形指纹区分能力需另行测量。

## 屏幕与字体

跨三组设置共取得 155 个有效窗口上下文。三个 profile 的 `screen` 属性和原型 getter 均为 `720 × 450`，`matchMedia()` 和实际应用的 CSS 规则均为 `1440 × 900`，DPR 均为 2。

| Profile | 自定义字体名单项数 | 普通 DOM 度量可识别苹方 | Canvas 度量可识别苹方 | 按 PostScript 名称加载并渲染 |
| --- | --- | --- | --- | --- |
| A | 592 | 0/15 | 0/23 | 23/23 |
| B | 298 | 0/16 | 0/24 | 24/24 |
| C | 248 | 0/16 | 0/24 | 24/24 |

三个 profile 处于默认字体模式时，所有可测的普通度量都能识别苹方。改用排除苹方的自定义名单后，DOM 与 Canvas 全部回退，`local('PingFangSC-Regular')` 仍在 71/71 个有效上下文加载并实际渲染。所测字符的度量向量在三个 profile、两种字体模式和四类上下文中完全相同。保存字体设置前后，三个 profile 各自的 WebGL 噪声码以及数组直读的摘要都保持一致。

## 样本与收尾

本轮共 18 批、54 页，216 个执行上下文收到 209 个结果，7 个 iframe 超时。原有配置之外创建的三个测试 profile 均移入回收站。本轮覆盖同一 Mac 和内核上的顺序启动。

原始样本使用 `multi-a-real-1`、`multi-a-noise-1`、`multi-a-font-1` 等标签。此命令比较两个 profile 开启噪声后的数组直读和 PNG 输出。

```sh
python3 tools/probe/compare.py samples.jsonl multi-a-noise-1 multi-b-noise-1 \
  --field top.graphics.webgl2.shader.readPixels --field top.graphics.webgl2.shader.png
```
