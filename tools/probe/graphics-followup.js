'use strict';

(() => {
    const scenarios = [
        {name: 'clear-bands', width: 40, height: 24},
        {name: 'small-shader', width: 16, height: 12},
        {name: 'clipped-shader', width: 193, height: 107},
        {name: 'texture-upload', width: 127, height: 73},
        {name: 'semi-transparent', width: 32, height: 24},
    ];
    const clearColors = [
        [255, 0, 0], [0, 255, 255], [255, 255, 0], [0, 255, 0],
        [0, 0, 255], [255, 0, 255], [0, 0, 0], [255, 255, 255],
    ];
    const borderColor = [35, 106, 213, 255];

    function requireNoGlError(gl, operation) {
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw new Error(operation + ' returned WebGL error ' + error);
    }

    async function readScenario({name, width, height}) {
        const byteLength = width * height * 4;
        const bandWidth = width / 4;
        const bandHeight = height / 2;
        const clipped = name === 'clipped-shader';
        const textured = name === 'texture-upload';
        const alpha = name === 'semi-transparent';
        const semiTransparentColors = [[255, 0, 255, 128], [0, 255, 0, 64]];

        function makeCanvas() {
            if (typeof document === 'undefined') return new OffscreenCanvas(width, height);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            return canvas;
        }

        function drawClear(gl) {
            gl.enable(gl.SCISSOR_TEST);
            for (const [index, [r, g, b]] of clearColors.entries()) {
                gl.scissor((index % 4) * bandWidth, Math.floor(index / 4) * bandHeight, bandWidth, bandHeight);
                gl.clearColor(r / 255, g / 255, b / 255, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            gl.disable(gl.SCISSOR_TEST);
        }

        function pattern(x, y) {
            if (alpha) return semiTransparentColors[(x + y) % 2];
            if (textured) return [(17 * x + 31 * y + 19) % 256, (5 * x + 7 * y + 137) % 256,
                (29 * x + y + 247) % 256, 255];
            if (clipped) {
                if (x < 3 || x >= width - 3 || y < 5 || y >= height - 5) return borderColor;
                return [(23 * x + 7 * y + 39) % 256, (11 * x + 13 * y + 47) % 256,
                    (5 * x + 29 * y + 79) % 256, 255];
            }
            return [(13 * x + 5 * y + 17) % 256, (7 * x + 11 * y + 31) % 256,
                (3 * x + 19 * y + 47) % 256, 255];
        }

        function makeTexture(gl) {
            const pixels = new Uint8Array(byteLength);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) pixels.set(pattern(x, y), 4 * (y * width + x));
            }
            const texture = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return texture;
        }

        function drawShader(gl, webgl2) {
            const version = webgl2 ? '#version 300 es\n' : '';
            const vertexInput = webgl2 ? 'in' : 'attribute';
            const declaration = webgl2 ? 'out vec4 color;' : '';
            const output = webgl2 ? 'color' : 'gl_FragColor';
            const textureCall = webgl2 ? 'texture' : 'texture2D';
            function compile(type, source) {
                const shader = gl.createShader(type);
                gl.shaderSource(shader, version + source);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    throw new Error('Shader did not compile: ' + gl.getShaderInfoLog(shader));
                }
                return shader;
            }

            const vertex = compile(gl.VERTEX_SHADER,
                vertexInput + ' vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }');
            let fragmentValue;
            if (textured) {
                fragmentValue = `${textureCall}(sourceImage, gl_FragCoord.xy / vec2(${width}.0, ${height}.0))`;
            } else if (clipped) {
                fragmentValue = `vec4(mod(23.0 * p.x + 7.0 * p.y + 39.0, 256.0),
                    mod(11.0 * p.x + 13.0 * p.y + 47.0, 256.0),
                    mod(5.0 * p.x + 29.0 * p.y + 79.0, 256.0), 255.0) / 255.0`;
            } else if (alpha) {
                const colors = semiTransparentColors.map(channels => 'vec4(' + channels.map(value => value + '.0').join(', ') + ')');
                fragmentValue = `(mod(p.x + p.y, 2.0) < 1.0 ? ${colors[0]} : ${colors[1]}) / 255.0`;
            } else {
                fragmentValue = `vec4(mod(13.0 * p.x + 5.0 * p.y + 17.0, 256.0),
                    mod(7.0 * p.x + 11.0 * p.y + 31.0, 256.0),
                    mod(3.0 * p.x + 19.0 * p.y + 47.0, 256.0), 255.0) / 255.0`;
            }
            const fragment = compile(gl.FRAGMENT_SHADER, `
                precision highp float;
                ${declaration}
                uniform sampler2D sourceImage;
                void main() {
                    vec2 p = floor(gl_FragCoord.xy);
                    ${output} = ${fragmentValue};
                }
            `);
            const program = gl.createProgram();
            gl.attachShader(program, vertex);
            gl.attachShader(program, fragment);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader did not link');
            gl.useProgram(program);
            const vertices = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            const attribute = gl.getAttribLocation(program, 'position');
            gl.enableVertexAttribArray(attribute);
            gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
            let texture;
            if (textured) {
                texture = makeTexture(gl);
                gl.uniform1i(gl.getUniformLocation(program, 'sourceImage'), 0);
            }
            if (clipped) {
                gl.clearColor(borderColor[0] / 255, borderColor[1] / 255, borderColor[2] / 255, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.enable(gl.SCISSOR_TEST);
                gl.scissor(3, 5, width - 6, height - 10);
            }
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            if (clipped) gl.disable(gl.SCISSOR_TEST);
            if (texture) gl.deleteTexture(texture);
            gl.disableVertexAttribArray(attribute);
            gl.deleteBuffer(vertices);
            gl.deleteProgram(program);
            gl.deleteShader(vertex);
            gl.deleteShader(fragment);
        }

        function expectedPixels(clearing) {
            const pixels = new Uint8Array(byteLength);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const glY = height - 1 - y;
                    const rgba = clearing
                        ? [...clearColors[Math.floor(glY / bandHeight) * 4 + Math.floor(x / bandWidth)], 255]
                        : pattern(x, glY);
                    pixels.set(rgba, 4 * (y * width + x));
                }
            }
            return pixels;
        }

        function topDown(bottomUp) {
            const pixels = new Uint8Array(byteLength);
            const stride = width * 4;
            for (let y = 0; y < height; y++) {
                const source = (height - 1 - y) * stride;
                pixels.set(bottomUp.subarray(source, source + stride), y * stride);
            }
            return pixels;
        }

        function readDirect(gl) {
            const pixels = new Uint8Array(byteLength);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            requireNoGlError(gl, 'readPixels to array');
            return topDown(pixels);
        }

        function readPixelPack(gl) {
            const buffer = gl.createBuffer();
            try {
                const pixels = new Uint8Array(byteLength);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
                gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLength, gl.STREAM_READ);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
                gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
                requireNoGlError(gl, 'WebGL 2 pixel-pack readback');
                return topDown(pixels);
            } finally {
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                gl.deleteBuffer(buffer);
            }
        }

        function readDrawImage(source) {
            const target = makeCanvas();
            const context = target.getContext('2d', {alpha, colorSpace: 'srgb', willReadFrequently: true});
            if (!context) throw new Error('Canvas 2D unavailable');
            context.imageSmoothingEnabled = false;
            context.drawImage(source, 0, 0);
            return context.getImageData(0, 0, width, height, {colorSpace: 'srgb'}).data;
        }

        function paeth(left, up, corner) {
            const prediction = left + up - corner;
            const leftDistance = Math.abs(prediction - left);
            const upDistance = Math.abs(prediction - up);
            const cornerDistance = Math.abs(prediction - corner);
            if (leftDistance <= upDistance && leftDistance <= cornerDistance) return left;
            return upDistance <= cornerDistance ? up : corner;
        }

        async function exportPng(canvas) {
            if (typeof canvas.convertToBlob === 'function') {
                const blob = await canvas.convertToBlob({type: 'image/png'});
                return new Uint8Array(await blob.arrayBuffer());
            }
            const prefix = 'data:image/png;base64,';
            const url = canvas.toDataURL('image/png');
            if (!url.startsWith(prefix)) throw new Error('PNG export unavailable');
            return Uint8Array.from(atob(url.slice(prefix.length)), byte => byte.charCodeAt(0));
        }

        async function decodePng(png) {
            const header = new DataView(png.buffer);
            if (png.length < 33 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a
                    || header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452
                    || header.getUint32(16) !== width || header.getUint32(20) !== height
                    || png[24] !== 8 || ![2, 6].includes(png[25]) || png[26] || png[27] || png[28]) {
                throw new Error('Expected noninterlaced 8-bit RGB or RGBA PNG');
            }
            const chunks = [];
            for (let offset = 8; offset + 12 <= png.length;) {
                const length = header.getUint32(offset);
                const type = header.getUint32(offset + 4);
                const end = offset + 12 + length;
                if (end > png.length) throw new Error('Incomplete PNG chunk');
                if (type === 0x49444154) chunks.push(png.subarray(offset + 8, end - 4));
                if (type === 0x49454e44) break;
                offset = end;
            }
            if (!chunks.length) throw new Error('PNG image data missing');
            // Decode IDAT and scanline filters directly so this path never uses Canvas 2D readback.
            const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream('deflate'));
            const scanlines = new Uint8Array(await new Response(stream).arrayBuffer());
            const channels = png[25] === 6 ? 4 : 3;
            const stride = width * channels;
            if (scanlines.length !== height * (stride + 1)) throw new Error('Unexpected PNG scanline count');
            const raw = new Uint8Array(height * stride);
            for (let y = 0; y < height; y++) {
                const filter = scanlines[y * (stride + 1)];
                if (filter > 4) throw new Error('Unknown PNG scanline filter');
                for (let x = 0; x < stride; x++) {
                    const index = y * stride + x;
                    const left = x >= channels ? raw[index - channels] : 0;
                    const up = y ? raw[index - stride] : 0;
                    const corner = y && x >= channels ? raw[index - stride - channels] : 0;
                    const prediction = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter];
                    raw[index] = scanlines[index + y + 1] + prediction;
                }
            }
            if (channels === 4) return raw;
            const rgba = new Uint8Array(byteLength);
            for (let pixel = 0; pixel < width * height; pixel++) {
                rgba.set(raw.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
                rgba[pixel * 4 + 3] = 255;
            }
            return rgba;
        }

        function difference(reference, measured, includeExamples = false) {
            let differentPixels = 0;
            let differentChannels = 0;
            let maxChannelDelta = 0;
            const examples = [];
            for (let index = 0; index < byteLength; index += 4) {
                let changed = false;
                for (let offset = 0; offset < 4; offset++) {
                    const delta = Math.abs(reference[index + offset] - measured[index + offset]);
                    if (!delta) continue;
                    changed = true;
                    differentChannels++;
                    maxChannelDelta = Math.max(maxChannelDelta, delta);
                }
                if (!changed) continue;
                differentPixels++;
                if (includeExamples && examples.length < 4) {
                    const pixel = index / 4;
                    examples.push({
                        x: pixel % width,
                        y: Math.floor(pixel / width),
                        reference: Array.from(reference.subarray(index, index + 4)),
                        measured: Array.from(measured.subarray(index, index + 4)),
                    });
                }
            }
            const counts = {differentPixels, differentChannels, maxChannelDelta};
            return includeExamples ? {...counts, examples} : counts;
        }

        async function measure(read) {
            try {
                return {pixels: await read()};
            } catch (error) {
                return {error: String(error.message || error.name)};
            }
        }

        async function describe(result, expected, direct) {
            if (result.error) return result;
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', result.pixels));
            const sha256 = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
            const summary = {sha256, againstExpected: difference(expected, result.pixels, true)};
            if (direct && result.pixels !== direct) summary.againstReadPixels = difference(direct, result.pixels);
            if (name) {
                const offset = (height - 1) * width * 4;
                summary.samplePixel = {
                    x: 0,
                    y: height - 1,
                    reference: Array.from(expected.subarray(offset, offset + 4)),
                    measured: Array.from(result.pixels.subarray(offset, offset + 4)),
                };
            }
            return summary;
        }

        async function measureScene(gl, canvas, scene, webgl2) {
            const clearing = scene === 'clear' || scene === 'clear-bands';
            try {
                if (clearing) drawClear(gl);
                else drawShader(gl, webgl2);
                requireNoGlError(gl, 'Draw ' + scene);
            } catch (error) {
                return {error: String(error.message || error.name)};
            }

            const expected = expectedPixels(clearing);
            const direct = await measure(() => readDirect(gl));
            const reads = {
                readPixels: direct,
                readPixelsRepeat: await measure(() => readDirect(gl)),
                drawImage: await measure(() => readDrawImage(canvas)),
                png: await measure(async () => decodePng(await exportPng(canvas))),
            };
            if (webgl2) reads.pixelPackBuffer = await measure(() => readPixelPack(gl));
            return Object.fromEntries(await Promise.all(Object.entries(reads).map(async ([path, result]) => [
                path, await describe(result, expected, direct.pixels),
            ])));
        }

        async function readApi(api) {
            if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return {available: false};
            const canvas = makeCanvas();
            const options = {alpha, antialias: false, preserveDrawingBuffer: true};
            if (alpha) options.premultipliedAlpha = false;
            const gl = canvas.getContext(api, options);
            if (!gl) return {available: false};

            try {
                const webgl2 = api === 'webgl2';
                gl.disable(gl.DITHER);
                const attributes = gl.getContextAttributes();
                const report = {
                    available: true,
                    alpha: attributes.alpha,
                    antialias: attributes.antialias,
                    drawingBufferColorSpace: gl.drawingBufferColorSpace ?? null,
                };
                if (name) {
                    if (alpha) report.premultipliedAlpha = attributes.premultipliedAlpha;
                    return {...report, ...await measureScene(gl, canvas, name, webgl2)};
                }
                return {
                    ...report,
                    clear: await measureScene(gl, canvas, 'clear', webgl2),
                    shader: await measureScene(gl, canvas, 'shader', webgl2),
                };
            } finally {
                gl.getExtension('WEBGL_lose_context')?.loseContext();
            }
        }

        return {width, height, webgl: await readApi('webgl'), webgl2: await readApi('webgl2')};
    }

    globalThis.graphicsFollowup = async function ({extended = false} = {}) {
        const report = await readScenario({width: 96, height: 64});
        if (extended) {
            report.scenes = {};
            for (const scenario of scenarios) report.scenes[scenario.name] = await readScenario(scenario);
        }
        return report;
    };
})();
