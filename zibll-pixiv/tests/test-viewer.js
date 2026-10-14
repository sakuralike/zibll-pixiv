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
        if (selector.charAt(0) === '#') {
            return this.getAttribute('id') === selector.slice(1);
        }
        const attribute = selector.match(/^\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
        if (attribute) {
            return this.getAttribute(attribute[1]) !== null
                && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
        }
        return this.tagName.toLowerCase() === selector.toLowerCase();
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
        ['hidden', 'disabled', 'value', '_textContent', 'className'].forEach((name) => {
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
        const callbacks = this.listeners[type] || [];
        callbacks.forEach((callback) => callback(dispatched));
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
            },
            stopPropagation() {
                this.propagationStopped = true;
            }
        });
    }

    focus() {
        this.focused = true;
    }
}

function makeResponse(status, options) {
    const settings = options || {};
    const headerValues = Object.assign({
        'content-type': 'image/jpeg'
    }, settings.headers || {});
    const headers = {
        get(name) {
            return headerValues[String(name).toLowerCase()] || null;
        }
    };
    let body = null;
    if (settings.hanging) {
        body = {
            getReader() {
                return {
                    read() {
                        return new Promise((resolve, reject) => {
                            settings.signal.addEventListener('abort', () => {
                                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                            }, { once: true });
                        });
                    }
                };
            }
        };
    } else {
        body = {
            getReader() {
                let done = false;
                return {
                    read() {
                        if (done) {
                            return Promise.resolve({ done: true });
                        }
                        done = true;
                        return Promise.resolve({
                            done: false,
                            value: new Uint8Array([1, 2, 3])
                        });
                    }
                };
            }
        };
    }
    return {
        status,
        ok: status >= 200 && status < 300,
        headers,
        body,
        blob: () => Promise.resolve(new Blob(['image'], { type: 'image/jpeg' }))
    };
}

