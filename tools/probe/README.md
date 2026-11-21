# 本机采集与对比

这套脚本根据 [2026-11-20 的实验记录](../../experiments/2026-11-20.md) 重建。默认字体表是可替换的候选集，复测时请记录使用的字体表和浏览器版本。

## 采集

需要 Python 3 和受测浏览器。服务绑定 `127.0.0.1`，用 `localhost` 和 `127.0.0.1` 构造两个浏览器源。

```sh
python3 tools/probe/serve.py --port 8765 --output /tmp/adspower-probe.jsonl
```

1. 在受测浏览器打开终端显示的地址。输入实验标签，例如 `baseline`，选择采样次数，开始采集。
2. 用同一套参数修改目标设置并重开配置。用新的标签，例如 `custom-resolution`，再次采集。
3. 等到页面显示全部样本已保存后进行比较。同一个标签下可以有多个采样批次，用于检查跨重启稳定性。

每个样本会读取主页面、同源 iframe、跨源 iframe 和 Dedicated Worker 支持的 API。其中包括 JavaScript 和 HTTP 浏览器标识、时区、屏幕与 CSS 尺寸、字体、音频、Canvas、WebGL/WebGL 2。WebGL 可选择着色器或分段清屏。PNG 在页面中用 `toDataURL()`，在 Worker 中用 `convertToBlob()`，摘要应在同一读取路径内比较。iframe 布局不可读时，字体会记录为 `FontLayoutUnavailable`。

WebRTC 使用未配置 STUN 的本地连接，保存候选类别。定位默认只查询权限状态，勾选对应选项后会请求定位并记录结果类型。存储复测需要勾选测试存储，并在重开浏览器前后使用同一个服务进程和端口。完成后可以通过页面链接清除测试标记。

如需固定字体候选集，启动时增加 `--fonts /path/to/fonts.json`。文件内容是字体族名称的 JSON 数组。

## 屏幕、字体和 WebGL 复测

勾选「复测屏幕、字体及 WebGL 读取路径」。这项模式会同时采集分段清屏和着色器场景，保存以下读数。

- 屏幕宽高分别从 `screen`、`Screen.prototype` getter、`matchMedia()` 和实际应用的 CSS `@media` 规则读取。对照保留 DPR、视口宽高和页面缩放。
- 字体分别通过 DOM 文本尺寸、Canvas `measureText()` 和 `FontFace local()` 探测，并附上 Arial 和不存在字体的对照。`localRender` 将字体族名称和 PostScript 名称分开测试。加载成功后把字体注册到 `FontFaceSet`，保存 Canvas 度量以对比同机基线。`null` 表示该路径在当前上下文不可测。
- WebGL 比较普通 `readPixels()`、同一路径的重复读取、向 Canvas 2D 复制、解码后的 PNG 以及 WebGL 2 像素缓冲区。每种结果都与预期 RGBA 逐像素比较，统一到相同的行顺序。

每组用新的标签。每次重开后采三页，并保持 Chrome 对照窗口和 AdsPower 的页面缩放为 100%。复测屏幕时，仅改变分辨率。复测 WebGL 时，仅开启 WebGL 图像噪声，并把 Canvas 保持在 Real。复测字体时，记录候选集中实际从列表移除的字体。

## 对比

```sh
python3 tools/probe/compare.py /tmp/adspower-probe.jsonl baseline custom-resolution --field top.screen
```

省略 `--field` 会检查全部字段，也可以重复指定多个字段前缀。脚本按实验标签、批次和样本序号取第一条记录，并报告两组之间的变化和组内波动。输出文件由 `--output` 指定，复测日志可按需要单独留存。
