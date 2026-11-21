'use strict';

(() => {
    const screenProperties = [
        'width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth',
    ];
    const features = [
        ['deviceWidth', 'device-width', 'px', 32768, 1],
        ['deviceHeight', 'device-height', 'px', 32768, 1],
        ['viewportWidth', 'width', 'px', 32768, 1],
        ['viewportHeight', 'height', 'px', 32768, 1],
        ['resolutionDppx', 'resolution', 'dppx', 32, 1024],
    ];

    function measureMedia(matches) {
        return Object.fromEntries(features.map(([key, feature, unit, limit, steps]) => {
            const atLeast = ticks => matches(`(min-${feature}: ${ticks / steps}${unit})`);
            let low = 1;
            let high = limit * steps;
            if (!atLeast(low) || atLeast(high)) return [key, null];
            while (low < high) {
                const middle = Math.ceil((low + high) / 2);
                if (atLeast(middle)) low = middle;
                else high = middle - 1;
            }
            return [key, low / steps];
        }));
    }

    function measureAppliedStyles() {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;' +
            'visibility:hidden;pointer-events:none;contain:strict';
        const shadow = host.attachShadow({mode: 'closed'});
        const style = document.createElement('style');
        const element = document.createElement('span');
        shadow.append(style, element);
        document.body.appendChild(host);

        function matches(condition) {
            style.textContent = `@media ${condition} { span { --probe-media-match: yes; } }`;
            return getComputedStyle(element).getPropertyValue('--probe-media-match').trim() === 'yes';
        }

        try {
            if (!host.getBoundingClientRect().width) return {error: 'ScreenLayoutUnavailable'};
            if (!matches('all') || matches('not all')) return {error: 'MediaStyleUnavailable'};
            return measureMedia(matches);
        } finally {
            host.remove();
        }
    }

    function readScreenGetter(property) {
        const getter = Object.getOwnPropertyDescriptor(Screen.prototype, property)?.get;
        let value = null;
        if (getter) {
            try {
                value = Reflect.apply(getter, screen, []);
            } catch (error) {
                return {own: Object.hasOwn(screen, property), error: error.name};
            }
        }
        return {own: Object.hasOwn(screen, property), getter: Boolean(getter), value};
    }

    globalThis.screenFollowup = function screenFollowup() {
        const viewport = globalThis.visualViewport;
        return {
            reported: Object.fromEntries(screenProperties.map(property => [property, screen[property]])),
            prototype: Object.fromEntries(screenProperties.map(property => [property, readScreenGetter(property)])),
            jsMedia: measureMedia(query => matchMedia(query).matches),
            styleMedia: measureAppliedStyles(),
            viewport: {
                innerWidth, innerHeight, outerWidth, outerHeight,
                clientWidth: document.documentElement.clientWidth,
                clientHeight: document.documentElement.clientHeight,
                visual: viewport ? {width: viewport.width, height: viewport.height, scale: viewport.scale} : null,
            },
            display: {
                dpr: devicePixelRatio,
                orientation: screen.orientation
                    ? {type: screen.orientation.type, angle: screen.orientation.angle}
                    : null,
                viewportLandscape: matchMedia('(orientation: landscape)').matches,
            },
        };
    };
})();