function createEnvironment(fetchPlan, overrides) {
    const settings = Object.assign({
        primaryDomain: 'pixiv.re',
        backupDomain: 'pixiv.nl',
        failover: true,
        timeout: 20,
        timerCap: 10,
        prettyPermalinks: true,
        baseUrl: 'https://site.test/pixiv/',
        filterEffective: false,
        initialId: '123',
        initialPage: 1,
        blocked: false,
        strings: {}
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
    selectors['[data-zibll-pixiv-result]'] = create('section', '[data-zibll-pixiv-result]');
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
    lightbox.appendChild(new FakeElement('img', { 'data-zibll-pixiv-image': '' }));
    card.appendChild(new FakeElement('button', { 'data-zibll-pixiv-download': '' }));
    card.appendChild(new FakeElement('button', { 'data-zibll-pixiv-copy': '' }));
    card.appendChild(new FakeElement('p', { 'data-zibll-pixiv-card-status': '' }));
    root.childrenBySelector = selectors;
    selectors['#zibll-pixiv-input'].value = settings.initialId;

    const revoked = [];
    const createdUrls = [];
    const createdElements = [];
    const clipboardWrites = [];
    const timers = new Set();
    let objectUrlCounter = 0;
    const historyCalls = [];
    const windowListeners = {};
    const body = new FakeElement('body');
    body.appendChild(root);
    root.appendChild(gallery);
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
    const window = {
        ZibllPixivConfig: settings,
        URL: {
            createObjectURL() {
                objectUrlCounter += 1;
                const url = 'blob:test-' + objectUrlCounter;
                createdUrls.push(url);
                return url;
            },
            revokeObjectURL(url) {
                revoked.push(url);
            }
        },
        history: {
            replaceState(state, title, url) {
                historyCalls.push(url);
            }
        },
        location: {
            origin: 'https://site.test',
            pathname: '/pixiv/'
        },
        navigator: {
            clipboard: {
                writeText(value) {
                    clipboardWrites.push(value);
                    return Promise.resolve();
                }
            }
        },
        setTimeout(callback, milliseconds) {
            const timer = setTimeout(() => {
                timers.delete(timer);
                callback();
            }, Math.min(milliseconds, settings.timerCap));
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
        open() {}
    };

    let fetchCalls = [];
    const requestOptions = [];
    let fetchCount = 0;
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetch = (url, options) => {
        fetchCalls.push(url);
        requestOptions.push(options);
        fetchCount += 1;
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        return Promise.resolve().then(() => fetchPlan(url, options, fetchCount)).finally(() => {
            activeRequests -= 1;
        });
    };

    const context = vm.createContext({
        window,
        document,
        navigator: window.navigator,
        fetch,
        URL,
        Blob,
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
        revoked,
        createdUrls,
        createdElements,
        clipboardWrites,
        historyCalls,
        fetchCalls,
        requestOptions,
        maxActiveRequests() {
            return maxActiveRequests;
        },
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

function responseFor(status, options) {
    return (url, requestOptions) => Promise.resolve(
        makeResponse(status, Object.assign({}, options || {}, { signal: requestOptions.signal }))
    );
}

function statusText(environment) {
    return environment.status.textContent;
}

async function waitFor(predicate, message) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
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

function assertUnknownEnd(environment) {
    assert.ok(!statusText(environment).includes('已到达最后一张'));
    assert.ok(!statusText(environment).includes('已全部加载'));
    assert.ok(/无法确认|未确认|不能确认|不确定/.test(statusText(environment)),
        'paused scans must disclose that later pages are unconfirmed');
    assert.ok(retryButton(environment), 'a failed page must remain retryable');
}

async function testProgressiveCardsPauseAtUnknownPage() {
    let releaseSecond;
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123.jpg')) {
            return responseFor(200)(url, options);
        }
        if (url.endsWith('/123-2.jpg')) {
            return new Promise((resolve) => {
                releaseSecond = () => resolve(makeResponse(200));
            });
        }
        return Promise.reject(new TypeError('cors failure'));
    }, { failover: false, timeout: 500, timerCap: 500 });
    await waitFor(() => releaseSecond);
    assert.strictEqual(environment.cards().length, 1, 'the first card must appear before page two finishes');
    releaseSecond();
    await waitFor(() => retryButton(environment));
    assert.strictEqual(environment.cards().length, 2, 'successful pages must remain visible together');
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://pixiv.re/123.jpg',
        'https://pixiv.re/123-2.jpg',
        'https://pixiv.re/123-3.jpg'
    ]);
    const images = environment.cards().map((card) => card.querySelector('[data-zibll-pixiv-image]'));
    assert.deepStrictEqual(images.map((image) => image.src), ['blob:test-1', 'blob:test-2']);
    assert.deepStrictEqual(environment.revoked, [], 'visible card object URLs must stay valid');
    assertUnknownEnd(environment);
}

async function testFailuresPauseWithoutClaimingCompletion() {
    for (const failure of ['404', 'network', 'notImage']) {
        const environment = createEnvironment((url, options) => {
            if (url.endsWith('/123.jpg')) {
                return responseFor(200)(url, options);
            }
            if (failure === 'network') {
                return Promise.reject(new TypeError('cors failure'));
            }
            return responseFor(failure === '404' ? 404 : 200, {
                headers: { 'content-type': failure === 'notImage' ? 'text/html' : 'image/jpeg' }
            })(url, options);
        }, { failover: false });
        await waitFor(() => retryButton(environment));
        assert.strictEqual(environment.cards().length, 1, failure + ' must preserve loaded cards');
        assert.deepStrictEqual(environment.fetchCalls, [
            'https://pixiv.re/123.jpg',
            'https://pixiv.re/123-2.jpg'
        ]);
        assertUnknownEnd(environment);
    }
}

async function testRetryKeepsFailedPageAndLoadedCards() {
    let pageTwoAttempts = 0;
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123.jpg')) {
            return responseFor(200)(url, options);
        }
        if (url.endsWith('/123-2.jpg')) {
            pageTwoAttempts += 1;
            return pageTwoAttempts === 1
                ? responseFor(500)(url, options)
                : responseFor(200)(url, options);
        }
        return responseFor(404)(url, options);
    }, { failover: false });
    await waitFor(() => retryButton(environment));
    const firstCard = environment.cards()[0];
    retryButton(environment).click();
    await waitFor(() => environment.cards().length === 2 && retryButton(environment));
    assert.strictEqual(pageTwoAttempts, 2, 'retry must request the failed page, not skip it');
    assert.strictEqual(environment.cards()[0], firstCard, 'retry must not replace loaded cards');
    assert.deepStrictEqual(environment.revoked, [], 'retry must not invalidate displayed images');
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://pixiv.re/123.jpg',
        'https://pixiv.re/123-2.jpg',
        'https://pixiv.re/123-2.jpg',
        'https://pixiv.re/123-3.jpg'
    ]);
}

