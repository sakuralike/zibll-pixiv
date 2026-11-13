'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const viewerSource = fs.readFileSync(
    require('path').join(__dirname, '..', 'assets', 'js', 'viewer.js'),
    'utf8'
);
const environments = [];

class FakeElement {
    constructor(tagName, attributes) {
        this.tagName = tagName;
        this.attributes = Object.assign({}, attributes || {});
        this.children = [];
        this.listeners = {};
        this.hidden = false;
        this.disabled = false;
        this.value = '';
        this._textContent = '';
        this._src = '';
        this.classList = {
            toggle: (name, enabled) => {
                this.classList[name] = Boolean(enabled);
            },
            add: (name) => {
                this.classList[name] = true;
            },
            remove: (name) => {
                this.classList[name] = false;
            }
        };
    }

    get textContent() {
        return this._textContent + this.children.map((child) => child.textContent).join('');
    }

    set textContent(value) {
        this._textContent = String(value || '');
        this.children = [];
    }

    get src() {
        return this._src;
    }

    set src(value) {
        this._src = String(value || '');
        if (this.imageLoad && this._src) {
            this.imageLoad(this._src, this);
        }
    }

    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name)
            ? this.attributes[name]
            : null;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    get firstElementChild() {
        return this.children[0] || null;
    }

    get parentElement() {
        return this.parentNode || null;
    }

    matches(selector) {
        const attribute = selector.match(/^\[([^\]=]+)/);
        return attribute
            ? this.getAttribute(attribute[1]) !== null
            : this.tagName.toLowerCase() === selector.toLowerCase();
    }

    querySelector(selector) {
        if (this.childrenBySelector && this.childrenBySelector[selector]) {
            return this.childrenBySelector[selector];
        }
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const matches = [];
        this.children.forEach((child) => {
            if (child.matches(selector)) {
                matches.push(child);
            }
            matches.push(...child.querySelectorAll(selector));
        });
        return matches;
    }

    cloneNode(deep) {
        const clone = new FakeElement(this.tagName, this.attributes);
        ['hidden', 'disabled', 'value', '_textContent', 'className', 'imageLoad'].forEach((name) => {
            clone[name] = this[name];
        });
        if (deep) {
            this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));
        }
        return clone;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (this.parentNode) {
            this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
            this.parentNode = null;
        }
        this.removed = true;
    }

    addEventListener(type, callback) {
        if (!this.listeners[type]) {
            this.listeners[type] = [];
        }
        this.listeners[type].push(callback);
    }

    dispatch(type, event) {
        const dispatched = event || {
            target: this,
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            }
        };
        dispatched.currentTarget = this;
        (this.listeners[type] || []).forEach((callback) => callback(dispatched));
        if (dispatched.bubbles && !dispatched.propagationStopped && this.parentNode) {
            this.parentNode.dispatch(type, dispatched);
        }
        return dispatched;
    }

    click() {
        if (this.disabled) {
            return;
        }
        this.wasClicked = true;
        this.clickCount = (this.clickCount || 0) + 1;
        this.lastClickEvent = this.dispatch('click', {
            target: this,
            bubbles: true,
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            }
        });
    }

    focus() {
        this.focused = true;
    }
}

function response(status, data) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: () => Promise.resolve(data)
    };
}

