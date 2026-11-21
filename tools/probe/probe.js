'use strict';

const inWorker = typeof document === 'undefined';
const parameters = new URL(location.href).searchParams;
const followup = parameters.get('followup') === '1';
const webglScenes = parameters.get('webgl_scenes') === '1';
const contextTimeout = webglScenes ? 30000 : 15000;
const contextQuery = new URLSearchParams({
    drawing: parameters.get('drawing'), followup: Number(followup), webgl_scenes: Number(webglScenes),
});

if (inWorker && followup) importScripts('/font-followup.js', '/graphics-followup.js');

async function readSafely(action) {
    try {
        return await action();
    } catch (error) {
        return {error: error.name};
    }
}

async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error('Local request failed');
    return response.json();
}

async function digest(bytes) {
    const binary = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(binary), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readBrowser() {
    const locale = new Intl.DateTimeFormat().resolvedOptions();
    const clientHints = navigator.userAgentData;
    return {
        timezone: locale.timeZone,
        offsets: ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z']
            .map(value => new Date(value).getTimezoneOffset()),
        temporalTimezone: globalThis.Temporal?.Now?.timeZoneId() ?? null,
        locale: locale.locale,
        language: navigator.language,
        languages: Array.from(navigator.languages ?? []),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        cpu: navigator.hardwareConcurrency,
        memory: navigator.deviceMemory ?? null,
        clientHints: clientHints?.toJSON() ?? null,
        clientHintDetails: clientHints ? await readSafely(() => clientHints.getHighEntropyValues([
            'architecture', 'bitness', 'fullVersionList', 'platformVersion'
        ])) : null,
    };
}

function cssDeviceSize(axis) {
    const matches = value => matchMedia(`(min-device-${axis}: ${value}px)`).matches;
    if (!matches(1) || matches(20000)) return null;
    let low = 1;
    let high = 20000;
    while (low < high) {
        const midpoint = Math.ceil((low + high) / 2);
        if (matches(midpoint)) low = midpoint;
        else high = midpoint - 1;
    }
    return low;
}

function readScreen() {
    return {
        width: screen.width, height: screen.height,
        availableWidth: screen.availWidth, availableHeight: screen.availHeight,
        cssDeviceWidth: cssDeviceSize('width'), cssDeviceHeight: cssDeviceSize('height'),
        innerWidth, innerHeight, outerWidth, outerHeight, dpr: devicePixelRatio,
    };
}

async function readFonts() {
    const families = await fetchJson('/fonts');
    const generic = ['serif', 'sans-serif', 'monospace'];
    const text = document.createElement('span');
    text.textContent = 'mmmmmmmmmmlliI01 Mw 汉字かな';
    text.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:57px';
    document.body.appendChild(text);
    function dimensions(font) {
        text.style.fontFamily = font;
        return `${text.offsetWidth}x${text.offsetHeight}`;
    }
    try {
        let baseline = generic.map(dimensions);
        // An embedded document may finish script loading before its layout is ready.
        for (let attempt = 0; attempt < 5 && baseline.every(size => size === '0x0'); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 150));
            baseline = generic.map(dimensions);
        }
        if (baseline.every(size => size === '0x0')) return {error: 'FontLayoutUnavailable'};
        return Object.fromEntries(families.map(family => [
            family,
            generic.some((fallback, index) => dimensions(`${JSON.stringify(family)},${fallback}`) !== baseline[index]),
        ]));
    } finally {
        text.remove();
    }
}