async function testSameArtworkSubmissionResumesFailedPage() {
    let pageTwoAttempts = 0;
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123.jpg')) {
            return responseFor(200)(url, options);
        }
        if (url.endsWith('/123-2.jpg')) {
            pageTwoAttempts += 1;
            return responseFor(pageTwoAttempts === 1 ? 500 : 200)(url, options);
        }
        return responseFor(404)(url, options);
    }, { failover: false });
    await waitFor(() => retryButton(environment));
    const firstCard = environment.cards()[0];
    environment.input.value = '123';
    environment.form.dispatch('submit');
    await waitFor(() => environment.cards().length === 2 && retryButton(environment));
    assert.strictEqual(environment.cards()[0], firstCard);
    assert.strictEqual(environment.fetchCalls.filter((url) => url.endsWith('/123.jpg')).length, 1);
    assert.strictEqual(pageTwoAttempts, 2);
    assert.deepStrictEqual(environment.revoked, []);
}

async function testSameArtworkSubmissionDuringLoadIsIdempotent() {
    let releaseFirst;
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123.jpg')) {
            return new Promise((resolve) => {
                releaseFirst = () => resolve(makeResponse(200));
            });
        }
        return responseFor(404)(url, options);
    }, { failover: false, timeout: 500, timerCap: 500 });
    await waitFor(() => releaseFirst);
    environment.form.dispatch('submit');
    environment.form.dispatch('submit');
    await wait(10);
    assert.deepStrictEqual(environment.fetchCalls, ['https://pixiv.re/123.jpg']);
    assert.ok(!environment.requestOptions[0].signal.aborted, 'duplicate submits must preserve the active request');
    releaseFirst();
    await waitFor(() => retryButton(environment));
    assert.strictEqual(environment.cards().length, 1);
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://pixiv.re/123.jpg', 'https://pixiv.re/123-2.jpg'
    ]);
}

async function testBodyTimeout() {
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123.jpg')) {
            return responseFor(200)(url, options);
        }
        return Promise.resolve(makeResponse(200, { hanging: true, signal: options.signal }));
    }, { failover: false });
    await waitFor(() => retryButton(environment));
    assert.ok(statusText(environment).includes('网络超时'), 'timeout must include response-body reads');
    assert.ok(environment.requestOptions[1].signal.aborted);
    assert.strictEqual(environment.cards().length, 1);
    assertUnknownEnd(environment);
}

async function testSwitchArtworkCancelsStaleResponse() {
    let releaseOldPage;
    let oldSignal;
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123-3.jpg')) {
            oldSignal = options.signal;
            return new Promise((resolve) => {
                releaseOldPage = () => resolve(makeResponse(200));
            });
        }
        if (url.endsWith('/456-2.jpg')) {
            return responseFor(404)(url, options);
        }
        return responseFor(200)(url, options);
    }, { failover: false, timeout: 500, timerCap: 500 });
    await waitFor(() => releaseOldPage);
    assert.strictEqual(environment.cards().length, 2);
    environment.input.value = '456';
    environment.form.dispatch('submit');
    await waitFor(() => retryButton(environment));
    assert.ok(oldSignal.aborted, 'switching artwork must abort its pending image request');
    assert.deepStrictEqual(environment.revoked, ['blob:test-1', 'blob:test-2']);
    releaseOldPage();
    await wait(10);
    assert.strictEqual(environment.cards().length, 1, 'late old-artwork responses must not append cards');
    assert.strictEqual(environment.cards()[0].querySelector('[data-zibll-pixiv-image]').src, 'blob:test-3');
    assert.strictEqual(environment.root.getAttribute('data-id'), '456');
    assert.strictEqual(environment.source.href, 'https://www.pixiv.net/artworks/456');
    assert.deepStrictEqual(environment.createdUrls, ['blob:test-1', 'blob:test-2', 'blob:test-3']);
}

