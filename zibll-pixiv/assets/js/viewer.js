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
    var gallery = root.querySelector('[data-zibll-pixiv-gallery]');
    var cardTemplate = root.querySelector('[data-zibll-pixiv-card-template]');
    var source = root.querySelector('[data-zibll-pixiv-source]');
    var empty = root.querySelector('[data-zibll-pixiv-empty]');
    var status = root.querySelector('[data-zibll-pixiv-status]');
    var initialPage = parseInt(root.getAttribute('data-page') || '1', 10) || 1;
    var current = {
        id: root.getAttribute('data-id') || '',
        startPage: initialPage,
        nextPage: initialPage,
        userId: '',
        requestId: 0,
        controller: null,
        images: [],
        loading: false
    };
    var maxPages = 50;

    var strings = config.strings || {};
    var fallbackStrings = {
        empty: '请输入 Pixiv 作品 ID 或链接',
        invalid: '无法识别输入，请粘贴 Pixiv 作品链接或纯数字 ID',
        leadingZero: '作品 ID 不能以 0 开头',
        invalidPage: '页码格式不正确',
        loadingGallery: '已加载 {count} 张，正在加载第 {page} 张…',
        paused: '已加载 {count} 张，暂时无法确认第 {page} 张是否存在，可重试。',
        limit: '已加载 {count} 张，已达到第 {limit} 页安全上限，未继续探测。',
        imagePage: '第 {page} 张',
        network: '网络超时，请检查网络后重试',
        badRequest: '作品 ID 格式不正确，请检查后重试',
        notFound: '作品不存在、已被删除或限制访问',
        server: '图片代理服务异常，请稍后重试',
        busy: '服务繁忙，请稍后自动重试',
        notImage: '未获取到图片',
        failed: '暂时无法获取，请稍后再试或切换代理域名',
        download: '下载原图',
        copy: '复制直链',
        copied: '已复制',
        retry: '重试',
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

    function galleryMessage(message, page) {
        return message.replace(/\{count\}/g, String(current.images.length))
            .replace(/\{page\}/g, String(page))
            .replace(/\{limit\}/g, String(maxPages));
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
            button.className = 'zibll-pixiv-inline-retry but c-theme';
            button.textContent = strings.retry;
            button.addEventListener('click', function () {
                loadGallery();
            });
            status.appendChild(button);
        }
    }

    function setLoading(loading) {
        current.loading = loading;
        root.classList.toggle('is-loading', loading);
    }

    function sleep(milliseconds, signal) {
        return new Promise(function (resolve, reject) {
            if (signal.aborted) {
                reject({ type: 'aborted' });
                return;
            }
            var timer = window.setTimeout(function () {
                signal.removeEventListener('abort', cancel);
                resolve();
            }, milliseconds);
            function cancel() {
                window.clearTimeout(timer);
                reject({ type: 'aborted' });
            }
            signal.addEventListener('abort', cancel, { once: true });
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

    function releaseImages() {
        current.images.forEach(function (entry) {
            window.URL.revokeObjectURL(entry.objectUrl);
        });
        current.images = [];
    }

    async function fetchImage(url, id, page, requestId) {
        var attempts = 0;
        while (attempts < 3) {
            attempts += 1;
            if (requestId !== current.requestId) {
                throw { type: 'aborted' };
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
                if (requestId !== current.requestId) {
                    throw { type: 'aborted' };
                }
                if (controller.signal.aborted) {
                    throw { type: 'network' };
                }
                if (response.status === 503 && attempts < 3) {
                    var retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
                    retryAfter = Number.isFinite(retryAfter) ? Math.max(1, Math.min(15, retryAfter)) : 2;
                    window.clearTimeout(timer);
                    if (response.body && response.body.cancel) {
                        await response.body.cancel();
                    }
                    if (requestId !== current.requestId) {
                        throw { type: 'aborted' };
                    }
                    setStatus(galleryMessage(strings.loadingGallery, page) + ' ' + strings.busy + ' ' + retryAfter + 's', false);
                    await sleep(retryAfter * 1000, controller.signal);
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
                var blob = await readBlob(response, page, requestId);
                if (requestId !== current.requestId) {
                    throw { type: 'aborted' };
                }
                if (controller.signal.aborted) {
                    throw { type: 'network' };
                }
                if (!blob || (blob.type && blob.type.indexOf('image/') !== 0)) {
                    throw { type: 'notImage' };
                }
                return {
                    url: url,
                    blob: blob,
                    filename: filenameFromDisposition(response.headers.get('Content-Disposition'), id, page)
                };
            } catch (error) {
                controller.abort();
                if (requestId !== current.requestId) {
                    throw { type: 'aborted' };
                }
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

    async function readBlob(response, page, requestId) {
        if (!response.body || !response.body.getReader) {
            return response.blob();
        }
        var reader = response.body.getReader();
        var contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
        var received = 0;
        var chunks = [];
        while (true) {
            if (requestId !== current.requestId) {
                throw { type: 'aborted' };
            }
            var part = await reader.read();
            if (requestId !== current.requestId) {
                throw { type: 'aborted' };
            }
            if (part.done) {
                break;
            }
            chunks.push(part.value);
            received += part.value.length;
            if (contentLength > 0) {
                setStatus(galleryMessage(strings.loadingGallery, page) + ' ' + Math.round((received / contentLength) * 100) + '%', false);
            }
        }
        return new Blob(chunks, { type: response.headers.get('Content-Type') || 'image/jpeg' });
    }

    async function loadPage(id, page, requestId) {
        var lastError = null;
        var hostList = domains();
        for (var i = 0; i < hostList.length; i += 1) {
            var candidateUrls = [imageUrl(hostList[i], id, page, false)];
            if (page === 1) {
                candidateUrls.push(imageUrl(hostList[i], id, page, true));
            }
            var stopFailover = false;
            for (var candidateIndex = 0; candidateIndex < candidateUrls.length; candidateIndex += 1) {
                var url = candidateUrls[candidateIndex];
                try {
                    return await fetchImage(url, id, page, requestId);
                } catch (error) {
                    if (requestId !== current.requestId || (error && error.type === 'aborted')) {
                        throw { type: 'aborted' };
                    }
                    if (error && (error.type === 'notFound' || error.type === 'badRequest')) {
                        lastError = error;
                        stopFailover = candidateIndex === 0;
                        break;
                    }
                    lastError = error;
                    // Only a network/CORS failure may use the page-one direct variant.
                    if (candidateIndex === 0 && page === 1 && error && error.type === 'network') {
                        continue;
                    }
                    if (!error || (error.type !== 'network' && error.type !== 'server')) {
                        throw error;
                    }
                    break;
                }
            }
            if (stopFailover) {
                break;
            }
        }
        throw lastError || { type: 'failed' };
    }

    async function loadGallery() {
        if (!current.id || current.loading || current.nextPage > maxPages) {
            return;
        }
        var requestId = ++current.requestId;
        var id = current.id;
        setLoading(true);
        setFormError('');
        if (empty) {
            empty.hidden = true;
        }
        try {
            while (current.nextPage <= maxPages) {
                var page = current.nextPage;
                setStatus(galleryMessage(strings.loadingGallery, page), false);
                try {
                    var data = await loadPage(id, page, requestId);
                    if (requestId !== current.requestId) {
                        return;
                    }
                    appendImage(data, id, page);
                    current.nextPage += 1;
                } catch (error) {
                    if (requestId !== current.requestId) {
                        return;
                    }
                    var message = galleryMessage(strings.paused, page);
                    if (!error || error.type !== 'notFound' || page === 1) {
                        message += ' ' + (error && strings[error.type] ? strings[error.type] : strings.failed);
                    }
                    setStatus(message, true);
                    return;
                }
            }
            setStatus(galleryMessage(strings.limit, maxPages), false);
        } finally {
            if (requestId === current.requestId) {
                setLoading(false);
            }
        }
    }

    function appendImage(data, id, page) {
        var card = cardTemplate.content.firstElementChild.cloneNode(true);
        var image = card.querySelector('[data-zibll-pixiv-image]');
        var lightbox = card.querySelector('[data-zibll-pixiv-lightbox]');
        var copyButton = card.querySelector('[data-zibll-pixiv-copy]');
        var cardStatus = card.querySelector('[data-zibll-pixiv-card-status]');
        data.objectUrl = window.URL.createObjectURL(data.blob);
        current.images.push(data);
        card.setAttribute('data-page', String(page));
        card.querySelector('[data-zibll-pixiv-card-page]').textContent = galleryMessage(strings.imagePage, page);
        image.src = data.objectUrl;
        image.alt = 'Pixiv artwork ' + id + ' page ' + page;
        lightbox.href = data.objectUrl;
        lightbox.addEventListener('click', function (event) {
            if (typeof window.Miniimgbox === 'function' && window._win && window._win.imgbox) {
                event.preventDefault();
                if (event.target === lightbox) {
                    image.click();
                }
            }
        });
        card.querySelector('[data-zibll-pixiv-download]').addEventListener('click', function () {
            try {
                var anchor = document.createElement('a');
                anchor.href = data.objectUrl;
                anchor.download = data.filename;
                anchor.rel = 'noopener';
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
            } catch (error) {
                cardStatus.textContent = strings.downloadFallback;
                cardStatus.hidden = false;
                window.open(data.url, '_blank', 'noopener');
            }
        });
        copyButton.addEventListener('click', function () {
            var failed = function () {
                cardStatus.textContent = data.url;
                cardStatus.hidden = false;
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(data.url).then(function () {
                    copyButton.textContent = strings.copied;
                    window.setTimeout(function () {
                        copyButton.textContent = strings.copy;
                    }, 1500);
                }).catch(failed);
            } else {
                failed();
            }
        });
        gallery.appendChild(card);
        gallery.hidden = false;
        if (typeof window.auto_fun === 'function') {
            window.auto_fun();
        }
    }

    function submitParsed(parsed) {
        if (root.getAttribute('data-filter-effective') === '1' || config.filterEffective) {
            current.requestId += 1;
            abortCurrentRequest();
            setLoading(false);
            window.location.href = routeUrl(parsed.id, parsed.page, parsed.userId);
            return;
        }
        if (current.id === parsed.id && current.startPage === parsed.page && current.userId === (parsed.userId || '')) {
            loadGallery();
            return;
        }
        current.requestId += 1;
        abortCurrentRequest();
        releaseImages();
        setLoading(false);
        gallery.textContent = '';
        gallery.hidden = true;
        current.id = parsed.id;
        current.startPage = parsed.page;
        current.nextPage = parsed.page;
        current.userId = parsed.userId || '';
        root.setAttribute('data-id', current.id);
        root.setAttribute('data-page', String(current.startPage));
        input.value = current.id;
        if (source) {
            source.href = 'https://www.pixiv.net/artworks/' + encodeURIComponent(current.id);
            source.parentElement.hidden = false;
        }
        window.history.replaceState({}, '', routeUrl(current.id, current.startPage, current.userId));
        loadGallery();
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

    window.addEventListener('beforeunload', function () {
        current.requestId += 1;
        abortCurrentRequest();
        releaseImages();
    });

    if (current.id && root.getAttribute('data-blocked') !== '1') {
        loadGallery();
    }
})();
