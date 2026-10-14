'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const viewerSource = fs.readFileSync(
    require('path').join(__dirname, '..', 'assets', 'js', 'viewer.js'),
    'utf8'
);

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

    querySelector(selector) {
        return this.childrenBySelector && this.childrenBySelector[selector]
            ? this.childrenBySelector[selector]
            : null;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    remove() {
        this.removed = true;
    }

    addEventListener(type, callback) {
        if (!this.listeners[type]) {
            this.listeners[type] = [];
        }
        this.listeners[type].push(callback);
    }

    dispatch(type, event) {
        const callbacks = this.listeners[type] || [];
        callbacks.forEach((callback) => callback(event || {
            preventDefault() {}
        }));
    }

    click() {
        this.dispatch('click', {
            preventDefault() {}
        });
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
        strings: {}
    }, overrides || {});
    const selectors = {};
    const root = new FakeElement('main', {
        'data-id': '123',
        'data-page': '1',
        'data-base-url': settings.baseUrl,
        'data-blocked': '0',
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
    selectors['[data-zibll-pixiv-image-wrap]'] = create('div', '[data-zibll-pixiv-image-wrap]');
    selectors['[data-zibll-pixiv-image]'] = create('img', '[data-zibll-pixiv-image]');
    selectors['[data-zibll-pixiv-lightbox]'] = create('a', '[data-zibll-pixiv-lightbox]');
    selectors['[data-zibll-pixiv-toolbar]'] = create('div', '[data-zibll-pixiv-toolbar]');
    selectors['[data-zibll-pixiv-status]'] = create('p', '[data-zibll-pixiv-status]');
    selectors['[data-zibll-pixiv-page]'] = create('input', '[data-zibll-pixiv-page]');
    selectors['[data-zibll-pixiv-prev]'] = create('button', '[data-zibll-pixiv-prev]');
    selectors['[data-zibll-pixiv-next]'] = create('button', '[data-zibll-pixiv-next]');
    selectors['[data-zibll-pixiv-download]'] = create('button', '[data-zibll-pixiv-download]');
    selectors['[data-zibll-pixiv-copy]'] = create('button', '[data-zibll-pixiv-copy]');
    root.childrenBySelector = selectors;
    selectors['#zibll-pixiv-input'].value = '123';
    selectors['[data-zibll-pixiv-page]'].value = '1';

    const revoked = [];
    let objectUrlCounter = 0;
    const historyCalls = [];
    const windowListeners = {};
    const body = new FakeElement('body');
    const document = {
        body,
        querySelector(selector) {
            return selector === '[data-zibll-pixiv-viewer]' ? root : null;
        },
        createElement(tagName) {
            return new FakeElement(tagName);
        }
    };
    const window = {
        ZibllPixivConfig: settings,
        URL: {
            createObjectURL() {
                objectUrlCounter += 1;
                return 'blob:test-' + objectUrlCounter;
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
            clipboard: null
        },
        setTimeout(callback, milliseconds) {
            return setTimeout(callback, Math.min(milliseconds, settings.timerCap));
        },
        clearTimeout,
        addEventListener(type, callback) {
            windowListeners[type] = callback;
        },
        open() {}
    };

    let fetchCalls = [];
    let fetchCount = 0;
    const fetch = (url, options) => {
        fetchCalls.push(url);
        fetchCount += 1;
        return fetchPlan(url, options, fetchCount);
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
    vm.runInContext(viewerSource, context, { filename: 'viewer.js' });

    return {
        root,
        image: selectors['[data-zibll-pixiv-image]'],
        status: selectors['[data-zibll-pixiv-status]'],
        pageInput: selectors['[data-zibll-pixiv-page]'],
        next: selectors['[data-zibll-pixiv-next]'],
        previous: selectors['[data-zibll-pixiv-prev]'],
        revoked,
        historyCalls,
        fetchCalls,
        window,
        body
    };
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

async function testObjectUrlCacheReuse() {
    const environment = createEnvironment(responseFor(200), { failover: false });
    await wait(30);
    environment.next.click();
    await wait(30);
    environment.previous.click();
    await wait(30);
    assert.strictEqual(environment.image.src, 'blob:test-1');
    assert.ok(
        !environment.revoked.includes(environment.image.src),
        'a cached object URL must not be reused after revokeObjectURL'
    );
}

async function testBodyTimeout() {
    const environment = createEnvironment((url, options) => Promise.resolve(
        makeResponse(200, { hanging: true, signal: options.signal })
    ), { failover: false });
    await wait(120);
    assert.ok(
        statusText(environment).includes('网络超时'),
        'body timeout must abort a response whose headers already arrived'
    );
}

async function testFailedNavigationDoesNotSkipPage() {
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
        return responseFor(200)(url, options);
    }, { failover: false });
    await wait(30);
    environment.next.click();
    await wait(30);
    assert.strictEqual(environment.image.src, 'blob:test-1');
    environment.next.click();
    await wait(30);
    assert.strictEqual(pageTwoAttempts, 2, 'next after a failed page must retry that page');
    assert.ok(environment.image.src, 'the retry should eventually load an image');
}

async function testCacheHitCancelsStaleRequest() {
    let releasePageTwo;
    const environment = createEnvironment((url, options) => {
        if (url.endsWith('/123.jpg')) {
            return responseFor(200)(url, options);
        }
        if (url.endsWith('/123-2.jpg')) {
            return new Promise((resolve, reject) => {
                releasePageTwo = () => resolve(makeResponse(200, { signal: options.signal }));
                options.signal.addEventListener('abort', () => {
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                }, { once: true });
            });
        }
        return responseFor(200)(url, options);
    }, { failover: false, timeout: 100, timerCap: 200 });
    await wait(30);
    environment.next.click();
    await wait(5);
    environment.previous.click();
    await wait(30);
    assert.strictEqual(environment.image.src, 'blob:test-1');
    if (releasePageTwo) {
        releasePageTwo();
    }
    await wait(30);
    assert.strictEqual(environment.image.src, 'blob:test-1');
    assert.strictEqual(environment.root.getAttribute('data-page'), '1');
}

async function testPageOneDirectFallback() {
    let calls = 0;
    const environment = createEnvironment((url, options) => {
        calls += 1;
        return calls === 1
            ? Promise.reject(new TypeError('cors redirect'))
            : responseFor(200)(url, options);
    }, { failover: false });
    await wait(40);
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://pixiv.re/123.jpg',
        'https://pixiv.re/123-1.jpg'
    ]);
    assert.ok(environment.image.src, 'the direct page-one fallback should load');
}