async function testSwitchArtworkCancels503Backoff() {
    let oldSignal;
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123.jpg')) {
            oldSignal = options.signal;
            return responseFor(503, { headers: { 'retry-after': '1' } })(url, options);
        }
        return responseFor(url.endsWith('/456.jpg') ? 200 : 404)(url, options);
    }, { failover: false, timeout: 500, timerCap: 40 });
    await waitFor(() => statusText(environment).includes('服务繁忙'));
    environment.input.value = '456';
    environment.form.dispatch('submit');
    await waitFor(() => retryButton(environment));
    const newStatus = statusText(environment);
    assert.ok(oldSignal.aborted, 'switching must cancel an in-progress Retry-After wait');
    await wait(70);
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://pixiv.re/123.jpg',
        'https://pixiv.re/456.jpg',
        'https://pixiv.re/456-2.jpg'
    ]);
    assert.strictEqual(environment.cards().length, 1);
    assert.strictEqual(statusText(environment), newStatus, 'old backoff must not change the new artwork status');
    assert.strictEqual(environment.root.getAttribute('data-id'), '456');
}

async function testUnloadRevokesEveryImage() {
    let hangingSignal;
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123-3.jpg')) {
            hangingSignal = options.signal;
            return Promise.resolve(makeResponse(200, { hanging: true, signal: options.signal }));
        }
        return responseFor(200)(url, options);
    }, { failover: false, timeout: 500, timerCap: 500 });
    await waitFor(() => hangingSignal);
    assert.strictEqual(environment.cards().length, 2);
    environment.close();
    assert.ok(hangingSignal.aborted);
    assert.deepStrictEqual(environment.revoked, ['blob:test-1', 'blob:test-2']);
    await wait(10);
    assert.ok(!environment.fetchCalls.some((url) => url.endsWith('/123-4.jpg')));
}

async function testPageOneDirectFallback() {
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123.jpg')) {
            return Promise.reject(new TypeError('cors redirect'));
        }
        return responseFor(url.endsWith('/123-1.jpg') ? 200 : 404)(url, options);
    }, { failover: false });
    await waitFor(() => retryButton(environment));
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://pixiv.re/123.jpg',
        'https://pixiv.re/123-1.jpg',
        'https://pixiv.re/123-2.jpg'
    ]);
    assert.strictEqual(environment.cards().length, 1);
}

async function testDirect404StillAllowsBackup() {
    const environment = createEnvironment((url, options) => {
        if (url === 'https://pixiv.re/123.jpg') {
            return Promise.reject(new TypeError('cors redirect'));
        }
        if (url === 'https://pixiv.re/123-1.jpg') {
            return responseFor(404)(url, options);
        }
        return responseFor(url === 'https://pixiv.nl/123.jpg' ? 200 : 404)(url, options);
    });
    await waitFor(() => retryButton(environment));
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://pixiv.re/123.jpg',
        'https://pixiv.re/123-1.jpg',
        'https://pixiv.nl/123.jpg',
        'https://pixiv.re/123-2.jpg'
    ]);
    assert.strictEqual(environment.cards().length, 1);
}

async function testBadStatusDoesNotFailover() {
    for (const status of [400, 404]) {
        const environment = createEnvironment((url, options) => responseFor(status)(url, options));
        await waitFor(() => retryButton(environment));
        assert.deepStrictEqual(
            environment.fetchCalls,
            ['https://pixiv.re/123.jpg'],
            status + ' from the base URL must not fail over'
        );
    }
}

async function test503RetriesAtMostThreeTimes() {
    for (const eventualSuccess of [true, false]) {
        let pageOneCalls = 0;
        const environment = createEnvironment((url, options) => {
            if (!url.endsWith('/123.jpg')) {
                return responseFor(404)(url, options);
            }
            pageOneCalls += 1;
            return eventualSuccess && pageOneCalls === 3
                ? responseFor(200)(url, options)
                : responseFor(503, { headers: { 'retry-after': '0' } })(url, options);
        }, { failover: false });
        await waitFor(() => retryButton(environment));
        assert.strictEqual(pageOneCalls, 3);
        assert.strictEqual(environment.cards().length, eventualSuccess ? 1 : 0);
    }
}

async function testSequentialRequests() {
    const environment = createEnvironment((url) => new Promise((resolve) => {
        setTimeout(() => resolve(makeResponse(url.endsWith('/123-4.jpg') ? 404 : 200)), 10);
    }), { failover: false, timeout: 500, timerCap: 500 });
    await waitFor(() => retryButton(environment));
    assert.strictEqual(environment.cards().length, 3);
    assert.strictEqual(environment.maxActiveRequests(), 1, 'automatic scanning must stay sequential');
    environment.requestOptions.forEach((options) => {
        assert.strictEqual(options.mode, 'cors');
        assert.strictEqual(options.credentials, 'omit');
    });
}