function createEnvironment(overrides) {
    const settings = Object.assign({
        resolverUrl: 'https://site.test/wp-json/zibll-pixiv/v1/artwork/',
        baseUrl: 'https://site.test/pixiv/',
        failover: true,
        timeout: 1000,
        initialId: '123',
        initialPage: 1,
        pageCount: 2,
        blocked: false,
        filterEffective: false,
        resolve: null,
        imagePlan: null
    }, overrides || {});
    const selectors = {};
    const root = new FakeElement('main', {
        'data-id': settings.initialId,
        'data-page': String(settings.initialPage),
        'data-base-url': settings.baseUrl,
        'data-blocked': settings.blocked ? '1' : '0',
        'data-filter-effective': '0'
    });
    const create = (tagName, selector) => {
        const element = new FakeElement(tagName);
        selectors[selector] = element;
        return element;
    };
    selectors['[data-zibll-pixiv-form]'] = create('form', '[data-zibll-pixiv-form]');
    selectors['#zibll-pixiv-input'] = create('input', '#zibll-pixiv-input');
    selectors['[data-zibll-pixiv-form-error]'] = create('p', '[data-zibll-pixiv-form-error]');
    selectors['[data-zibll-pixiv-status]'] = create('p', '[data-zibll-pixiv-status]');
    const source = create('a', '[data-zibll-pixiv-source]');
    new FakeElement('p').appendChild(source);
    const gallery = create('div', '[data-zibll-pixiv-gallery]');
    const template = create('template', '[data-zibll-pixiv-card-template]');
    template.content = new FakeElement('fragment');
    const card = template.content.appendChild(new FakeElement('article', {
        'data-zibll-pixiv-card': ''
    }));
    card.appendChild(new FakeElement('span', { 'data-zibll-pixiv-card-page': '' }));
    const lightbox = card.appendChild(new FakeElement('a', {
        'data-zibll-pixiv-lightbox': ''
    }));
    const image = lightbox.appendChild(new FakeElement('img', { 'data-zibll-pixiv-image': '' }));
    image.imageLoad = (url, element) => {
        const outcome = settings.imagePlan ? settings.imagePlan(url) : 'load';
        Promise.resolve(outcome).then((result) => {
            if (element.src !== url) {
                return;
            }
            if (result === 'load' && element.onload) {
                element.loaded = true;
                element.onload();
            } else if (element.onerror) {
                element.onerror();
            }
        });
    };
    card.appendChild(new FakeElement('button', { 'data-zibll-pixiv-download': '' }));
    card.appendChild(new FakeElement('button', { 'data-zibll-pixiv-copy': '' }));
    card.appendChild(new FakeElement('p', { 'data-zibll-pixiv-card-status': '' }));
    root.childrenBySelector = selectors;
    selectors['#zibll-pixiv-input'].value = settings.initialId;

    const createdElements = [];
    const clipboardWrites = [];
    const openedUrls = [];
    const timers = new Set();
    const historyCalls = [];
    const windowListeners = {};
    const body = new FakeElement('body');
    body.appendChild(root);
    root.appendChild(gallery);
    const navigator = {
        clipboard: {
            writeText(value) {
                clipboardWrites.push(value);
                return Promise.resolve();
            }
        }
    };
    const window = {
        ZibllPixivConfig: settings,
        history: {
            replaceState(state, title, url) {
                historyCalls.push(url);
            }
        },
        location: {
            origin: 'https://site.test',
            pathname: '/pixiv/'
        },
        navigator,
        setTimeout(callback, milliseconds) {
            const timer = setTimeout(() => {
                timers.delete(timer);
                callback();
            }, Math.min(milliseconds, settings.timerCap || 1000));
            timers.add(timer);
            return timer;
        },
        clearTimeout(timer) {
            timers.delete(timer);
            clearTimeout(timer);
        },
        addEventListener(type, callback) {
            windowListeners[type] = callback;
        },
        open(url) {
            openedUrls.push(url);
        }
    };
    const document = {
        body,
        querySelector(selector) {
            return selector === '[data-zibll-pixiv-viewer]' ? root : null;
        },
        createElement(tagName) {
            const element = new FakeElement(tagName);
            createdElements.push(element);
            return element;
        }
    };
    const fetchCalls = [];
    const requestOptions = [];
    const fetch = (url, options) => {
        fetchCalls.push(url);
        requestOptions.push(options);
        if (settings.resolve) {
            return Promise.resolve(settings.resolve(url, options));
        }
        const id = url.slice(settings.resolverUrl.length);
        const pages = Array.from({ length: settings.pageCount }, (_, index) => ({
            page: index + 1,
            urls: [
                'https://i.pixiv.re/img-original/test/' + id + '_p' + index + '.png',
                'https://i.pixiv.nl/img-original/test/' + id + '_p' + index + '.png'
            ]
        }));
        return Promise.resolve(response(200, {
            id,
            pages,
            total: settings.pageCount,
            has_more: false
        }));
    };
    const context = vm.createContext({
        window,
        document,
        navigator,
        fetch,
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        console
    });
    const environment = {
        root,
        form: selectors['[data-zibll-pixiv-form]'],
        input: selectors['#zibll-pixiv-input'],
        formError: selectors['[data-zibll-pixiv-form-error]'],
        status: selectors['[data-zibll-pixiv-status]'],
        source,
        gallery,
        cards() {
            return gallery.querySelectorAll('[data-zibll-pixiv-card]');
        },
        createdElements,
        clipboardWrites,
        openedUrls,
        historyCalls,
        fetchCalls,
        requestOptions,
        window,
        body,
        close() {
            if (windowListeners.beforeunload) {
                windowListeners.beforeunload();
            }
            timers.forEach(clearTimeout);
            timers.clear();
        }
    };
    environments.push(environment);
    vm.runInContext(viewerSource, context, { filename: 'viewer.js' });
    return environment;
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, message) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (predicate()) {
            return;
        }
        await wait(5);
    }
    assert.fail(message || 'expected state did not arrive');
}