async function testDirect404StillAllowsBackup() {
    const environment = createEnvironment((url, options) => {
        if (url === 'https://pixiv.re/123.jpg') {
            return Promise.reject(new TypeError('cors redirect'));
        }
        if (url === 'https://pixiv.re/123-1.jpg') {
            return responseFor(404)(url, options);
        }
        return responseFor(200)(url, options);
    });
    await wait(50);
    assert.deepStrictEqual(environment.fetchCalls, [
        'https://pixiv.re/123.jpg',
        'https://pixiv.re/123-1.jpg',
        'https://pixiv.nl/123.jpg'
    ]);
    assert.ok(environment.image.src, 'backup base URL should load after direct fallback 404');
}

async function testBadStatusDoesNotFailover() {
    for (const status of [400, 404]) {
        const environment = createEnvironment((url, options) => responseFor(status)(url, options));
        await wait(30);
        assert.deepStrictEqual(
            environment.fetchCalls,
            ['https://pixiv.re/123.jpg'],
            status + ' from the base URL must not fail over'
        );
    }
}

async function test503RetriesAtMostThreeTimes() {
    let calls = 0;
    const environment = createEnvironment((url, options) => {
        calls += 1;
        return calls < 3
            ? responseFor(503, { headers: { 'retry-after': '0' } })(url, options)
            : responseFor(200)(url, options);
    }, { failover: false });
    await wait(100);
    assert.strictEqual(calls, 3);
    assert.ok(environment.image.src, 'a successful response after bounded retries should load');
}

async function testNetworkFailureIsNotLastPage() {
    const environment = createEnvironment((url) => {
        if (url.endsWith('/123.jpg')) {
            return responseFor(200)(url, { signal: new AbortController().signal });
        }
        return Promise.reject(new TypeError('cors failure'));
    }, { failover: false });
    await wait(30);
    environment.next.click();
    await wait(50);
    assert.ok(statusText(environment).includes('网络超时'));
    assert.ok(!statusText(environment).includes('已到达最后一张'));
}

const tests = [
    ['object URL cache reuse', testObjectUrlCacheReuse],
    ['body timeout', testBodyTimeout],
    ['failed navigation page state', testFailedNavigationDoesNotSkipPage],
    ['cache hit cancels stale request', testCacheHitCancelsStaleRequest],
    ['page-one direct fallback', testPageOneDirectFallback],
    ['direct 404 allows backup', testDirect404StillAllowsBackup],
    ['400/404 base no failover', testBadStatusDoesNotFailover],
    ['bounded 503 retry', test503RetriesAtMostThreeTimes],
    ['network failure is not last page', testNetworkFailureIsNotLastPage]
];

(async () => {
    let failed = 0;
    for (const [name, test] of tests) {
        try {
            await Promise.race([
                test(),
                new Promise((resolve, reject) => {
                    setTimeout(() => reject(new Error('test timeout')), 1000);
                })
            ]);
            console.log('PASS ' + name);
        } catch (error) {
            failed += 1;
            console.error('FAIL ' + name + ': ' + error.message);
        }
    }
    if (failed > 0) {
        process.exitCode = 1;
    }
})();