async function testPerCardCopyDownloadAndLightbox() {
    const environment = createEnvironment((url, options) => responseFor(
        url.endsWith('/123-3.jpg') ? 404 : 200
    )(url, options), { failover: false });
    await waitFor(() => retryButton(environment));
    environment.cards().forEach((card) => {
        card.querySelector('[data-zibll-pixiv-copy]').click();
        card.querySelector('[data-zibll-pixiv-download]').click();
    });
    await wait(0);
    assert.deepStrictEqual(environment.clipboardWrites, [
        'https://pixiv.re/123.jpg', 'https://pixiv.re/123-2.jpg'
    ]);
    const downloads = environment.createdElements.filter((element) => element.download && element.wasClicked);
    assert.deepStrictEqual(downloads.map((anchor) => anchor.download), ['123_p0.jpg', '123_p1.jpg']);
    assert.deepStrictEqual(downloads.map((anchor) => anchor.href), ['blob:test-1', 'blob:test-2']);
    assert.deepStrictEqual(environment.cards().map(
        (card) => card.querySelector('[data-zibll-pixiv-lightbox]').href
    ), ['blob:test-1', 'blob:test-2']);
    environment.window.navigator.clipboard = null;
    environment.cards()[0].querySelector('[data-zibll-pixiv-copy]').click();
    assert.ok(environment.cards()[0].querySelector('[data-zibll-pixiv-card-status]').textContent.includes(
        'https://pixiv.re/123.jpg'
    ));
    assert.ok(retryButton(environment), 'a per-card copy fallback must not remove the scan retry');
}

async function singleCardEnvironment() {
    const environment = createEnvironment((url, options) => responseFor(
        url.endsWith('/123.jpg') ? 200 : 404
    )(url, options), { failover: false });
    await waitFor(() => retryButton(environment));
    return environment;
}

async function testThemeLightboxPreventsNativeNavigation() {
    const environment = await singleCardEnvironment();
    environment.window.Miniimgbox = function () {};
    environment.window._win = { imgbox: true };
    const image = environment.cards()[0].querySelector('[data-zibll-pixiv-image]');
    let delegatedClicks = 0;
    environment.body.addEventListener('click', (event) => {
        if (event.target === image) {
            delegatedClicks += 1;
        }
    });
    image.click();
    assert.ok(image.lastClickEvent.defaultPrevented, 'theme lightbox clicks must not also open the Blob URL');
    assert.strictEqual(delegatedClicks, 1, 'the image click must still reach the theme body delegate');
}

async function testMissingThemeLightboxKeepsNativeNavigation() {
    const environment = await singleCardEnvironment();
    const card = environment.cards()[0];
    const image = card.querySelector('[data-zibll-pixiv-image]');
    const lightbox = card.querySelector('[data-zibll-pixiv-lightbox]');
    for (const theme of [
        { constructor: undefined, settings: { imgbox: true } },
        { constructor: function () {}, settings: { imgbox: false } },
        { constructor: function () {}, settings: undefined }
    ]) {
        environment.window.Miniimgbox = theme.constructor;
        environment.window._win = theme.settings;
        image.click();
        assert.ok(!image.lastClickEvent.defaultPrevented, 'native image opening is the no-lightbox fallback');
        const imageClicks = image.clickCount;
        lightbox.click();
        assert.ok(!lightbox.lastClickEvent.defaultPrevented, 'native keyboard link opening must remain available');
        assert.strictEqual(image.clickCount, imageClicks, 'disabled lightboxes must not synthesize extra image clicks');
    }
}

async function testLightboxKeyboardActivationDelegatesOnce() {
    const environment = await singleCardEnvironment();
    environment.window.Miniimgbox = function () {};
    environment.window._win = { imgbox: true };
    const card = environment.cards()[0];
    const image = card.querySelector('[data-zibll-pixiv-image]');
    const lightbox = card.querySelector('[data-zibll-pixiv-lightbox]');
    let delegatedImages = 0;
    environment.body.addEventListener('click', (event) => {
        if (event.target === image) {
            delegatedImages += 1;
        }
    });
    lightbox.click();
    assert.ok(lightbox.lastClickEvent.defaultPrevented, 'keyboard activation must not open a second tab');
    assert.ok(image.lastClickEvent.defaultPrevented, 'the synthesized image event must also prevent native navigation');
    assert.strictEqual(lightbox.clickCount, 1);
    assert.strictEqual(image.clickCount, 1, 'keyboard activation must synthesize exactly one image click');
    assert.strictEqual(delegatedImages, 1, 'the theme delegate must receive the image event without recursion');
}

