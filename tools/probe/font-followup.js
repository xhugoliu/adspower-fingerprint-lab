'use strict';

// These three readings exercise layout, drawing metrics, and local font lookup.
// A CSS font family and its PostScript face name can differ.
(() => {
    const generics = ['serif', 'sans-serif', 'monospace'];
    const textSamples = ['mmlliI01 Mw @#QW Ω', '汉字かな あいう 🙂'];
    const missingName = 'AdsPower Probe Missing Font 8C4E6D';
    const faceNames = new Map([
        ['Arial', 'ArialMT'],
        ['Avenir', 'Avenir-Book'],
        ['Avenir Next', 'AvenirNext-Regular'],
        ['Courier New', 'CourierNewPSMT'],
        ['Helvetica Neue', 'HelveticaNeue'],
        ['Menlo', 'Menlo-Regular'],
        ['PingFang SC', 'PingFangSC-Regular'],
        ['PingFang TC', 'PingFangTC-Regular'],
        ['Times New Roman', 'TimesNewRomanPSMT'],
    ]);

    function quoteFamily(family) {
        return '"' + family.replace(/["\\\u0000-\u001f\u007f]/g,
            char => '\\' + char.codePointAt(0).toString(16) + ' ') + '"';
    }

    function layoutProbe() {
        if (!globalThis.document?.body) return null;
        const container = document.createElement('div');
        container.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;pointer-events:none';
        const spans = textSamples.map(text => {
            const span = document.createElement('span');
            span.style.cssText = 'display:block;width:max-content;white-space:nowrap;font-size:57px;line-height:normal';
            span.textContent = text;
            container.appendChild(span);
            return span;
        });
        document.body.appendChild(container);
        return {
            measure(family) {
                container.style.fontFamily = family;
                return spans.flatMap(span => {
                    const {width, height} = span.getBoundingClientRect();
                    return [width, height];
                });
            },
            close: () => container.remove(),
        };
    }

    function canvasProbe() {
        let canvas;
        if (globalThis.document) canvas = document.createElement('canvas');
        else if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(1, 1);
        const context = canvas?.getContext('2d');
        if (!context) return null;
        return family => {
            context.font = '57px ' + family;
            return textSamples.flatMap(text => {
                const metrics = context.measureText(text);
                return [metrics.width, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight,
                    metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent];
            });
        };
    }

    function detector(measure) {
        if (!measure) return null;
        const baselines = generics.map(measure);
        if (!baselines.some(values => values.some(Number.isFinite))
                || baselines.every(values => values.every(value => !value))) return null;
        return {
            genericBaselinesDistinct: new Set(baselines.map(values => JSON.stringify(values))).size > 1,
            has(family) {
                return generics.some((generic, index) => measure(`${quoteFamily(family)}, ${generic}`)
                    .some((value, offset) => value !== baselines[index][offset]));
            },
        };
    }

    async function lookupLocal(family) {
        if (typeof FontFace !== 'function') return null;
        const names = [family];
        const faceName = faceNames.get(family);
        if (faceName) names.push(faceName);
        const source = names.map(name => `local(${quoteFamily(name)})`).join(', ');
        try {
            await new FontFace('LocalProbeFace', source).load();
            return true;
        } catch (error) {
            if (error.name === 'NetworkError') return false;
            return {error: error.name};
        }
    }

    globalThis.fontFollowup = async function fontFollowup(families) {
        const layout = layoutProbe();
        try {
            const dom = detector(layout?.measure);
            const canvas = detector(canvasProbe());
            const makeReading = async family => ({
                dom: dom?.has(family) ?? null,
                canvas: canvas?.has(family) ?? null,
                local: await lookupLocal(family),
            });
            const names = [...new Set(families.filter(family =>
                !generics.includes(family.toLowerCase()) && family !== missingName))];
            const [missing, arial, fonts] = await Promise.all([
                makeReading(missingName), makeReading('Arial'),
                Promise.all(names.map(async family => [family, await makeReading(family)])),
            ]);
            return {
                available: {dom: Boolean(dom), canvas: Boolean(canvas), local: typeof FontFace === 'function'},
                controls: {
                    missing,
                    arial,
                    genericBaselinesDistinct: {
                        dom: dom?.genericBaselinesDistinct ?? null,
                        canvas: canvas?.genericBaselinesDistinct ?? null,
                    },
                },
                fonts: Object.fromEntries(fonts),
            };
        } finally {
            layout?.close();
        }
    };
})();
