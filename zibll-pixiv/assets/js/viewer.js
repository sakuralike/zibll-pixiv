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
        cancelImage: null,
        pages: null,
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
        complete: '已加载 {count} 张，共 {total} 张。',
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
        if (['pixiv.net', 'www.pixiv.net', 'pixiv.re', 'pixiv.nl', 'i.pixiv.re', 'i.pixiv.nl'].indexOf(host) === -1) {
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
        } else if (host === 'i.pixiv.re' || host === 'i.pixiv.nl') {
            var original = url.pathname.match(/\/([1-9]\d{0,11})_p(\d+)\.[a-z0-9]+\/?$/i);
            if (original) {
                id = original[1];
                page = parseInt(original[2], 10) + 1;
            }
        } else if (host.indexOf('pixiv.net') !== -1 && url.searchParams.get('illust_id')) {
            id = url.searchParams.get('illust_id');
        }
        if (!id && (
            ['pixiv.re', 'pixiv.nl', 'i.pixiv.re', 'i.pixiv.nl'].indexOf(host) !== -1
            || host.indexOf('pixiv.net') !== -1
        )) {
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

    function galleryMessage(message, page, total) {
        return message.replace(/\{count\}/g, String(current.images.length))
            .replace(/\{page\}/g, String(page))
            .replace(/\{total\}/g, String(total || 0))
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

    function abortCurrentRequest() {
        if (current.controller) {
            current.controller.abort();
            current.controller = null;
        }
        if (current.cancelImage) {
            current.cancelImage();
            current.cancelImage = null;
        }
    }

    function releaseImages() {
        current.images.forEach(function (entry) {
            entry.card.remove();
        });
        current.images = [];
    }

    async function resolveArtwork(id, requestId) {
        var controller = new AbortController();
        current.controller = controller;
        var timer = window.setTimeout(function () {
            controller.abort();
        }, Number(config.timeout || 15000));
        try {
            var response = await fetch(config.resolverUrl + encodeURIComponent(id), {
                method: 'GET',
                credentials: 'same-origin',
                signal: controller.signal,
                cache: 'no-store'
            });
            if (requestId !== current.requestId) {
                throw { type: 'aborted' };
            }
            if (!response.ok) {
                if (response.status === 404) {
                    throw { type: 'notFound' };
                }
                if (response.status === 429) {
                    throw { type: 'busy' };
                }
                if (response.status >= 500) {
                    throw { type: 'server' };
                }
                throw { type: 'failed' };
            }
            var data = await response.json();
            if (!Array.isArray(data.pages) || !data.pages.length) {
                throw { type: 'notImage' };
            }
            if (current.nextPage > Number(data.total || data.pages.length)) {
                throw { type: 'invalidPage' };
            }
            return data;
        } catch (error) {
            if (requestId !== current.requestId) {
                throw { type: 'aborted' };
            }
            if (error && error.type) {
                throw error;
            }
            throw { type: controller.signal.aborted ? 'network' : 'server' };
        } finally {
            window.clearTimeout(timer);
            if (current.controller === controller) {
                current.controller = null;
            }
        }
    }

    async function loadGallery() {
        if (!current.id || current.loading || (current.pages && current.nextPage > current.pages.pages.length)) {
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
            if (!current.pages) {
                setStatus(galleryMessage(strings.loadingGallery, current.nextPage), false);
                current.pages = await resolveArtwork(id, requestId);
            }
            var pageLimit = Math.min(current.pages.pages.length, maxPages);
            while (current.nextPage <= pageLimit) {
                var page = current.nextPage;
                setStatus(galleryMessage(strings.loadingGallery, page), false);
                try {
                    await appendImage(current.pages.pages[page - 1], id, page, requestId);
                    if (requestId !== current.requestId) {
                        return;
                    }
                    current.nextPage += 1;
                } catch (error) {
                    if (requestId !== current.requestId) {
                        return;
                    }
                    var message = galleryMessage(strings.paused, page);
                    message += ' ' + (error && strings[error.type] ? strings[error.type] : strings.failed);
                    setStatus(message, true);
                    return;
                }
            }
            if (current.pages.has_more || current.pages.total > maxPages) {
                setStatus(galleryMessage(strings.limit, maxPages), false);
            } else {
                setStatus(galleryMessage(strings.complete, pageLimit, current.pages.total), false);
            }
        } catch (error) {
            if (requestId !== current.requestId) {
                return;
            }
            setStatus(strings[error && error.type] || strings.failed, true);
        } finally {
            if (requestId === current.requestId) {
                setLoading(false);
            }
        }
    }

    function appendImage(data, id, page, requestId) {
        return new Promise(function (resolve, reject) {
            var card = cardTemplate.content.firstElementChild.cloneNode(true);
            var image = card.querySelector('[data-zibll-pixiv-image]');
            var lightbox = card.querySelector('[data-zibll-pixiv-lightbox]');
            var copyButton = card.querySelector('[data-zibll-pixiv-copy]');
            var urls = Array.isArray(data.urls) ? data.urls : [];
            var urlIndex = 0;
            var settled = false;
            var imageTimer = null;
            var entry = { card: card, url: '' };

            function finish(error) {
                if (settled) {
                    return;
                }
                settled = true;
                window.clearTimeout(imageTimer);
                image.onload = null;
                image.onerror = null;
                if (current.cancelImage === cancel) {
                    current.cancelImage = null;
                }
                if (error) {
                    card.remove();
                    reject(error);
                    return;
                }
                entry.url = urls[urlIndex];
                current.images.push(entry);
                if (typeof window.auto_fun === 'function') {
                    window.auto_fun();
                }
                resolve();
            }

            function cancel() {
                finish({ type: 'aborted' });
            }

            function tryNextUrl() {
                if (requestId !== current.requestId) {
                    finish({ type: 'aborted' });
                    return;
                }
                if (urlIndex >= urls.length) {
                    finish({ type: 'network' });
                    return;
                }
                entry.url = urls[urlIndex];
                lightbox.href = entry.url;
                image.src = entry.url;
                imageTimer = window.setTimeout(function () {
                    urlIndex += 1;
                    tryNextUrl();
                }, Number(config.timeout || 15000));
            }

            card.setAttribute('data-page', String(page));
            card.querySelector('[data-zibll-pixiv-card-page]').textContent = galleryMessage(strings.imagePage, page);
            image.alt = 'Pixiv artwork ' + id + ' page ' + page;
            image.loading = 'eager';
            image.onload = function () {
                if (requestId !== current.requestId) {
                    finish({ type: 'aborted' });
                    return;
                }
                finish();
            };
            image.onerror = function () {
                window.clearTimeout(imageTimer);
                urlIndex += 1;
                tryNextUrl();
            };
            lightbox.addEventListener('click', function (event) {
                if (typeof window.Miniimgbox === 'function' && window._win && window._win.imgbox) {
                    event.preventDefault();
                    if (event.target === lightbox) {
                        image.click();
                    }
                }
            });
            card.querySelector('[data-zibll-pixiv-download]').addEventListener('click', function () {
                window.open(entry.url, '_blank', 'noopener');
            });
            copyButton.addEventListener('click', function () {
                var failed = function () {
                    card.querySelector('[data-zibll-pixiv-card-status]').textContent = entry.url;
                    card.querySelector('[data-zibll-pixiv-card-status]').hidden = false;
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(entry.url).then(function () {
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
            current.cancelImage = cancel;
            tryNextUrl();
        });
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
        current.pages = null;
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