function retryButton(environment) {
    return environment.status.querySelector('button');
}

async function testProgressiveDirectImages() {
    let releaseSecond;
    const environment = createEnvironment({
        imagePlan(url) {
            if (url.endsWith('_p1.png')) {
                return new Promise((resolve) => {
                    releaseSecond = () => resolve('load');
                });
            }
            return 'load';
        }
    });
    await waitFor(() => releaseSecond);
    assert.strictEqual(environment.cards().filter((card) => card.querySelector('[data-zibll-pixiv-image]').loaded).length, 1);
    assert.strictEqual(environment.cards()[0].querySelector('[data-zibll-pixiv-image]').src,
        'https://i.pixiv.re/img-original/test/123_p0.png');
    releaseSecond();
    await waitFor(() => environment.status.textContent.includes('共 2 张'));
    assert.strictEqual(environment.cards().length, 2);
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://site.test/wp-json/zibll-pixiv/v1/artwork/123'
    ]);
    assert.ok(environment.requestOptions.every((options) => options.credentials === 'same-origin'));
}

async function testImageFailover() {
    const environment = createEnvironment({
        imagePlan(url) {
            return url.startsWith('https://i.pixiv.re/') ? 'error' : 'load';
        }
    });
    await waitFor(() => environment.status.textContent.includes('共 2 张'));
    assert.ok(environment.cards().every((card) => card.querySelector('[data-zibll-pixiv-image]').src.startsWith('https://i.pixiv.nl/')));
}

async function testFailedImageRetriesWithoutLosingCards() {
    let secondAttempts = 0;
    const firstCardImage = 'https://i.pixiv.re/img-original/test/123_p0.png';
    const environment = createEnvironment({
        imagePlan(url) {
            if (url.includes('_p1.png')) {
                secondAttempts += 1;
                return secondAttempts <= 2 ? 'error' : 'load';
            }
            return 'load';
        }
    });
    await waitFor(() => retryButton(environment));
    const firstCard = environment.cards()[0];
    assert.strictEqual(firstCard.querySelector('[data-zibll-pixiv-image]').src, firstCardImage);
    retryButton(environment).click();
    await waitFor(() => environment.cards().length === 2);
    assert.strictEqual(environment.cards()[0], firstCard);
    assert.strictEqual(secondAttempts, 3);
}

async function testResolverFailureCanRetry() {
    let attempts = 0;
    const environment = createEnvironment({
        resolve() {
            attempts += 1;
            return Promise.resolve(attempts === 1
                ? response(502, {})
                : response(200, {
                    pages: [{ page: 1, urls: ['https://i.pixiv.re/img-original/test/123_p0.png'] }],
                    total: 1
                }));
        }
    });
    await waitFor(() => retryButton(environment));
    retryButton(environment).click();
    await waitFor(() => environment.status.textContent.includes('共 1 张'));
    assert.strictEqual(attempts, 2);
}

async function testSwitchArtworkIgnoresLateResolver() {
    let releaseOld;
    const environment = createEnvironment({
        resolve(url) {
            if (url.endsWith('/123')) {
                return new Promise((resolve) => {
                    releaseOld = () => resolve(response(200, {
                        pages: [{ page: 1, urls: ['https://i.pixiv.re/img-original/test/123_p0.png'] }],
                        total: 1
                    }));
                });
            }
            return Promise.resolve(response(200, {
                pages: [{ page: 1, urls: ['https://i.pixiv.re/img-original/test/456_p0.png'] }],
                total: 1
            }));
        }
    });
    await waitFor(() => releaseOld);
    environment.input.value = '456';
    environment.form.dispatch('submit');
    await waitFor(() => environment.status.textContent.includes('共 1 张'));
    releaseOld();
    await wait(10);
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://site.test/wp-json/zibll-pixiv/v1/artwork/123',
        'https://site.test/wp-json/zibll-pixiv/v1/artwork/456'
    ]);
    assert.strictEqual(environment.cards().length, 1);
    assert.strictEqual(environment.cards()[0].querySelector('[data-zibll-pixiv-image]').src,
        'https://i.pixiv.re/img-original/test/456_p0.png');
}

