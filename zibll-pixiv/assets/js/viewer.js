(function () {
    'use strict';

    var config = window.ZibllPixivConfig || {};
    var root = document.querySelector('[data-zibll-pixiv-viewer]');
    if (!root) {
        return;
    }

    var form = root.querySelector('[data-zibll-pixiv-form]');
    var input = root.querySelector('#zibll-pixiv-input');
    var formError = root.querySelector('[data-zibll-pixiv-form-error]');
    var result = root.querySelector('[data-zibll-pixiv-result]');
    var imageWrap = root.querySelector('[data-zibll-pixiv-image-wrap]');
    var image = root.querySelector('[data-zibll-pixiv-image]');
    var lightbox = root.querySelector('[data-zibll-pixiv-lightbox]');
    var toolbar = root.querySelector('[data-zibll-pixiv-toolbar]');
    var status = root.querySelector('[data-zibll-pixiv-status]');
    var pageInput = root.querySelector('[data-zibll-pixiv-page]');
    var prevButton = root.querySelector('[data-zibll-pixiv-prev]');
    var nextButton = root.querySelector('[data-zibll-pixiv-next]');
    var downloadButton = root.querySelector('[data-zibll-pixiv-download]');
    var copyButton = root.querySelector('[data-zibll-pixiv-copy]');
    var current = {
        id: root.getAttribute('data-id') || '',
        page: parseInt(root.getAttribute('data-page') || '1', 10) || 1,
        userId: '',
        url: '',
        filename: '',
        blob: null,
        objectUrl: '',
        requestId: 0,
        controller: null,
        cache: {},
        loadedPage: 0,
        retryPage: 0
    };
    var maxPages = 50;

    var strings = config.strings || {};
    var fallbackStrings = {
        empty: '请输入 Pixiv 作品 ID 或链接',
        invalid: '无法识别输入，请粘贴 Pixiv 作品链接或纯数字 ID',
        leadingZero: '作品 ID 不能以 0 开头',
        invalidPage: '页码格式不正确',
        loading: '正在加载图片…',
        network: '网络超时，请检查网络后重试',
        badRequest: '作品 ID 格式不正确，请检查后重试',
        notFound: '作品不存在、已被删除或限制访问',
        server: '图片代理服务异常，请稍后重试',
        busy: '服务繁忙，请稍后自动重试',
        notImage: '未获取到图片',
        failed: '暂时无法获取，请稍后再试或切换代理域名',
        lastPage: '已到达最后一张',
        download: '下载原图',
        copy: '复制直链',
        copied: '已复制',
        retry: '重试',
        previous: '上一张',
        next: '下一张',
        page: '页码',
        downloadFallback: '浏览器无法直接下载，将在新窗口打开图片。'
    };
    Object.keys(fallbackStrings).forEach(function (key) {
        if (!strings[key]) {
            strings[key] = fallbackStrings[key];
        }
    });

    function parseId(value) {
        var inputValue = String(value || '').trim();
        if (!inputValue) {
            return { error: 'empty' };
        }

        var bracketMatch = inputValue.match(/^\[(?:图片ID|Image\s*ID)\s*:\s*([^\]]+)\]$/i);
        if (bracketMatch) {
            inputValue = bracketMatch[1].trim();
        }
        if (/^\d+$/.test(inputValue)) {
            return validate(inputValue, 1, '');
        }
        if (/^user:\d+$/i.test(inputValue)) {
            return { error: 'missing_artwork_id' };
        }

        var normalized = inputValue;
        if (!/^https?:\/\//i.test(normalized)) {
            normalized = 'https://' + normalized;
        }
        var url;
        try {
            url = new URL(normalized);
        } catch (error) {
            return { error: 'unrecognized' };
        }
        if (url.protocol !== 'https:') {
            return { error: 'unrecognized' };
        }

        var host = url.hostname.toLowerCase();
        if (['pixiv.net', 'www.pixiv.net', 'pixiv.re', 'pixiv.nl'].indexOf(host) === -1) {
            return { error: 'unrecognized' };
        }

        var id = '';
        var page = 1;
        var userId = '';
        var userArtwork = url.pathname.match(/^\/users?\/(\d+)\/(?:artworks?|illustrations?)\/(\d+)\/?$/i);
        var artwork = url.pathname.match(/^\/artworks?\/(\d+)\/?$/i);
        var proxy = url.pathname.match(/^\/(\d+)(?:-(\d+))?(?:\.[a-z0-9]+)?\/?$/i);
        if (userArtwork && host.indexOf('pixiv.net') !== -1) {
            userId = userArtwork[1];
            id = userArtwork[2];
        } else if (artwork && host.indexOf('pixiv.net') !== -1) {
            id = artwork[1];
        } else if (host === 'pixiv.re' || host === 'pixiv.nl') {
            if (proxy) {
                id = proxy[1];
                page = proxy[2] ? parseInt(proxy[2], 10) : 1;
            }
        } else if (host.indexOf('pixiv.net') !== -1 && url.searchParams.get('illust_id')) {
            id = url.searchParams.get('illust_id');
        }
        if (!id && (host === 'pixiv.re' || host === 'pixiv.nl' || host.indexOf('pixiv.net') !== -1)) {
            return { error: 'invalid' };
        }

        if (url.hash && /^#\d+$/.test(url.hash)) {
            page = parseInt(url.hash.slice(1), 10);
        } else if (url.searchParams.get('page')) {
            page = parseInt(url.searchParams.get('page'), 10);
        }
        return validate(id, page, userId);
    }

    function validate(id, page, userId) {
        id = String(id || '');
        if (!id) {
            return { error: 'invalid' };
        }
        if (id.charAt(0) === '0') {
            return { error: 'leadingZero' };
        }
        if (!/^[1-9]\d{0,11}$/.test(id)) {
            return { error: 'invalid' };
        }
        if (!Number.isInteger(page) || page < 1 || page > maxPages) {
            return { error: 'invalidPage' };
        }
        return { id: id, page: page, userId: userId || '' };
    }

    function parseError(code) {
        var map = {
            empty: strings.empty,
            leadingZero: strings.leadingZero,
            invalidPage: strings.invalidPage,
            missing_artwork_id: strings.invalid,
            invalid: strings.invalid,
            unrecognized: strings.invalid
        };
        return map[code] || strings.invalid;
    }

    function setFormError(message) {
        if (!formError) {
            return;
        }
        formError.textContent = message || '';
        formError.hidden = !message;
    }

    function setStatus(message, canRetry) {
        if (!status) {
            return;
        }
        status.textContent = '';
        if (message) {
            var text = document.createElement('span');
            text.textContent = message;
            status.appendChild(text);
        }
        if (canRetry) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'zibll-pixiv-inline-retry';
            button.textContent = strings.retry;
            button.addEventListener('click', function () {
                if (current.retryPage > 0) {
                    current.page = current.retryPage;
                    current.retryPage = 0;
                }
                loadCurrent(true);
            });
            status.appendChild(button);
        }
    }

    function setLoading(loading) {
        root.classList.toggle('is-loading', loading);
        if (loading) {
            setStatus(strings.loading, false);
            if (!current.blob) {
                if (toolbar) {
                    toolbar.hidden = true;
                }
                if (imageWrap) {
                    imageWrap.hidden = true;
                }
            }
        }
    }

    function sleep(milliseconds) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, milliseconds);
        });
    }

    function domains() {
        var list = [];
        if (config.primaryDomain) {
            list.push(config.primaryDomain);
        }
        if (config.failover && config.backupDomain && list.indexOf(config.backupDomain) === -1) {
            list.push(config.backupDomain);
        }
        return list;
    }

    function imageUrl(domain, id, page, directFirstPage) {
        var suffix = page > 1 ? '-' + page : (directFirstPage ? '-1' : '');
        return 'https://' + domain + '/' + encodeURIComponent(id) + suffix + '.jpg';
    }

    function routeUrl(id, page, userId) {
        if (config.prettyPermalinks === false) {
            var query = {
                zibll_pixiv_viewer: '1',
                zibll_pixiv_id: id
            };
            if (page > 1) {
                query.zibll_pixiv_page = page;
            }
            if (userId) {
                query.zibll_pixiv_user = userId;
            }
            var queryString = Object.keys(query).map(function (key) {
                return encodeURIComponent(key) + '=' + encodeURIComponent(query[key]);
            }).join('&');
            return window.location.origin + window.location.pathname + '?' + queryString;
        }
        var targetUrl = config.baseUrl + encodeURIComponent(id) + '/';
        if (page > 1) {
            targetUrl += page + '/';
        }
        if (userId) {
            targetUrl += '?zibll_pixiv_user=' + encodeURIComponent(userId);
        }
        return targetUrl;
    }

    function filenameFromDisposition(value, id, page) {
        var fallback = id + '_p' + (page - 1) + '.jpg';
        if (!value) {
            return fallback;
        }
        var match = value.match(/filename\*?=(?:UTF-8''|["']?)([^;"']+)/i);
        if (!match) {
            return fallback;
        }
        try {
            var filename = decodeURIComponent(match[1].replace(/^["']|["']$/g, ''));
            return /^[\w.\- ()]+$/u.test(filename) ? filename : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function abortCurrentRequest() {
        if (current.controller) {
            current.controller.abort();
            current.controller = null;
        }
    }

    function revokeCacheObjectUrls(cache) {
        Object.keys(cache).forEach(function (key) {
            var entry = cache[key];
            if (entry && entry.objectUrl) {
                window.URL.revokeObjectURL(entry.objectUrl);
                entry.objectUrl = '';
            }
        });
    }

    async function fetchImage(url, requestId) {
        var attempts = 0;
        while (attempts < 3) {
            attempts += 1;
            if (requestId !== current.requestId) {
                throw new Error('aborted');
            }
            var controller = new AbortController();
            current.controller = controller;
            var timer = window.setTimeout(function () {
                controller.abort();
            }, Number(config.timeout || 15000));
            try {
                var response = await fetch(url, {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'omit',
                    signal: controller.signal,
                    cache: 'no-store'
                });
                if (response.status === 503 && attempts < 3) {
                    var retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
                    window.clearTimeout(timer);
                    if (current.controller === controller) {
                        current.controller = null;
                    }
                    setStatus(strings.busy + ' ' + Math.max(1, Math.min(15, retryAfter)) + 's', false);
                    await sleep(Math.max(1, Math.min(15, retryAfter)) * 1000);
                    continue;
                }
                if (response.status === 400) {
                    throw { type: 'badRequest' };
                }
                if (response.status === 404) {
                    throw { type: 'notFound' };
                }
                if (response.status >= 500) {
                    throw { type: 'server' };
                }
                if (!response.ok) {
                    throw { type: 'failed' };
                }
                var contentType = (response.headers.get('Content-Type') || '').toLowerCase();
                if (contentType && contentType.indexOf('image/') !== 0) {
                    throw { type: 'notImage' };
                }
                var blob = await readBlob(response, requestId);
                if (!blob || (blob.type && blob.type.indexOf('image/') !== 0)) {
                    throw { type: 'notImage' };
                }
                return {
                    url: url,
                    blob: blob,
                    filename: filenameFromDisposition(response.headers.get('Content-Disposition'), current.id, current.page)
                };
            } catch (error) {
                window.clearTimeout(timer);
                if (error && error.name === 'AbortError') {
                    throw { type: 'network' };
                }
                if (error && error.type) {
                    throw error;
                }
                // A CORS redirect commonly surfaces as a bare TypeError.
                throw { type: 'network' };
            } finally {
                window.clearTimeout(timer);
                if (current.controller === controller) {
                    current.controller = null;
                }
            }
        }
        throw { type: 'failed' };
    }

    async function readBlob(response, requestId) {
        if (!response.body || !response.body.getReader) {
            return response.blob();
        }
        var reader = response.body.getReader();
        var contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
        var received = 0;
        var chunks = [];
        while (true) {
            if (requestId !== current.requestId) {
                throw { type: 'network' };
            }
            var part = await reader.read();
            if (part.done) {
                break;
            }
            chunks.push(part.value);
            received += part.value.length;
            if (contentLength > 0) {
                setStatus(strings.loading + ' ' + Math.round((received / contentLength) * 100) + '%', false);
            }
        }
        return new Blob(chunks, { type: response.headers.get('Content-Type') || 'image/jpeg' });
    }

    async function loadCurrent(force) {
        if (!current.id) {
            return;
        }
        abortCurrentRequest();
        current.requestId += 1;
        var requestId = current.requestId;
        var key = current.id + ':' + current.page;
        if (!force && current.cache[key]) {
            applyImage(current.cache[key]);
            return;
        }
        setLoading(true);
        setFormError('');
        var tried = [];
        var lastError = null;
        var hostList = domains();
        for (var i = 0; i < hostList.length; i += 1) {
            var candidateUrls = [imageUrl(hostList[i], current.id, current.page, false)];
            if (current.page === 1) {
                candidateUrls.push(imageUrl(hostList[i], current.id, current.page, true));
            }
            var stopFailover = false;
            for (var candidateIndex = 0; candidateIndex < candidateUrls.length; candidateIndex += 1) {
                var url = candidateUrls[candidateIndex];
                tried.push(url);
                try {
                    var resultData = await fetchImage(url, requestId);
                    if (requestId !== current.requestId) {
                        return;
                    }
                    if (current.cache[key] && current.cache[key].objectUrl) {
                        window.URL.revokeObjectURL(current.cache[key].objectUrl);
                        current.cache[key].objectUrl = '';
                    }
                    current.cache[key] = resultData;
                    applyImage(resultData);
                    return;
                } catch (error) {
                    if (error && (error.type === 'notFound' || error.type === 'badRequest')) {
                        lastError = error;
                        stopFailover = candidateIndex === 0;
                        break;
                    }
                    lastError = error;
                    // Only a network/CORS failure may use the page-one direct variant.
                    if (candidateIndex === 0 && current.page === 1 && error && error.type === 'network') {
                        continue;
                    }
                    break;
                }
            }
            if (stopFailover) {
                break;
            }
        }
        if (requestId !== current.requestId) {
            return;
        }
        var failedPage = current.page;
        if (lastError && lastError.type === 'notFound') {
            setLoading(false);
            if (current.loadedPage > 0) {
                if (current.page !== current.loadedPage) {
                    current.retryPage = failedPage;
                }
                current.page = current.loadedPage;
                pageInput.value = current.loadedPage;
                prevButton.disabled = current.loadedPage <= 1;
                nextButton.disabled = true;
                root.setAttribute('data-page', String(current.loadedPage));
                setStatus(strings.lastPage, false);
            } else if (current.page > 1) {
                setStatus(strings.lastPage, false);
                nextButton.disabled = true;
            } else {
                setStatus(strings.notFound, true);
            }
        } else {
            if (current.loadedPage > 0 && current.page !== current.loadedPage) {
                current.retryPage = failedPage;
                current.page = current.loadedPage;
                pageInput.value = current.loadedPage;
                prevButton.disabled = current.loadedPage <= 1;
                nextButton.disabled = current.loadedPage >= maxPages;
                root.setAttribute('data-page', String(current.loadedPage));
            }
            setLoading(false);
            var message = strings.failed;
            if (lastError && strings[lastError.type]) {
                message = strings[lastError.type];
            }
            setStatus(message, true);
        }
    }

    function applyImage(data) {
        if (!data) {
            return;
        }
        setLoading(false);
        if (!data.objectUrl) {
            data.objectUrl = window.URL.createObjectURL(data.blob);
        }
        current.objectUrl = data.objectUrl;
        current.url = data.url;
        current.filename = data.filename;
        current.blob = data.blob;
        current.loadedPage = current.page;
        current.retryPage = 0;
        image.src = data.objectUrl;
        image.alt = 'Pixiv artwork ' + current.id + ' page ' + current.page;
        lightbox.href = data.objectUrl;
        imageWrap.hidden = false;
        toolbar.hidden = false;
        pageInput.value = current.page;
        prevButton.disabled = current.page <= 1;
        nextButton.disabled = false;
        setStatus('', false);
        root.setAttribute('data-id', current.id);
        root.setAttribute('data-page', String(current.page));
        window.history.replaceState({}, '', routeUrl(current.id, current.page, current.userId));
        if (typeof window.auto_fun === 'function') {
            window.auto_fun();
        }
    }

    function navigateTo(page) {
        page = Math.max(1, Math.min(maxPages, parseInt(page, 10) || 1));
        current.page = page;
        current.retryPage = 0;
        nextButton.disabled = false;
        loadCurrent(false);
    }

    function submitParsed(parsed) {
        var changedArtwork = current.id !== parsed.id;
        current.id = parsed.id;
        current.page = parsed.page;
        current.userId = parsed.userId || '';
        current.retryPage = 0;
        if (changedArtwork) {
            abortCurrentRequest();
            revokeCacheObjectUrls(current.cache);
            current.cache = {};
            current.blob = null;
            current.loadedPage = 0;
            current.objectUrl = '';
            if (imageWrap) {
                imageWrap.hidden = true;
            }
            if (toolbar) {
                toolbar.hidden = true;
            }
        }
        root.setAttribute('data-id', current.id);
        root.setAttribute('data-page', String(current.page));
        input.value = current.id;
        if (root.getAttribute('data-filter-effective') === '1' || config.filterEffective) {
            window.location.href = routeUrl(current.id, current.page, current.userId);
            return;
        }
        loadCurrent(true);
    }

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        var parsed = parseId(input.value);
        if (parsed.error) {
            setFormError(parseError(parsed.error));
            input.focus();
            return;
        }
        setFormError('');
        submitParsed(parsed);
    });

    prevButton.addEventListener('click', function () {
        if (current.page > 1) {
            navigateTo(current.page - 1);
        }
    });
    nextButton.addEventListener('click', function () {
        if (current.page < maxPages) {
            navigateTo(current.page + 1);
        }
    });
    pageInput.addEventListener('change', function () {
        navigateTo(pageInput.value);
    });
    downloadButton.addEventListener('click', function () {
        if (!current.blob || !current.objectUrl) {
            return;
        }
        try {
            var anchor = document.createElement('a');
            anchor.href = current.objectUrl;
            anchor.download = current.filename || (current.id + '_p' + (current.page - 1) + '.jpg');
            anchor.rel = 'noopener';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        } catch (error) {
            setStatus(strings.downloadFallback, false);
            window.open(current.url, '_blank', 'noopener');
        }
    });
    copyButton.addEventListener('click', function () {
        if (!current.url) {
            return;
        }
        var done = function () {
            var original = copyButton.textContent;
            copyButton.textContent = strings.copied;
            window.setTimeout(function () {
                copyButton.textContent = original || strings.copy;
            }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(current.url).then(done).catch(function () {
                setStatus(current.url, false);
            });
        } else {
            setStatus(current.url, false);
        }
    });

    window.addEventListener('beforeunload', function () {
        abortCurrentRequest();
        revokeCacheObjectUrls(current.cache);
        current.objectUrl = '';
    });

    if (current.id && root.getAttribute('data-blocked') !== '1') {
        loadCurrent(false);
    }
})();