function makeCanvas(width, height) {
    if (inWorker) return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

async function readCanvas() {
    const canvas = makeCanvas(240, 60);
    const ctx = canvas.getContext('2d');
    if (!ctx) return {available: false};
    ctx.font = '19px Arial';
    ctx.fillStyle = '#1b3855';
    ctx.fillText('Local test 0123456789 Ω', 6, 24);
    ctx.fillStyle = 'rgba(102,157,68,0.62)';
    ctx.fillRect(16, 18, 130, 20);
    const reads = [];
    for (let i = 0; i < 3; i++) {
        const {data} = ctx.getImageData(0, 0, canvas.width, canvas.height);
        reads.push(await digest(data));
    }
    return {available: true, reads};
}

async function readAudio() {
    if (typeof OfflineAudioContext === 'undefined') return {available: false};
    const context = new OfflineAudioContext(1, 5000, 44100);
    const source = context.createOscillator();
    const compressor = context.createDynamicsCompressor();
    source.type = 'triangle';
    source.frequency.value = 10000;
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    source.connect(compressor);
    compressor.connect(context.destination);
    source.start(0);
    const buffer = await context.startRendering();
    const samples = buffer.getChannelData(0);
    const copied = new Float32Array(samples.length);
    buffer.copyFromChannel(copied, 0);
    return {
        available: true,
        sampleRate: buffer.sampleRate,
        sampleCount: samples.length,
        channelDigest: await digest(samples),
        copyDigest: await digest(copied),
    };
}

function drawBands(gl, width, height) {
    gl.enable(gl.SCISSOR_TEST);
    for (let x = 0; x < width; x += 4) {
        gl.scissor(x, 0, 4, height);
        gl.clearColor(x / width, (x % 19) / 19, (x % 13) / 13, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.disable(gl.SCISSOR_TEST);
}

function drawTriangle(gl, api) {
    const version = api === 'webgl2' ? '#version 300 es\n' : '';
    const attribute = api === 'webgl2' ? 'in' : 'attribute';
    const output = api === 'webgl2' ? 'out vec4 outputColor;' : '';
    const color = api === 'webgl2' ? 'outputColor' : 'gl_FragColor';

    function compile(type, code) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, version + code);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed');
        return shader;
    }

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER,
        attribute + ' vec2 vertex; void main() {gl_Position=vec4(vertex,0.0,1.0);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER,
        'precision highp float; ' + output +
        ' void main() { vec2 uv=gl_FragCoord.xy/vec2(96.0,64.0); ' +
        color + '=vec4(uv.x,uv.y,0.5+0.5*sin(uv.x*37.0+uv.y*19.0),1.0); }'));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed');
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.93, -0.82, 0.91, -0.78, 0.13, 0.96]), gl.STATIC_DRAW);
    const vertex = gl.getAttribLocation(program, 'vertex');
    gl.enableVertexAttribArray(vertex);
    gl.vertexAttribPointer(vertex, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

async function readGL(api) {
    const canvas = makeCanvas(96, 64);
    const gl = canvas.getContext(api, {preserveDrawingBuffer: true});
    if (!gl) return {available: false};
    try {
        const extensions = (gl.getSupportedExtensions() ?? []).sort();
        const details = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = gl.getParameter(details?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR);
        const renderer = gl.getParameter(details?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
        const textureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const viewport = Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS));
        drawBands(gl, canvas.width, canvas.height);
        if (parameters.get('drawing') === 'shader') drawTriangle(gl, api);
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const png = inWorker
            ? await (await canvas.convertToBlob()).arrayBuffer()
            : new TextEncoder().encode(canvas.toDataURL());
        return {
            available: true, extensions, vendor, renderer, textureSize, viewport,
            pixelDigest: await digest(pixels), pngDigest: await digest(png),
        };
    } finally {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}

async function readGeolocation(active) {
    const permission = (await navigator.permissions.query({name: 'geolocation'})).state;
    if (!active) return {permission};
    const request = await new Promise(resolve => {
        const deadline = setTimeout(() => resolve('pending'), 2500);
        function finish(value) {
            clearTimeout(deadline);
            resolve(value);
        }
        navigator.geolocation.getCurrentPosition(
            () => finish('position'), error => finish(error.code), {timeout: 1000},
        );
    });
    return {permission, request};
}

async function readRTC() {
    if (!globalThis.RTCPeerConnection) return {available: false};
    const connection = new RTCPeerConnection({iceServers: []});
    try {
        connection.createDataChannel('localhost-test');
        const candidates = new Set();
        let deadline;
        const gather = new Promise(resolve => {
            deadline = setTimeout(() => resolve('timeout'), 2000);
            connection.onicecandidate = event => {
                const candidate = event.candidate;
                if (!candidate) {
                    resolve('complete');
                    return;
                }
                const address = candidate.address ?? '';
                let family = 'other';
                if (address.endsWith('.local')) family = 'mDNS';
                else if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) family = 'IPv4';
                else if (address.includes(':')) family = 'IPv6';
                candidates.add([candidate.type, candidate.protocol, family].join('/'));
            };
        });
        try {
            const ice = connection.createOffer().then(offer => connection.setLocalDescription(offer));
            const finish = await Promise.race([gather, ice.then(() => gather)]);
            return {available: true, finish, candidates: [...candidates].sort()};
        } finally {
            clearTimeout(deadline);
        }
    } finally {
        connection.close();
    }
}