async function testCopyDownloadAndLightboxUseDirectUrl() {
    const environment = createEnvironment({ pageCount: 1 });
    await waitFor(() => environment.status.textContent.includes('共 1 张'));
    const card = environment.cards()[0];
    const url = 'https://i.pixiv.re/img-original/test/123_p0.png';
    card.querySelector('[data-zibll-pixiv-copy]').click();
    card.querySelector('[data-zibll-pixiv-download]').click();
    await wait(0);
    assert.deepStrictEqual(environment.clipboardWrites, [url]);
    assert.deepStrictEqual(environment.openedUrls, [url]);
    assert.strictEqual(card.querySelector('[data-zibll-pixiv-lightbox]').href, url);
    environment.window.Miniimgbox = function () {};
    environment.window._win = { imgbox: true };
    const image = card.querySelector('[data-zibll-pixiv-image]');
    image.click();
    assert.ok(image.lastClickEvent.defaultPrevented);
}

async function testDeepLinkAndPixivUrlParsing() {
    const environment = createEnvironment({ initialId: '', initialPage: 1, pageCount: 2 });
    environment.input.value = 'https://www.pixiv.net/artworks/123#2';
    environment.form.dispatch('submit');
    await waitFor(() => environment.status.textContent.includes('共 2 张'));
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://site.test/wp-json/zibll-pixiv/v1/artwork/123'
    ]);
    assert.strictEqual(environment.cards().length, 1);
    assert.strictEqual(environment.cards()[0].getAttribute('data-page'), '2');
    assert.strictEqual(environment.historyCalls[0], 'https://site.test/pixiv/123/2/');
}

async function testPageSafetyLimit() {
    const environment = createEnvironment({
        pageCount: 50,
        resolve() {
            const pages = Array.from({ length: 50 }, (_, index) => ({
                page: index + 1,
                urls: ['https://i.pixiv.re/img-original/test/123_p' + index + '.png']
            }));
            return Promise.resolve(response(200, { pages, total: 75, has_more: true }));
        }
    });
    await waitFor(() => environment.cards().length === 50);
    assert.ok(environment.status.textContent.includes('50'));
    assert.strictEqual(retryButton(environment), null);
}

async function testOriginalProxyUrlParsing() {
    const environment = createEnvironment({ initialId: '', initialPage: 1, pageCount: 2 });
    environment.input.value = 'https://i.pixiv.nl/img-original/img/2020/07/16/00/00/17/123_p1.png';
    environment.form.dispatch('submit');
    await waitFor(() => environment.status.textContent.includes('共 2 张'));
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://site.test/wp-json/zibll-pixiv/v1/artwork/123'
    ]);
    assert.strictEqual(environment.cards()[0].getAttribute('data-page'), '2');
}

async function testBlockedAndInvalidInputsDoNotResolve() {
    const blocked = createEnvironment({ blocked: true });
    await wait(10);
    assert.deepStrictEqual(blocked.fetchCalls, []);
    const invalid = createEnvironment({ initialId: '' });
    invalid.input.value = 'https://evil.example/123';
    invalid.form.dispatch('submit');
    await wait(10);
    assert.deepStrictEqual(invalid.fetchCalls, []);
    assert.ok(invalid.formError.textContent);
}

const tests = [
    ['progressive direct image loading', testProgressiveDirectImages],
    ['i.pixiv.re to i.pixiv.nl fallback', testImageFailover],
    ['failed image retry preserves loaded cards', testFailedImageRetriesWithoutLosingCards],
    ['resolver failure can retry', testResolverFailureCanRetry],
    ['switch artwork ignores late resolver response', testSwitchArtworkIgnoresLateResolver],
    ['copy, open-original download, and theme lightbox', testCopyDownloadAndLightboxUseDirectUrl],
    ['Pixiv link parsing and deep-link page', testDeepLinkAndPixivUrlParsing],
    ['i.pixiv.re and i.pixiv.nl URL parsing', testOriginalProxyUrlParsing],
    ['50-page safety limit', testPageSafetyLimit],
    ['blocked and invalid input do not resolve', testBlockedAndInvalidInputsDoNotResolve]
];

(async () => {
    let failed = 0;
    for (const [name, test] of tests) {
        let deadline;
        try {
            await Promise.race([
                test(),
                new Promise((resolve, reject) => {
                    deadline = setTimeout(() => reject(new Error('test timeout')), 4000);
                })
            ]);
            console.log('PASS ' + name);
        } catch (error) {
            failed += 1;
            console.error('FAIL ' + name + ': ' + error.message);
        } finally {
            clearTimeout(deadline);
            environments.splice(0).forEach((environment) => environment.close());
        }
    }
    if (failed > 0) {
        process.exitCode = 1;
    }
})();
