'use strict';

(() => {
    const width = 96;
    const height = 64;
    const byteLength = width * height * 4;
    const clearColors = [
        [255, 0, 0], [0, 255, 255], [255, 255, 0], [0, 255, 0],
        [0, 0, 255], [255, 0, 255], [0, 0, 0], [255, 255, 255],
    ];

    function makeCanvas() {
        if (typeof document === 'undefined') return new OffscreenCanvas(width, height);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    function requireNoGlError(gl, operation) {
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw new Error(operation + ' returned WebGL error ' + error);
    }

    function drawClear(gl) {
        gl.enable(gl.SCISSOR_TEST);
        for (const [index, [r, g, b]] of clearColors.entries()) {
            gl.scissor((index % 4) * 24, Math.floor(index / 4) * 32, 24, 32);
            gl.clearColor(r / 255, g / 255, b / 255, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.disable(gl.SCISSOR_TEST);
    }

    function drawShader(gl, webgl2) {
        const version = webgl2 ? '#version 300 es\n' : '';
        const vertexInput = webgl2 ? 'in' : 'attribute';
        const declaration = webgl2 ? 'out vec4 color;' : '';
        const output = webgl2 ? 'color' : 'gl_FragColor';
        function compile(type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, version + source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                throw new Error('Exact-value shader did not compile');
            }
            return shader;
        }

        const vertex = compile(gl.VERTEX_SHADER,
            vertexInput + ' vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }');
        const fragment = compile(gl.FRAGMENT_SHADER, `
            precision highp float;
            ${declaration}
            void main() {
                vec2 p = floor(gl_FragCoord.xy);
                ${output} = vec4(mod(13.0 * p.x + 5.0 * p.y + 17.0, 256.0),
                    mod(7.0 * p.x + 11.0 * p.y + 31.0, 256.0),
                    mod(3.0 * p.x + 19.0 * p.y + 47.0, 256.0), 255.0) / 255.0;
            }
        `);
        const program = gl.createProgram();
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Exact-value shader did not link');
        gl.useProgram(program);
        const vertices = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const attribute = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disableVertexAttribArray(attribute);
        gl.deleteBuffer(vertices);
        gl.deleteProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
    }

    function expectedPixels(scene) {
        const pixels = new Uint8Array(byteLength);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const glY = height - 1 - y;
                const rgb = scene === 'clear'
                    ? clearColors[Math.floor(glY / 32) * 4 + Math.floor(x / 24)]
                    : [(13 * x + 5 * glY + 17) % 256, (7 * x + 11 * glY + 31) % 256,
                        (3 * x + 19 * glY + 47) % 256];
                pixels.set(rgb, 4 * (y * width + x));
                pixels[4 * (y * width + x) + 3] = 255;
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
        const context = target.getContext('2d', {alpha: false, colorSpace: 'srgb', willReadFrequently: true});
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
        return summary;
    }

    async function measureScene(gl, canvas, scene, webgl2) {
        try {
            if (scene === 'clear') drawClear(gl);
            else drawShader(gl, webgl2);
            requireNoGlError(gl, 'Draw ' + scene);
        } catch (error) {
            return {error: String(error.message || error.name)};
        }
        const expected = expectedPixels(scene);
        const direct = await measure(() => readDirect(gl));
        const reads = {
            readPixels: direct,
            readPixelsRepeat: await measure(() => readDirect(gl)),
            drawImage: await measure(() => readDrawImage(canvas)),
            png: await measure(async () => decodePng(await exportPng(canvas))),
        };
        if (webgl2) reads.pixelPackBuffer = await measure(() => readPixelPack(gl));
        return Object.fromEntries(await Promise.all(Object.entries(reads).map(async ([name, result]) => [
            name, await describe(result, expected, direct.pixels),
        ])));
    }

    async function readApi(api) {
        if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return {available: false};
        const canvas = makeCanvas();
        const gl = canvas.getContext(api, {alpha: false, antialias: false, preserveDrawingBuffer: true});
        if (!gl) return {available: false};
        try {
            gl.disable(gl.DITHER);
            const attributes = gl.getContextAttributes();
            return {
                available: true,
                alpha: attributes.alpha,
                antialias: attributes.antialias,
                drawingBufferColorSpace: gl.drawingBufferColorSpace ?? null,
                clear: await measureScene(gl, canvas, 'clear', api === 'webgl2'),
                shader: await measureScene(gl, canvas, 'shader', api === 'webgl2'),
            };
        } finally {
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    }

    globalThis.graphicsFollowup = async function () {
        return {width, height, webgl: await readApi('webgl'), webgl2: await readApi('webgl2')};
    };
})();