async function collectContext() {
    if (followup) {
        const [browser, http, fonts, graphics] = await Promise.all([
            readSafely(readBrowser), readSafely(() => fetchJson('/headers')),
            readSafely(async () => globalThis.fontFollowup(await fetchJson('/fonts'))),
            readSafely(() => globalThis.graphicsFollowup({extended: webglScenes})),
        ]);
        delete http.testCookiePresent;
        const readings = {browser, http, fonts, graphics};
        if (!inWorker) readings.screen = await readSafely(() => globalThis.screenFollowup());
        return readings;
    }
    const [browser, http, canvas, audio] = await Promise.all([
        readSafely(readBrowser), readSafely(() => fetchJson('/headers')),
        readSafely(readCanvas), readSafely(readAudio),
    ]);
    delete http.testCookiePresent;
    const readings = {browser, http, canvas, audio};
    readings.webgl = await readSafely(() => readGL('webgl'));
    readings.webgl2 = await readSafely(() => readGL('webgl2'));
    if (!inWorker) {
        readings.screen = readScreen();
        readings.fonts = await readSafely(readFonts);
    }
    return readings;
}

function collectWorker() {
    return new Promise(resolve => {
        const worker = new Worker(`/probe.js?${contextQuery}`);
        function finish(value) {
            clearTimeout(deadline);
            worker.terminate();
            resolve(value);
        }
        const deadline = setTimeout(() => finish({error: 'WorkerTimeout'}), contextTimeout);
        worker.onmessage = event => finish(event.data);
        worker.onerror = () => finish({error: 'WorkerError'});
    });
}

function collectFrame(url) {
    return new Promise(resolve => {
        const frame = document.createElement('iframe');
        // A frame in the viewport keeps its layout available for font measurements.
        frame.title = '本机采集上下文';
        frame.style.cssText = 'width:320px;height:240px;border:0;pointer-events:none';
        function finish(value) {
            clearTimeout(deadline);
            window.removeEventListener('message', handleMessage);
            frame.remove();
            resolve(value);
        }
        function handleMessage(event) {
            if (event.source === frame.contentWindow && event.origin === url.origin) finish(event.data);
        }
        const deadline = setTimeout(() => finish({error: 'FrameTimeout'}), contextTimeout);
        window.addEventListener('message', handleMessage);
        frame.src = url.href;
        document.body.appendChild(frame);
    });
}

function cookieName(token) {
    return 'adspower_probe_' + token;
}

async function readStorage(token) {
    const key = cookieName(token);
    const headers = await fetchJson('/headers');
    const result = {
        cookiePresentBefore: headers.testCookiePresent,
        localStoragePresentBefore: localStorage.getItem(key) === '1',
    };
    localStorage.setItem(key, '1');
    document.cookie = key + '=1; Path=/; SameSite=Strict; Max-Age=3600';
    return result;
}

async function main() {
    if (location.pathname === '/frame') {
        parent.postMessage(await collectContext(), 'http://127.0.0.1:' + location.port);
        return;
    }

    const status = document.getElementById('status');
    const token = document.querySelector('meta[name="probe-token"]').content;
    if (location.pathname === '/cleanup') {
        const key = cookieName(token);
        localStorage.removeItem(key);
        document.cookie = key + '=; Path=/; SameSite=Strict; Max-Age=0';
        status.textContent = '本机测试存储已清除';
        return;
    }

    const index = Number(parameters.get('index'));
    const count = Number(parameters.get('count'));
    const drawing = parameters.get('drawing');
    if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count || count > 20
            || !['clear', 'shader'].includes(drawing)) {
        throw new Error('无效的采样参数，请从实验设置开始');
    }
    const framePath = `/frame?${contextQuery}`;
    const [top, sameFrame, crossFrame, worker, geolocation, rtc, storage] = await Promise.all([
        readSafely(collectContext),
        readSafely(() => collectFrame(new URL(framePath, location.origin))),
        readSafely(() => collectFrame(new URL(framePath, 'http://localhost:' + location.port))),
        readSafely(collectWorker),
        readSafely(() => readGeolocation(parameters.get('locate') === '1')),
        readSafely(readRTC),
        parameters.get('storage') === '1' ? readSafely(() => readStorage(token)) : null,
    ]);
    const response = await fetch('/report', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            token, batch: parameters.get('batch'), index,
            readings: {top, sameFrame, crossFrame, worker, geolocation, rtc, storage},
        }),
    });
    if (!response.ok) throw new Error('保存失败，请检查服务输出或重新开始采样');
    status.textContent = `${parameters.get('run')} 已保存 ${index}/${count}`;
    if (index < count) {
        const next = new URL(location.href);
        next.searchParams.set('index', String(index + 1));
        setTimeout(() => location.replace(next.href), 400);
    }
}

if (inWorker) {
    readSafely(collectContext).then(readings => postMessage(readings));
} else {
    main().catch(error => {
        document.getElementById('status').textContent = error.message;
    });
}