async function testPageLimit() {
    const environment = createEnvironment(responseFor(200), { failover: false });
    await waitFor(() => environment.cards().length === 50);
    await wait(10);
    assert.strictEqual(environment.fetchCalls.length, 50);
    assert.strictEqual(environment.fetchCalls[49], 'https://pixiv.re/123-50.jpg');
    assert.strictEqual(environment.cards().length, 50);
    assert.ok(statusText(environment).includes('50'), 'the page cap must be explained');
    assert.ok(!statusText(environment).includes('已全部加载'));
    assert.strictEqual(retryButton(environment), null, 'the hard page limit cannot be retried past');
}

async function testDeepLinkStartingPage() {
    const environment = createEnvironment((url, options) => responseFor(
        url.endsWith('/123-3.jpg') ? 200 : 404
    )(url, options), { failover: false, initialPage: 3 });
    await waitFor(() => retryButton(environment));
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://pixiv.re/123-3.jpg', 'https://pixiv.re/123-4.jpg'
    ]);
    assert.strictEqual(environment.cards().length, 1);
    assert.ok(environment.cards()[0].querySelector('[data-zibll-pixiv-card-page]').textContent.includes('3'));
    environment.cards()[0].querySelector('[data-zibll-pixiv-download]').click();
    const download = environment.createdElements.find((element) => element.download && element.wasClicked);
    assert.strictEqual(download.download, '123_p2.jpg');
}

async function testBlockedAndFilteredArtworkDoNotFetch() {
    const blocked = createEnvironment(responseFor(200), { blocked: true });
    await wait(10);
    assert.deepStrictEqual(blocked.fetchCalls, []);
    const filtered = createEnvironment(responseFor(200), { initialId: '', filterEffective: true });
    filtered.input.value = '456';
    filtered.form.dispatch('submit');
    await wait(10);
    assert.deepStrictEqual(filtered.fetchCalls, [], 'filtered submissions must go through the server');
    assert.strictEqual(filtered.window.location.href, 'https://site.test/pixiv/456/');
}

const tests = [
    ['progressive cards pause at unknown page', testProgressiveCardsPauseAtUnknownPage],
    ['404/network/non-image pause without claiming completion', testFailuresPauseWithoutClaimingCompletion],
    ['retry keeps failed page and loaded cards', testRetryKeepsFailedPageAndLoadedCards],
    ['same artwork submission resumes failed page', testSameArtworkSubmissionResumesFailedPage],
    ['same artwork submission during load is idempotent', testSameArtworkSubmissionDuringLoadIsIdempotent],
    ['body timeout', testBodyTimeout],
    ['switch artwork cancels stale responses and revokes URLs', testSwitchArtworkCancelsStaleResponse],
    ['switch artwork cancels 503 backoff', testSwitchArtworkCancels503Backoff],
    ['unload revokes every image', testUnloadRevokesEveryImage],
    ['page-one direct fallback', testPageOneDirectFallback],
    ['direct 404 allows backup', testDirect404StillAllowsBackup],
    ['400/404 base no failover', testBadStatusDoesNotFailover],
    ['bounded 503 retry', test503RetriesAtMostThreeTimes],
    ['sequential requests', testSequentialRequests],
    ['per-card copy/download/lightbox', testPerCardCopyDownloadAndLightbox],
    ['theme lightbox prevents native navigation', testThemeLightboxPreventsNativeNavigation],
    ['missing theme lightbox keeps native navigation', testMissingThemeLightboxKeepsNativeNavigation],
    ['lightbox keyboard activation delegates once', testLightboxKeyboardActivationDelegatesOnce],
    ['50-page cap', testPageLimit],
    ['deep-link starting page', testDeepLinkStartingPage],
    ['blocked and filtered artwork do not fetch', testBlockedAndFilteredArtworkDoNotFetch]
];

(async () => {
    let failed = 0;
    for (const [name, test] of tests) {
        let deadline;
        try {
            await Promise.race([
                test(),
                new Promise((resolve, reject) => {
                    deadline = setTimeout(() => reject(new Error('test timeout')), 2000);
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
