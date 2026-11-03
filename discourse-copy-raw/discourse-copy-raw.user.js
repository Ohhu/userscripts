// ==UserScript==
// @name         Markdown 原文复制
// @namespace    discourse-copy-raw
// @version      4.1.0
// @description  Discourse 帖子复制 Markdown 原文，图片替换为直链，可发布到 Memos
// @match        https://linux.do/*
// @author       Ohhu
// @license      GPL-3.0
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @downloadURL  https://update.greasyfork.org/scripts/565562/Markdown%20%E5%8E%9F%E6%96%87%E5%A4%8D%E5%88%B6.user.js
// @updateURL    https://update.greasyfork.org/scripts/565562/Markdown%20%E5%8E%9F%E6%96%87%E5%A4%8D%E5%88%B6.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = '4.1.0';
    const PENDING_KEY = 'MDRC_PENDING_COPY';
    let timer = null;

    const CSS = [
        '.mcfg-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.18);opacity:0;transition:opacity .22s ease}',
        '.mcfg-overlay.show{opacity:1}',
        '.mcfg-modal{position:fixed;z-index:10001;top:50%;left:50%;width:340px;padding:28px 24px 20px;border-radius:14px;background:rgba(255,255,255,.72);backdrop-filter:blur(60px) saturate(190%);-webkit-backdrop-filter:blur(60px) saturate(190%);box-shadow:0 0 0 .5px rgba(0,0,0,.06),0 4px 24px rgba(0,0,0,.1),0 12px 48px rgba(0,0,0,.06);color:#1d1d1f;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;transform:translate(-50%,-50%) scale(.6);opacity:0;transition:transform .5s cubic-bezier(.2,.9,.25,1),opacity .28s ease}',
        '.mcfg-overlay.show .mcfg-modal{transform:translate(-50%,-50%) scale(1);opacity:1}',
        '.mcfg-title{margin:0 0 22px;font-size:17px;font-weight:600;text-align:center;letter-spacing:-.01em}',
        '.mcfg-field+.mcfg-field{margin-top:14px}',
        '.mcfg-label{display:block;margin-bottom:5px;font-size:13px;font-weight:500;opacity:.5}',
        '.mcfg-input{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid rgba(0,0,0,.08);border-radius:9px;background:rgba(0,0,0,.03);font-size:14px;font-family:inherit;color:inherit;outline:none;transition:border-color .2s,box-shadow .2s}',
        '.mcfg-input:focus{border-color:#007aff;box-shadow:0 0 0 3.5px rgba(0,122,255,.12)}',
        '.mcfg-input::placeholder{color:rgba(0,0,0,.25)}',
        '.mcfg-hint{margin-top:6px;font-size:12px;line-height:1.4;opacity:.42}',
        '.mcfg-actions{display:flex;gap:10px;margin-top:24px;justify-content:flex-end}',
        '.mcfg-actions button{padding:8px 22px;border-radius:9px;border:none;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;transition:filter .15s}',
        '.mcfg-actions button:active{filter:brightness(.88)}',
        '.mcfg-toggle{display:flex;align-items:center;gap:10px;margin-top:14px}',
        '.mcfg-toggle input[type="checkbox"]{width:16px;height:16px;accent-color:#007aff;cursor:pointer;margin:0}',
        '.mcfg-toggle label{font-size:13px;font-weight:500;opacity:.5;cursor:pointer}',
        '.mcfg-cancel{background:rgba(0,0,0,.05);color:inherit}',
        '.mcfg-confirm{background:#007aff;color:#fff}',
        '.mcfg-toast{position:fixed;z-index:10002;left:50%;bottom:28px;max-width:min(460px,calc(100vw - 32px));box-sizing:border-box;padding:11px 14px;border-radius:11px;background:rgba(30,30,32,.86);backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%);box-shadow:0 8px 30px rgba(0,0,0,.18);color:#fff;font:500 13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:anywhere;transform:translate(-50%,16px);opacity:0;transition:transform .22s ease,opacity .22s ease}',
        '.mcfg-toast.show{transform:translate(-50%,0);opacity:1}',
        '.mcfg-toast.error{background:rgba(190,32,38,.9)}',
        '.mcfg-toast.with-action{display:flex;align-items:center;gap:12px}',
        '.mcfg-toast-btn{flex:none;padding:6px 13px;border-radius:8px;border:none;background:#fff;color:#1d1d1f;font:600 12px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer;white-space:nowrap}',
        '.mcfg-toast.error .mcfg-toast-btn{color:#be2026}',
        '@media(prefers-color-scheme:dark){',
        '.mcfg-modal{background:rgba(44,44,46,.72);color:#f5f5f7;box-shadow:0 0 0 .5px rgba(255,255,255,.06),0 4px 24px rgba(0,0,0,.3),0 12px 48px rgba(0,0,0,.18)}',
        '.mcfg-input{border-color:rgba(255,255,255,.1);background:rgba(255,255,255,.06)}',
        '.mcfg-input:focus{border-color:#0a84ff;box-shadow:0 0 0 3.5px rgba(10,132,255,.18)}',
        '.mcfg-input::placeholder{color:rgba(255,255,255,.25)}',
        '.mcfg-cancel{background:rgba(255,255,255,.08)}',
        '.mcfg-confirm{background:#0a84ff}',
        '}',
    ].join('\n');

    function injectStyles() {
        if (document.getElementById('memos-cfg-styles')) return;
        const s = document.createElement('style');
        s.id = 'memos-cfg-styles';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function showToast(message, type = 'info', action = null, duration = 4200) {
        injectStyles();
        const oldToast = document.querySelector('.mcfg-toast');
        if (oldToast) oldToast.remove();
        const toast = document.createElement('div');
        toast.className = 'mcfg-toast ' + type + (action ? ' with-action' : '');
        const text = document.createElement('span');
        text.textContent = message;
        toast.appendChild(text);
        if (action) {
            const act = document.createElement('button');
            act.className = 'mcfg-toast-btn';
            act.type = 'button';
            act.textContent = action.label;
            act.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toast.remove();
                try { action.onClick(); } catch (err) { console.error('[CopyRaw] action', err); }
            });
            toast.appendChild(act);
        }
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 240);
        }, duration);
    }

    /* ---------------- 网络层：抗 403 / Cloudflare 盾 ---------------- */

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    class ShieldBlocked extends Error {
        constructor(detail) {
            super('被 Cloudflare 盾拦截' + (detail ? '（' + detail + '）' : ''));
            this.name = 'ShieldBlocked';
            this.detail = detail;
        }
    }

    function httpDetail(body) {
        const t = String(body || '').replace(/\s+/g, ' ').trim();
        if (!t) return '';
        if (/^\s*<(!doctype|html)/i.test(t)) return '';
        try {
            const j = JSON.parse(t);
            return j.errors && j.errors[0] ? '：' + String(j.errors[0]).slice(0, 80) : '';
        } catch {
            return '：' + t.slice(0, 80);
        }
    }

    async function request(url, options) {
        const opts = options || {};
        const tries = opts.tries || 3;
        const timeout = opts.timeout || 12000;
        const wantJson = opts.json !== false;
        let lastError = null;

        for (let attempt = 1; attempt <= tries; attempt++) {
            const controller = new AbortController();
            const timerId = setTimeout(() => controller.abort(), timeout);
            let res;
            try {
                res = await fetch(url, {
                    credentials: 'same-origin',
                    cache: 'no-store',
                    redirect: 'follow',
                    signal: controller.signal,
                    headers: {
                        Accept: wantJson ? 'application/json, text/javascript, */*; q=0.01' : 'text/plain, */*; q=0.01',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                });
            } catch (err) {
                clearTimeout(timerId);
                lastError = new Error(controller.signal.aborted
                    ? '请求超时（' + Math.round(timeout / 1000) + 's）'
                    : '网络请求失败');
                if (attempt < tries) { await sleep(350 * attempt); continue; }
                throw lastError;
            }
            clearTimeout(timerId);

            let body = '';
            try { body = await res.text(); } catch { body = ''; }

            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            const mitigated = res.headers.get('cf-mitigated');
            const looksHtml = /^\s*</.test(body) || contentType.indexOf('text/html') !== -1;
            const challenged = mitigated === 'challenge'
                || ((res.status === 403 || res.status === 503) && looksHtml);

            if (challenged) {
                lastError = new ShieldBlocked('HTTP ' + res.status + (mitigated ? ' / cf-mitigated: ' + mitigated : ''));
                if (attempt < tries) { await sleep(600 * attempt + Math.floor(Math.random() * 250)); continue; }
                throw lastError;
            }

            if (res.status === 429) {
                const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
                lastError = new Error('请求过于频繁（HTTP 429）');
                if (attempt < tries) { await sleep(Math.min(4000, (retryAfter || attempt) * 1000)); continue; }
                throw lastError;
            }

            if (!res.ok) throw new Error('HTTP ' + res.status + httpDetail(body));

            if (wantJson && looksHtml) {
                lastError = new ShieldBlocked('接口返回了 HTML 页面');
                if (attempt < tries) { await sleep(600 * attempt); continue; }
                throw lastError;
            }

            return body;
        }
        throw lastError || new Error('请求失败');
    }

    function getTopicId() {
        const m = /^\/t\/(?:[^/]+\/)?(\d+)/.exec(location.pathname);
        if (m) return m[1];
        const el = document.querySelector('#topic[data-topic-id], [data-topic-id]');
        return el ? el.getAttribute('data-topic-id') : null;
    }

    function getPostNumber(article) {
        const m = /^post_(\d+)$/.exec(article.id || '');
        if (m) return m[1];
        const holder = article.closest('[data-post-number]');
        return holder ? holder.getAttribute('data-post-number') : null;
    }

    async function fetchPostData(postId, article) {
        const errors = [];
        let shieldHit = null;

        try {
            const text = await request('/posts/' + postId + '.json');
            const data = JSON.parse(text);
            if (!data || typeof data.raw !== 'string' || !data.raw.length) {
                throw new Error('没取到原文，帖子可能已删除或无权访问');
            }
            return {
                raw: data.raw,
                topic_slug: data.topic_slug || null,
                topic_id: data.topic_id || getTopicId(),
                post_number: data.post_number || null,
            };
        } catch (err) {
            errors.push(err);
            if (err instanceof ShieldBlocked) shieldHit = err;
            console.warn('[CopyRaw] /posts/' + postId + '.json 失败：', err);
        }

        const topicId = getTopicId();
        const postNumber = getPostNumber(article);
        if (topicId && postNumber) {
            try {
                const text = await request('/raw/' + topicId + '/' + postNumber, { json: false });
                if (text && text.trim()) {
                    return { raw: text, topic_slug: null, topic_id: topicId, post_number: postNumber, fallback: true };
                }
                throw new Error('/raw/ 返回空内容');
            } catch (err) {
                errors.push(err);
                if (err instanceof ShieldBlocked) shieldHit = err;
                console.warn('[CopyRaw] /raw/' + topicId + '/' + postNumber + ' 失败：', err);
            }
        }

        throw shieldHit || errors[0] || new Error('无法获取原文');
    }

    function buildPostUrl(data) {
        if (data.topic_id && data.post_number) {
            return location.origin + '/t/' + (data.topic_slug || 'topic') + '/' + data.topic_id + '/' + data.post_number;
        }
        return location.href.split('#')[0];
    }

    /* ---------------- 剪贴板 ---------------- */

    async function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch (err) {
                console.warn('[CopyRaw] clipboard API 失败，尝试 execCommand 兜底', err);
            }
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-2000px;left:-2000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
        if (!ok) throw new Error('无法写入剪贴板，请点击页面后重试');
    }

    function offerShieldPass(postId, retryCopy) {
        const text = retryCopy
            ? '被 Cloudflare 盾拦截（403），过一次盾后自动重试'
            : '被 Cloudflare 盾拦截（403），过一次盾后再发布';
        showToast(text, 'error', {
            label: '过一次盾',
            onClick: () => {
                if (retryCopy) {
                    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ postId: String(postId), ts: Date.now() })); } catch {}
                }
                location.reload();
            },
        }, 12000);
    }

    function reportError(err, action, toastAction) {
        console.error('[CopyRaw] ' + action + ' 失败：', err);
        if (err instanceof ShieldBlocked) return;
        showToast(action + '失败：' + (err && err.message ? err.message : '未知错误'), 'error', toastAction || null, 8000);
    }

    /* ---------------- Memos 对接 ---------------- */

    // 26.10 起 REST 路由不再带 v1（/api/memos）。CreateMemo 的请求体就是 Memo 消息本身，
    // 创建时 state 被忽略（新建恒为 NORMAL），因此只提交 content 与 visibility。
    const MEMO_PATH = '/api/memos';
    const CURRENT_USER_PATH = '/api/auth/me';
    const TOKEN_INVALID_MSG = '令牌无效或已过期，请在「设置 → 访问令牌」重新创建';

    // 统一的 Memos 失败类型：message 已是可直接展示的文案。
    // auth 表示令牌问题，config 表示该去改配置，两者都提供「修改配置」入口。
    class MemosError extends Error {
        constructor(message, options) {
            super(message);
            const opts = options || {};
            this.name = 'MemosError';
            this.auth = !!opts.auth;
            this.config = !!opts.config || this.auth;
        }
    }

    function normalizeHost(value) {
        const raw = String(value || '').trim().replace(/\/+$/, '');
        if (!raw) return '';
        return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    }

    function memosRequest(config, path, options) {
        const opts = options || {};
        const headers = {
            'Authorization': 'Bearer ' + config.token,
            'Accept': 'application/json',
        };
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: opts.method || 'GET',
                url: config.host + path,
                timeout: opts.timeout || 15000,
                headers,
                data: opts.body === undefined ? undefined : JSON.stringify(opts.body),
                onload(res) { resolve(res); },
                ontimeout() { reject(new Error('连接 Memos 超时，请检查实例地址或网络')); },
                onabort() { reject(new Error('Memos 请求已取消')); },
                onerror() { reject(new Error('无法连接 Memos，请检查实例地址、HTTPS 或网络')); },
            });
        });
    }

    function pathMissing(res) {
        return res.status === 404 || res.status === 405 || res.status === 410;
    }

    function parseJsonObject(text) {
        try {
            const data = JSON.parse(text);
            return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
        } catch {
            return null;
        }
    }

    function memoUidFrom(name) {
        const raw = String(name || '');
        return raw.indexOf('memos/') === 0 ? raw.slice('memos/'.length) : '';
    }

    function formatBytes(value) {
        const size = Number(value);
        if (!Number.isFinite(size) || size <= 0) return '';
        const round = (n) => n.toFixed(1).replace(/\.0$/, '');
        if (size < 1024) return size + ' 字节';
        if (size < 1024 * 1024) return round(size / 1024) + ' KB';
        if (size < 1024 * 1024 * 1024) return round(size / (1024 * 1024)) + ' MB';
        return round(size / (1024 * 1024 * 1024)) + ' GB';
    }

    function memosErrorInfo(text) {
        const info = { message: '', reason: '', metric: '', limit: '', retryAfter: 0 };
        const raw = String(text || '').trim();
        if (!raw) return info;
        let data = null;
        try { data = JSON.parse(raw); } catch { data = null; }
        if (!data || typeof data !== 'object') {
            info.message = raw;
        } else {
            info.message = String(data.message || data.error || '');
            const details = Array.isArray(data.details) ? data.details : [];
            details.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                if (!info.reason && item.reason) info.reason = String(item.reason);
                const meta = item.metadata;
                if (meta && typeof meta === 'object') {
                    info.metric = info.metric || String(meta.metric || '');
                    info.limit = info.limit || String(meta.limit || '');
                    if (!info.retryAfter && meta.retry_after_seconds) {
                        info.retryAfter = parseInt(meta.retry_after_seconds, 10) || 0;
                    }
                }
                if (!info.retryAfter && item.retryDelay) {
                    info.retryAfter = parseInt(item.retryDelay, 10) || 0;
                }
            });
        }
        info.message = info.message.replace(/\s+/g, ' ').trim();
        // 反向代理的错误页是 HTML，塞进提示里只会变成噪音。
        if (info.message.charAt(0) === '<') info.message = '';
        info.message = info.message.slice(0, 120);
        return info;
    }

    // Memos 的失败响应是 gRPC 错误映射：{ code, message, details:[ErrorInfo] }；
    // 限流与用量上限都落在 429 上，需要按 details 里的 reason 与 metric 区分。
    function memosErrorMessage(status, text) {
        const info = memosErrorInfo(text);
        const hideRaw = /^API v1 has been removed/i.test(info.message);
        // 已识别的 reason 已经说清问题，不再追加服务端原文。
        const suffix = info.message && !hideRaw && !info.reason ? '：' + info.message : '';
        if (status === 400) {
            if (info.reason === 'CHALLENGE_REQUIRED') return '该实例启用了人机校验，脚本无法直接发布';
            return '请求被 Memos 拒绝' + suffix;
        }
        if (status === 401) return TOKEN_INVALID_MSG;
        if (status === 403) return 'Memos 拒绝访问（令牌权限不足）' + suffix;
        if (status === 429) {
            if (info.reason === 'QUOTA_EXCEEDED') {
                const bytes = info.limit ? '（' + formatBytes(info.limit) + '）' : '';
                if (info.metric === 'MEMO_CONTENT_BYTES') return '内容超出实例的单条上限' + bytes + '，请精简后再发布';
                if (info.metric === 'MEMO_COUNT') return '备忘条数已达实例上限' + (info.limit ? '（' + info.limit + ' 条）' : '');
                if (info.metric === 'STORAGE_BYTES') return '实例存储空间已用满' + bytes;
                return '已触及实例用量限制' + (info.limit ? '（上限 ' + formatBytes(info.limit) + '）' : '');
            }
            return 'Memos 限流' + (info.retryAfter ? '，约 ' + info.retryAfter + ' 秒后可重试' : '，请稍后再试');
        }
        if (status === 404 || status === 405 || status === 410) {
            return '未找到 Memos 接口（' + MEMO_PATH + '）。请确认地址指向 Memos 26.10 或更高版本';
        }
        if (status === 413) return '内容过长，Memos 拒绝接收' + suffix;
        if (status >= 500) return 'Memos 服务端异常（HTTP ' + status + '）' + suffix;
        return '发布到 Memos 失败（HTTP ' + status + '）' + suffix;
    }

    // 返回 { uid, url }；用户在配置弹窗里取消时返回 null。
    async function publishToMemos(content) {
        const config = await getMemosConfig();
        if (!config) return null;
        const res = await memosRequest(config, MEMO_PATH, { method: 'POST', body: { content, visibility: 'PRIVATE' } });
        if (res.status >= 200 && res.status < 300) {
            const memo = parseJsonObject(res.responseText);
            const uid = memo ? memoUidFrom(memo.name) : '';
            if (uid) return { uid, url: config.host + '/memos/' + uid };
            if (memo) throw new MemosError('没有拿到备忘信息，请到实例确认是否已创建', { config: true });
            throw new MemosError('该地址没有返回 Memos 数据，请检查地址与子路径', { config: true });
        }
        const auth = res.status === 401;
        throw new MemosError(memosErrorMessage(res.status, res.responseText), {
            auth,
            config: auth || pathMissing(res),
        });
    }

    async function verifyMemosConfig(config) {
        const res = await memosRequest(config, CURRENT_USER_PATH, {});
        if (res.status >= 200 && res.status < 300) {
            const data = parseJsonObject(res.responseText);
            if (!data || !data.user) throw new MemosError('该地址没有返回 Memos 数据，请检查地址与子路径', { config: true });
            return { username: String(data.user.username || '') };
        }
        if (res.status === 401) throw new MemosError(TOKEN_INVALID_MSG, { auth: true });
        if (pathMissing(res)) throw new MemosError('未找到 Memos 接口（' + CURRENT_USER_PATH + '），请确认实例版本', { config: true });
        throw new MemosError('实例响应异常（HTTP ' + res.status + '）');
    }

    /* ---------------- Memos 配置界面 ---------------- */

    async function getMemosConfig() {
        const host = normalizeHost(GM_getValue('MEMOS_HOST', ''));
        const token = String(GM_getValue('MEMOS_TOKEN', '')).trim();
        if (host && token) return { host, token };
        return editMemosConfig();
    }

    let _configPromise = null;

    function editMemosConfig() {
        if (_configPromise) return _configPromise;
        injectStyles();
        _configPromise = new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'mcfg-overlay';
            const modal = document.createElement('div');
            modal.className = 'mcfg-modal';
            modal.innerHTML = '<div class="mcfg-title">Memos 配置</div>' +
'<div class="mcfg-field"><label class="mcfg-label">实例地址</label><input class="mcfg-input" data-key="host" type="url" placeholder="https://memos.example.com"></div>' +
'<div class="mcfg-field"><label class="mcfg-label">访问令牌</label><input class="mcfg-input" data-key="token" type="password" placeholder="以 memos_pat_ 开头"><div class="mcfg-hint">在实例「设置 → 访问令牌」创建；登录令牌约 15 分钟过期。</div></div>' +
'<div class="mcfg-toggle"><input type="checkbox" data-key="source" id="mcfg-source"><label for="mcfg-source">保存来源链接</label></div>' +
'<div class="mcfg-toggle"><input type="checkbox" data-key="imgLink" id="mcfg-imgLink"><label for="mcfg-imgLink">图片转为链接</label></div>' +
'<div class="mcfg-actions"><button class="mcfg-cancel" type="button">取消</button><button class="mcfg-confirm" type="button">确认</button></div>';
            const hostInput = modal.querySelector('[data-key="host"]');
            const tokenInput = modal.querySelector('[data-key="token"]');
            const sourceInput = modal.querySelector('[data-key="source"]');
            const imgLinkInput = modal.querySelector('[data-key="imgLink"]');
            hostInput.value = GM_getValue('MEMOS_HOST', '');
            tokenInput.value = GM_getValue('MEMOS_TOKEN', '');
            sourceInput.checked = GM_getValue('MEMOS_SOURCE', true);
            imgLinkInput.checked = GM_getValue('MEMOS_IMG_LINK', false);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));
            hostInput.focus();

            function close(result) {
                overlay.classList.remove('show');
                setTimeout(() => overlay.remove(), 500);
                _configPromise = null;
                resolve(result);
            }
            modal.querySelector('.mcfg-cancel').addEventListener('click', () => close(null));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
            modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
            modal.querySelector('.mcfg-confirm').addEventListener('click', async () => {
                const host = normalizeHost(hostInput.value);
                const token = tokenInput.value.trim();
                GM_setValue('MEMOS_HOST', host);
                GM_setValue('MEMOS_TOKEN', token);
                GM_setValue('MEMOS_SOURCE', sourceInput.checked);
                GM_setValue('MEMOS_IMG_LINK', imgLinkInput.checked);
                close(host && token ? { host, token } : null);
                if (!host || !token) return;
                try {
                    const account = await verifyMemosConfig({ host, token });
                    showToast(account.username ? '已连接：' + account.username : '已保存', 'info', null, 3200);
                } catch (err) {
                    console.error('[CopyRaw] 连接 Memos 失败：', err);
                    const message = err && err.message ? err.message : '连接 Memos 失败';
                    const action = err instanceof MemosError && err.config ? { label: '修改配置', onClick: () => editMemosConfig() } : null;
                    showToast(message, 'error', action, 9000);
                }
            });
        });
        return _configPromise;
    }

    function isPublished(postId) {
        return GM_getValue('PUBLISHED_POSTS', []).includes(String(postId));
    }

    function markPublished(postId) {
        const list = GM_getValue('PUBLISHED_POSTS', []);
        if (!list.includes(String(postId))) list.push(String(postId));
        GM_setValue('PUBLISHED_POSTS', list);
    }

    function cleanupPublished() {
        const today = new Date().toDateString();
        if (GM_getValue('PUBLISHED_POSTS_DATE', '') !== today) {
            GM_setValue('PUBLISHED_POSTS', []);
            GM_setValue('PUBLISHED_POSTS_DATE', today);
        }
    }

    /* ---------------- Markdown 处理 ---------------- */

    function icon(name) {
        return '<svg class="fa d-icon d-icon-' + name + ' svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><use href="#' + name + '"></use></svg>';
    }

    function btnHTML(name) {
        return icon(name) + '  <span aria-hidden="true">\u200B</span>';
    }

    function buildUploadMap(article) {
        const map = {};
        const cooked = article.querySelector('.cooked');
        if (!cooked) return map;
        cooked.querySelectorAll('[data-base62-sha1]').forEach((el) => {
            const hash = el.dataset.base62Sha1;
            if (!hash) return;
            const lightbox = el.closest('a.lightbox');
            if (lightbox) {
                map[hash] = lightbox.href;
            } else if (el.tagName === 'IMG') {
                map[hash] = el.src;
            } else {
                const img = el.querySelector('img');
                if (img) map[hash] = img.src;
            }
        });
        cooked.querySelectorAll('a.attachment[href]').forEach((el) => {
            const parts = el.getAttribute('href').split('/');
            const hash = parts[parts.length - 1].replace(/\.\w+$/, '');
            if (hash) map[hash] = el.href;
        });
        return map;
    }

    function replaceUploads(raw, uploadMap) {
        return raw.replace(/upload:\/\/([\w]+)(?:\.\w+)?/g, (_, hash) => {
            return uploadMap[hash] || _;
        });
    }

    // 代码围栏里的内容原样保留，避免把正文里讨论 BBCode 的文字当引用。
    function convertQuotes(text) {
        return String(text)
            .split(/(```[\s\S]*?```)/)
            .map((chunk, index) => (index % 2 === 1 ? chunk : convertQuoteChunk(chunk)))
            .join('');
    }

    // 内容里不含 [quote 的块先转换，嵌套引用因此由内向外逐层处理。
    // 没有作者的 [quote] 只认跨行内容，单行提及标签的文字保持原样。
    function convertQuoteChunk(text) {
        const regex = /\[quote([^\]]*)\]\n?((?:(?!\[quote)[\s\S])*?)\n?\[\/quote\]/;
        const kept = [];
        let result = text;
        while (regex.test(result)) {
            result = result.replace(regex, (whole, attrs, content) => {
                const matched = /^=\s*"?([^",\]]*)/.exec(String(attrs).trim());
                const user = matched ? matched[1].trim() : '';
                if (!user && whole.indexOf('\n') === -1) {
                    kept.push(whole);
                    return '\u0000QUOTE' + (kept.length - 1) + '\u0000';
                }
                const quoted = content
                    .split('\n')
                    .map((line) => '> ' + line)
                    .join('\n');
                return (user ? '> **' + user + '**：\n>\n' : '>\n') + quoted;
            });
        }
        return result.replace(/\u0000QUOTE(\d+)\u0000/g, (_, index) => kept[Number(index)]);
    }

    function convertImages(text) {
        let counter = 0;
        return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, _alt, url) => {
            counter++;
            return '[图片' + counter + '](' + url + ')';
        });
    }

    function processRaw(raw, article) {
        const uploadMap = buildUploadMap(article);
        let result = replaceUploads(String(raw), uploadMap);
        result = convertQuotes(result);
        if (GM_getValue('MEMOS_IMG_LINK', false)) result = convertImages(result);
        return result;
    }

    /* ---------------- 按钮 ---------------- */

    const busy = new WeakSet();

    function flashError(btn) {
        btn.style.color = 'var(--danger)';
        setTimeout(() => (btn.style.color = ''), 1500);
    }

    function flashSuccess(btn, name, restore) {
        btn.innerHTML = btnHTML(name);
        setTimeout(() => (btn.innerHTML = btnHTML(restore)), 1500);
    }

    async function buildContent(article, postId) {
        const data = await fetchPostData(postId, article);
        return { text: processRaw(data.raw, article), data };
    }

    async function copyPost(article, postId) {
        const result = await buildContent(article, postId);
        await copyToClipboard(result.text);
        return result;
    }

    function createBtn(article, postId) {
        const btn = document.createElement('button');
        btn.className = 'btn no-text btn-icon post-action-menu__copy-raw btn-flat';
        btn.title = '复制 Markdown 原文';
        btn.setAttribute('aria-label', btn.title);
        btn.type = 'button';
        btn.innerHTML = btnHTML('copy');

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (busy.has(btn)) return;
            busy.add(btn);
            try {
                await copyPost(article, postId);
                flashSuccess(btn, 'check', 'copy');
            } catch (err) {
                flashError(btn);
                if (err instanceof ShieldBlocked) offerShieldPass(postId, true);
                else reportError(err, '复制');
            } finally {
                busy.delete(btn);
            }
        });

        return btn;
    }

    function createPublishBtn(article, postId) {
        const btn = document.createElement('button');
        btn.className = 'btn no-text btn-icon post-action-menu__publish-memos btn-flat';
        btn.title = '发布到 Memos（按住修改配置）';
        btn.setAttribute('aria-label', btn.title);
        btn.type = 'button';
        btn.innerHTML = btnHTML('paper-plane');

        let pressTimer = null;
        let longPressed = false;

        btn.addEventListener('pointerdown', () => {
            longPressed = false;
            pressTimer = setTimeout(() => {
                longPressed = true;
                editMemosConfig();
            }, 500);
        });
        btn.addEventListener('pointerup', () => clearTimeout(pressTimer));
        btn.addEventListener('pointerleave', () => clearTimeout(pressTimer));

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (longPressed) return;
            if (busy.has(btn)) return;
            if (isPublished(postId) && !confirm('该帖子已发布过，确定要重复发布吗？')) return;
            busy.add(btn);
            try {
                const res = await buildContent(article, postId);
                let content = res.text;
                if (GM_getValue('MEMOS_SOURCE', true)) {
                    content += '\n\n[source](' + buildPostUrl(res.data) + ')';
                }
                const memo = await publishToMemos(content);
                if (!memo) return;
                markPublished(postId);
                flashSuccess(btn, 'check', 'paper-plane');
                const openMemo = memo.url ? { label: '查看', onClick: () => window.open(memo.url, '_blank', 'noopener') } : null;
                showToast('已发布到 Memos', 'info', openMemo, 3600);
            } catch (err) {
                flashError(btn);
                if (err instanceof ShieldBlocked) {
                    offerShieldPass(postId, false);
                } else if (err instanceof MemosError) {
                    console.error('[CopyRaw] 发布到 Memos 失败：', err);
                    const action = err.config ? { label: '修改配置', onClick: () => editMemosConfig() } : null;
                    showToast(err.message, 'error', action, 9000);
                } else {
                    reportError(err, '发布');
                }
            } finally {
                busy.delete(btn);
            }
        });

        return btn;
    }

    function inject() {
        document.querySelectorAll('article[data-post-id]').forEach((article) => {
            const hasCopy = article.querySelector('.post-action-menu__copy-raw');
            const hasPub = article.querySelector('.post-action-menu__publish-memos');
            if (hasCopy && hasPub) return;
            const postId = article.dataset.postId;
            const actions = article.querySelector('.post-controls .actions');
            if (!actions) return;
            const copyBtn = hasCopy || createBtn(article, postId);
            const pubBtn = hasPub || createPublishBtn(article, postId);
            if (!hasCopy) {
                const copyLinkBtn = actions.querySelector('.post-action-menu__copy-link');
                if (copyLinkBtn) copyLinkBtn.after(copyBtn);
                else {
                    const doubleBtn = actions.querySelector('.double-button');
                    if (doubleBtn) doubleBtn.before(copyBtn);
                    else actions.appendChild(copyBtn);
                }
            }
            if (!hasPub) copyBtn.after(pubBtn);
        });
    }

    /* ---------------- 过盾后自动重试 ---------------- */

    function resumePendingCopy() {
        let pending = null;
        try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { pending = null; }
        if (!pending || !pending.postId) return;
        try { sessionStorage.removeItem(PENDING_KEY); } catch {}
        if (!pending.ts || Date.now() - pending.ts > 120000) return;

        const attempt = (tries) => {
            const article = document.querySelector('article[data-post-id="' + pending.postId + '"]');
            if (!article) {
                if (tries > 0) return setTimeout(() => attempt(tries - 1), 500);
                return;
            }
            copyPost(article, pending.postId).then(() => {
                const btn = article.querySelector('.post-action-menu__copy-raw');
                if (btn) flashSuccess(btn, 'check', 'copy');
            }).catch((err) => {
                if (err instanceof ShieldBlocked) {
                    showToast('盾未通过，请刷新页面后重试', 'error', null, 8000);
                } else {
                    showToast('复制未完成：' + (err.message || err), 'error', null, 8000);
                }
            });
        };
        setTimeout(() => attempt(20), 700);
    }

    const ob = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(inject, 200);
    });
    ob.observe(document.body, { childList: true, subtree: true });
    cleanupPublished();
    inject();
    resumePendingCopy();

    console.log('[CopyRaw] v' + SCRIPT_VERSION + ' 已加载');
})();
