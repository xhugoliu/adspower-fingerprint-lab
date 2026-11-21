# 2026-11-21 · WebGL 多图案与透明度复测

在[多 Profile 对照](2026-11-21-multiprofile.md)后，扩展测试图案的尺寸和绘制方式，比较 WebGL 数组直读与 PNG 解码得到的像素值。随后增加半透明场景，检查 PNG 能保留透明度时两条路径的读数。

## 四种补充图案

同一台 Apple M4 Mac 上运行 AdsPower Global `8.9.23`、补丁 `2.9.0.2`、SunBrowser `157.0.8103.15`。保持 Canvas 和 WebGL metadata 为 Real，仅切换 WebGL Image。下文的 Real 基线来自同一 profile、同一图案关闭图像噪声时的采样。每种模式启动两次，每次采三页，覆盖主页面、两类 iframe 和 Dedicated Worker。

画布设为 `preserveDrawingBuffer:true`。数组直读用 `readPixels()` 写入 `Uint8Array`。PNG 在窗口用 `toDataURL()`、在 Worker 用 `convertToBlob()`，比较解码后的 RGBA。Canvas 2D 使用 `drawImage()` 后再读像素。WebGL 2 的像素缓冲区路径用 `readPixels()` 的偏移量形式写入已绑定的 `PIXEL_PACK_BUFFER`，再用 `getBufferSubData()` 取出。所有读数统一到以图像左上角为原点的行顺序。

| 图案 | 开启噪声后数组直读 | 开启噪声后 PNG 解码 |
| --- | --- | --- |
| `40 × 24` 分段清屏 | 46/46 次与基线一致 | 46/46 次与基线一致 |
| `16 × 12` 小图着色器 | 46/46 次左下角像素值与基线不同 | 46/46 次与基线一致 |
| `193 × 107` 裁剪着色器 | 46/46 次左下角像素值与基线不同 | 46/46 次与基线一致 |
| `127 × 73` 纹理上传后绘制 | 46/46 次左下角像素值与基线不同 | 46/46 次与基线一致 |

后三种图案的数组里，各次只有左下角一个像素值与基线不同。四种图案开噪声后共 184 次有效 PNG 导出，解码后的 RGBA 全部与 Real 基线逐像素一致。Canvas 2D 复制和像素缓冲区也与各自基线一致。Real 和 Noise 组各有一个同源 iframe 超时，统计时已排除。

数组直读的颜色与透明度都发生了变化。小图着色器、裁剪着色器和纹理图案的 Real 左下角分别为 `[17, 31, 47, 255]`、`[35, 106, 213, 255]` 和 `[19, 137, 247, 255]`。开启噪声时，三种图案的数组在该位置均读到 `[55, 55, 50, 53]`。这四种画布使用 `alpha:false`，下面另测实际保留透明度的画布。 [WebGL 上下文属性](https://registry.khronos.org/webgl/specs/latest/1.0/#WEBGLCONTEXTATTRIBUTES)

## 保留透明度的对照

独立新建一个同版本测试 profile，Canvas 和 WebGL metadata 保持 Real。画布改用 `alpha:true`、`premultipliedAlpha:false`，实际读回的上下文属性也与之相符。`32 × 24` 的着色器图案交替绘制 `[255, 0, 255, 128]` 与 `[0, 255, 0, 64]` 两种半透明像素，左下角为前者。RGB 使用 0 和 255，便于检查颜色与透明度在各路径的取值。每种模式启动两次，每次采三页，四个执行上下文和两代 API 的结果均完整。 [WebGL 与 Canvas 的透明度处理](https://registry.khronos.org/webgl/specs/latest/1.0/#PREMULTIPLIED_ALPHA)

Real 组所有路径的全图 RGBA 均与预期一致，左下角为 `[255, 0, 255, 128]`。下表比较同一场景在开启噪声后的输出。

| 读取路径 | Noise 左下角 RGBA | Noise 全图与 Real 比对 |
| --- | --- | --- |
| `readPixels()` 写入数组 | `[54, 57, 48, 57]` | 48/48 次只有这一个像素不同，四个通道都变了。重复直读得到相同结果。 |
| 窗口 `toDataURL()` PNG 解码，含主页面和两类 iframe | `[255, 0, 255, 128]` | 36/36 次有 14 个其他位置的像素不同。各次共 14 个通道值变化，最大差值为 1。 |
| Worker `convertToBlob()` PNG 解码 | `[255, 0, 255, 128]` | 12/12 次逐像素与 Real 一致。 |
| Canvas 2D 复制 | `[255, 0, 255, 128]` | 48/48 次逐像素与 Real 一致。 |
| WebGL 2 像素缓冲区 | `[255, 0, 255, 128]` | 24/24 次逐像素与 Real 一致。 |

窗口 PNG 仍保留了左下角的原 RGBA。完整图像比对检出了其他位置的变化，例如坐标 `(1, 0)` 的 alpha 从 `128` 变为 `129`，`(0, 2)` 从 `64` 变为 `65`。窗口 PNG 和数组直读的差异位置及幅度不同。此对照同时变换了导出接口和执行环境，结果适用于表中两种 PNG 组合。实验记录的是接口输出，改写位置需结合实现确认。

在另一个独立新建的同版本 profile 中，用相同的绘制和读取路径复核，并逐通道统计相对于预期值的差值。Noise 下窗口 PNG 的 18/18 次解码结果均有 14 个像素的 alpha 加 1，RGB 全部一致。Worker 的 6/6 次 PNG 与预期逐像素一致。Real 组有一次跨源 iframe 超时，共缺两代 API 的读数，其余 22 次 PNG 均与预期一致。

## 公开实现示例

FingerprintJS 2.1.4 将 `toDataURL()` 得到的 WebGL 画布图像纳入指纹输入。CreepJS 的 WebGL 模块同时采集图像数据 URL 和 `readPixels()` 的数组值。这两份源码说明已测接口有实际的公开用例，线上采用比例和跨设备区分能力需独立测量。 [FingerprintJS 2.1.4](https://raw.githubusercontent.com/fingerprintjs/fingerprintjs/2.1.4/fingerprint2.js#L981) · [CreepJS WebGL 采集](https://github.com/abrahamjuliot/creepjs/blob/10aa6724cd33a1015db1574211890518cd04f0cc/src/webgl/index.ts#L337-L381)

## 复测入口

在[本机探针](../tools/probe/README.md)里勾选「追加 WebGL 尺寸、纹理和透明度场景」。对选择不同 WebGL Image 设置的两个批次，同时核对单点样本和全图差异。

```sh
python3 tools/probe/compare.py samples.jsonl alpha-real-1 alpha-noise-1 \
  --field top.graphics.scenes.semi-transparent.webgl2.readPixels.samplePixel \
  --field top.graphics.scenes.semi-transparent.webgl2.png.samplePixel \
  --field top.graphics.scenes.semi-transparent.webgl2.png.againstExpected \
  --field worker.graphics.scenes.semi-transparent.webgl2.png.againstExpected
```
