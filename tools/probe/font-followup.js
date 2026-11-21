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
    const renderSamples = ['WWW ii M 0123456789', '國体廣學语漢字繁體翁永'];
    const renderTargets = [
        ['PingFang SC', 'PingFang SC', faceNames.get('PingFang SC')],
        ['STHeiti', 'STHeiti', 'STHeitiSC-Light'],
        ['Arial', 'Arial', faceNames.get('Arial')],
        ['missing', missingName, null],
    ];

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
        return (family, samples = textSamples) => {
            context.font = '57px ' + family;
            return samples.flatMap(text => {
                const metrics = context.measureText(text);
                return [metrics.width, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight,
                    metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent];
            });
        };
    }

    function detector(measure) {
        if (!measure) return null;
        const baselines = generics.map(generic => measure(generic));
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

    async function inspectLocalFace(name, alias, fontSet, measure, baseline) {
        if (!name || typeof FontFace !== 'function') return null;
        let face;
        try {
            face = await new FontFace(alias, `local(${quoteFamily(name)})`).load();
        } catch (error) {
            if (error.name === 'NetworkError') return {name, loaded: false, rendered: null, metrics: null};
            return {name, error: error.name};
        }
        if (!fontSet || !measure) return {name, loaded: true, rendered: null, metrics: null};

        fontSet.add(face);
        try {
            const metrics = generics.map(fallback => measure(`${quoteFamily(alias)}, ${fallback}`, renderSamples));
            const rendered = metrics.some((values, index) =>
                values.some((value, offset) => value !== baseline[index][offset]));
            return {name, loaded: true, rendered, metrics};
        } finally {
            fontSet.delete(face);
        }
    }

    async function readLocalRender(measure) {
        const fontSet = globalThis.document?.fonts ?? globalThis.fonts;
        const baseline = measure ? generics.map(fallback => measure(fallback, renderSamples)) : null;
        const targets = await Promise.all(renderTargets.map(async ([key, familyName, postscriptName], index) => {
            const [family, postscript] = await Promise.all([
                inspectLocalFace(familyName, `LocalRenderFamily${index}`, fontSet, measure, baseline),
                inspectLocalFace(postscriptName, `LocalRenderPostscript${index}`, fontSet, measure, baseline),
            ]);
            return [key, {family, postscript}];
        }));
        return Object.fromEntries(targets);
    }

    globalThis.fontFollowup = async function fontFollowup(families) {
        const layout = layoutProbe();
        try {
            const dom = detector(layout?.measure);
            const measureCanvas = canvasProbe();
            const canvas = detector(measureCanvas);
            const makeReading = async family => ({
                dom: dom?.has(family) ?? null,
                canvas: canvas?.has(family) ?? null,
                local: await lookupLocal(family),
            });
            const names = [...new Set(families.filter(family =>
                !generics.includes(family.toLowerCase()) && family !== missingName))];
            const [missing, arial, fonts, localRender] = await Promise.all([
                makeReading(missingName), makeReading('Arial'),
                Promise.all(names.map(async family => [family, await makeReading(family)])),
                readLocalRender(measureCanvas),
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
                localRender,
            };
        } finally {
            layout?.close();
        }
    };
})();
