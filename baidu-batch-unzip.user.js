// ==UserScript==
// @name         百度网盘 · 批量解压
// @namespace    https://pan.baidu.com/
// @version      5.0.0
// @description  勾选压缩包后工具栏出现「批量解压」，选择或新建目标文件夹后一次性解压（默认平铺，不建同名文件夹）。
// @author       DSH
// @match        https://pan.baidu.com/disk/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var APP_ID = '250528';
  var ARCHIVE_RE = /\.(zip|rar|7z)$/i;

  var ERRNO = {
    '2': '参数错误',
    '-6': '登录失效，请刷新页面重新登录',
    '-8': '目标目录已有同名项',
    '-9': '包内条目不存在',
    '111': '还有未完成的任务',
    '132': '需要身份验证',
    '31061': '目标目录已存在同名文件',
    '31180': '需要解压密码',
    '31181': '压缩文件内容过多，建议下载后解压',
    '31182': '压缩文件损坏或不完整',
    '31183': '压缩包过大，暂不支持云解压',
    '31184': '暂无法为您解压此类压缩包',
    '31185': '系统繁忙，请稍后再试',
    '31186': '压缩包内文件过多',
    '31188': '暂不支持解压 8G 以上文件',
    '31189': '压缩包已损坏',
    '31193': '固实压缩，暂不支持',
    '31194': '分卷压缩包，暂不支持',
    '31195': '压缩包已损坏',
    '31196': '暂不支持中文密码'
  };
  function errText(c) { return ERRNO[String(c)] || ('未知错误 ' + c); }

  // ---------------------------------------------------------------- 基础
  function currentDir() {
    var hash = location.hash || '';
    var i = hash.indexOf('?');
    var p = new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '').get('path');
    return p || '/';
  }
  function join(dir, name) {
    return (dir === '/' ? '' : dir.replace(/\/+$/, '')) + '/' + name;
  }
  function buildUrl(path, params) {
    var u = new URL(path, location.origin);
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null) u.searchParams.set(k, String(params[k]));
    });
    u.searchParams.set('clienttype', '0');
    u.searchParams.set('app_id', APP_ID);
    u.searchParams.set('web', '1');
    return u.toString();
  }
  function parse(text) {
    try { return JSON.parse(text); } catch (e) { return { errno: -1, errmsg: '非 JSON 响应' }; }
  }
  function apiGet(path, params) {
    return fetch(buildUrl(path, params), {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (r) { return r.text(); }).then(parse);
  }
  function apiPost(path, params, data) {
    var body = new URLSearchParams();
    Object.keys(data || {}).forEach(function (k) { body.set(k, String(data[k])); });
    return fetch(buildUrl(path, params), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString()
    }).then(function (r) { return r.text(); }).then(parse);
  }

  var tokenCache = '';
  function getToken() {
    if (tokenCache) return Promise.resolve(tokenCache);
    return apiGet('/api/gettemplatevariable', { fields: '["bdstoken"]' }).then(function (j) {
      tokenCache = (j && j.result && j.result.bdstoken) || '';
      return tokenCache;
    }).catch(function () { return ''; });
  }

  function listDir(dir) {
    return apiGet('/api/list', { dir: dir, order: 'name', desc: '0', showempty: '0', page: '1', num: '1000' });
  }
  function createFolder(parent, name) {
    return getToken().then(function (token) {
      return apiPost('/api/create', { a: 'commit', bdstoken: token }, {
        path: join(parent, name), isdir: '1', block_list: '[]'
      });
    });
  }
  function listArchive(zipPath, sub) {
    return apiGet('/api/zipfile/list', {
      path: zipPath, subpath: sub || '/', start: 0, limit: 100, passwd: ''
    });
  }
  function startUnzip(zipPath, topath, subpaths) {
    return getToken().then(function (token) {
      if (!token) throw new Error('拿不到 bdstoken');
      return apiGet('/api/zipfile/copy', {
        opera: 'unzip', bdstoken: token, topath: topath,
        path: zipPath, subpath: JSON.stringify(subpaths || []),
        type: 'unzip', passwd: ''
      });
    });
  }
  function taskQuery(taskid) {
    return apiGet('/share/taskquery', { taskid: taskid });
  }

  // ---------------------------------------------------------------- 选中项
  function collectSelected() {
    var dir = currentDir();
    var out = [];
    var rows = document.querySelectorAll('tr.wp-s-pan-table__body-row');
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var cb = tr.querySelector('input[type=checkbox]');
      if (!cb || !cb.checked) continue;
      var el = tr.querySelector('[data-title]');
      var name = el ? el.getAttribute('data-title') : '';
      if (!name) continue;
      if (!ARCHIVE_RE.test(name)) continue;
      out.push({ name: name, path: join(dir, name) });
    }
    // 去重
    var seen = {};
    return out.filter(function (x) {
      if (seen[x.path]) return false;
      seen[x.path] = 1;
      return true;
    });
  }

  // ---------------------------------------------------------------- 样式
  var CSS = [
    '.bdq-btn{display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 14px;margin-right:8px;',
    'border:0;border-radius:16px;background:#3a6df0;color:#fff;font-size:13px;cursor:pointer;',
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.bdq-btn:hover{background:#2f5cd6}',
    '.bdq-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483000;display:flex;',
    'align-items:center;justify-content:center;font:13px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.bdq-dlg{width:640px;max-height:82vh;display:flex;flex-direction:column;background:#fff;border-radius:10px;',
    'box-shadow:0 16px 48px rgba(0,0,0,.3);overflow:hidden;color:#222}',
    '.bdq-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eee;font-weight:600;font-size:15px}',
    '.bdq-x{cursor:pointer;color:#999;font-size:18px;line-height:1}',
    '.bdq-body{padding:12px 16px;overflow:auto}',
    '.bdq-sec{margin-bottom:12px}',
    '.bdq-lab{color:#666;font-size:12px;margin-bottom:6px}',
    '.bdq-files{max-height:92px;overflow:auto;background:#f7f8fa;border-radius:6px;padding:6px 8px;font-size:12px;color:#444}',
    '.bdq-file{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.bdq-path{display:flex;align-items:center;gap:4px;flex-wrap:wrap;background:#f7f8fa;border-radius:6px;padding:6px 8px;font-size:12px}',
    '.bdq-crumb{color:#3a6df0;cursor:pointer}',
    '.bdq-crumb:hover{text-decoration:underline}',
    '.bdq-sep{color:#bbb}',
    '.bdq-folders{height:170px;overflow:auto;border:1px solid #eee;border-radius:6px;margin-top:8px}',
    '.bdq-folder{display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;font-size:13px}',
    '.bdq-folder:hover{background:#f0f5ff}',
    '.bdq-folder .bdq-ico{width:16px;text-align:center}',
    '.bdq-new{display:flex;gap:8px;margin-top:8px}',
    '.bdq-new input{flex:1;height:30px;border:1px solid #ddd;border-radius:6px;padding:0 8px;font-size:13px;outline:none}',
    '.bdq-new input:focus{border-color:#3a6df0}',
    '.bdq-new button{height:30px;padding:0 12px;border:1px solid #3a6df0;border-radius:6px;background:#fff;color:#3a6df0;cursor:pointer;font-size:13px}',
    '.bdq-ft{display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid #eee}',
    '.bdq-ft .bdq-opt{display:flex;align-items:center;gap:4px;color:#555;font-size:12px;cursor:pointer}',
    '.bdq-primary{margin-left:auto;height:32px;padding:0 18px;border:0;border-radius:6px;background:#3a6df0;color:#fff;cursor:pointer;font-size:13px}',
    '.bdq-primary:disabled{background:#c3cfe8;cursor:not-allowed}',
    '.bdq-plain{height:32px;padding:0 14px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px}',
    '.bdq-log{max-height:120px;overflow:auto;border-top:1px solid #eee;padding:8px 16px;font-size:12px;color:#444;',
    'font-family:ui-monospace,Menlo,Consolas,monospace;background:#fafbfc}',
    '.bdq-ok{color:#18a058}.bdq-err{color:#d03050}.bdq-warn{color:#c27c0e}'
  ].join('');

  function injectCss() {
    if (document.getElementById('bdq-style')) return;
    var s = document.createElement('style');
    s.id = 'bdq-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---------------------------------------------------------------- 工具栏按钮
  var toolbarBtn = null;
  var lastCount = -1;

  function findToolbar() {
    var bar = document.querySelector('.wp-s-agile-tool-bar__header.is-header-tool');
    if (bar) return bar;
    var btn = null;
    var all = document.querySelectorAll('button');
    for (var i = 0; i < all.length; i++) {
      if (/云解压|分享|下载/.test(all[i].innerText || '')) { btn = all[i]; break; }
    }
    return btn ? btn.parentElement : null;
  }

  function syncToolbar() {
    injectCss();
    var selected = collectSelected();
    var bar = findToolbar();

    if (!bar || !selected.length) {
      if (toolbarBtn && toolbarBtn.parentNode) toolbarBtn.parentNode.removeChild(toolbarBtn);
      toolbarBtn = null;
      lastCount = -1;
      return;
    }
    if (!toolbarBtn) {
      toolbarBtn = document.createElement('button');
      toolbarBtn.className = 'bdq-btn';
      toolbarBtn.type = 'button';
      toolbarBtn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      toolbarBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openDialog();
      });
    }
    if (selected.length !== lastCount || !toolbarBtn.isConnected) {
      toolbarBtn.textContent = '批量解压(' + selected.length + ')';
      lastCount = selected.length;
    }
    if (!toolbarBtn.isConnected) bar.insertBefore(toolbarBtn, bar.firstChild);
  }

  // ---------------------------------------------------------------- 对话框
  var dlg = null, pickDir = '/', flatMode = true, running = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function openDialog() {
    if (!collectSelected().length) return;
    if (!dlg) dlg = buildDialog();
    pickDir = currentDir();
    renderFiles();
    renderPath();
    loadFolders(pickDir);
    dlg.mask.style.display = 'flex';
  }

  function closeDialog() {
    if (running) { pushLog('正在解压，先等它跑完', 'warn'); return; }
    if (dlg) dlg.mask.style.display = 'none';
  }

  function buildDialog() {
    var mask = el('div', 'bdq-mask');
    mask.style.display = 'none';
    var box = el('div', 'bdq-dlg');

    var hd = el('div', 'bdq-hd');
    hd.appendChild(el('span', '', '批量解压'));
    var x = el('span', 'bdq-x', '×');
    x.addEventListener('click', closeDialog);
    hd.appendChild(x);

    var body = el('div', 'bdq-body');

    var filesSec = el('div', 'bdq-sec');
    filesSec.appendChild(el('div', 'bdq-lab', '已选压缩包'));
    var filesBox = el('div', 'bdq-files');
    filesSec.appendChild(filesBox);
    body.appendChild(filesSec);

    var tgtSec = el('div', 'bdq-sec');
    tgtSec.appendChild(el('div', 'bdq-lab', '解压到（点击文件夹进入）'));
    var pathBox = el('div', 'bdq-path');
    tgtSec.appendChild(pathBox);
    var folders = el('div', 'bdq-folders');
    tgtSec.appendChild(folders);

    var nf = el('div', 'bdq-new');
    var nfInput = el('input');
    nfInput.placeholder = '新建文件夹名称（创建在当前目录下）';
    var nfBtn = el('button', '', '新建并进入');
    nf.appendChild(nfInput);
    nf.appendChild(nfBtn);
    tgtSec.appendChild(nf);
    body.appendChild(tgtSec);

    var logBox = el('div', 'bdq-log');
    body.appendChild(logBox);

    var ft = el('div', 'bdq-ft');
    var opt = el('label', 'bdq-opt');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', function () { flatMode = cb.checked; });
    opt.appendChild(cb);
    opt.appendChild(document.createTextNode('平铺到目标文件夹（不建同名文件夹）'));
    ft.appendChild(opt);

    var startBtn = el('button', 'bdq-primary', '开始解压');
    var cancelBtn = el('button', 'bdq-plain', '取消');
    cancelBtn.addEventListener('click', closeDialog);
    startBtn.addEventListener('click', runAll);
    ft.appendChild(cancelBtn);
    ft.appendChild(startBtn);

    box.appendChild(hd);
    box.appendChild(body);
    box.appendChild(ft);
    mask.appendChild(box);
    document.body.appendChild(mask);

    mask.addEventListener('click', function (e) { if (e.target === mask) closeDialog(); });

    nfBtn.addEventListener('click', function () {
      var name = (nfInput.value || '').trim();
      if (!name) return pushLog('请输入文件夹名称', 'warn');
      if (/[\\/:*?"<>|]/.test(name)) return pushLog('名称包含非法字符', 'warn');
      nfBtn.disabled = true;
      createFolder(pickDir, name).then(function (r) {
        nfBtn.disabled = false;
        if (r && (r.errno === 0 || r.errno === -8)) {
          nfInput.value = '';
          pickDir = join(pickDir, name);
          renderPath();
          loadFolders(pickDir);
          pushLog('已进入 ' + pickDir, 'ok');
        } else {
          pushLog('新建失败：' + errText(r && r.errno), 'err');
        }
      }).catch(function (e) {
        nfBtn.disabled = false;
        pushLog('新建失败：' + e, 'err');
      });
    });

    return { mask: mask, filesBox: filesBox, pathBox: pathBox, folders: folders, log: logBox, startBtn: startBtn };
  }

  function pushLog(msg, kind) {
    if (!dlg) return;
    var line = el('div', 'bdq-' + (kind || ''), '[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '] ' + msg);
    dlg.log.appendChild(line);
    dlg.log.scrollTop = dlg.log.scrollHeight;
  }

  function renderFiles() {
    var list = collectSelected();
    dlg.filesBox.innerHTML = '';
    if (!list.length) {
      dlg.filesBox.appendChild(el('div', 'bdq-file', '（没有选中压缩包）'));
      return;
    }
    list.forEach(function (f) {
      dlg.filesBox.appendChild(el('div', 'bdq-file', f.name));
    });
  }

  function renderPath() {
    dlg.pathBox.innerHTML = '';
    var parts = pickDir === '/' ? [] : pickDir.split('/').filter(Boolean);
    var root = el('span', 'bdq-crumb', '根目录');
    root.addEventListener('click', function () { pickDir = '/'; renderPath(); loadFolders(pickDir); });
    dlg.pathBox.appendChild(root);
    var cur = '';
    parts.forEach(function (p) {
      cur += '/' + p;
      var sep = el('span', 'bdq-sep', '>');
      dlg.pathBox.appendChild(sep);
      var c = el('span', 'bdq-crumb', p);
      var target = cur;
      c.addEventListener('click', function () {
        pickDir = target; renderPath(); loadFolders(pickDir);
      });
      dlg.pathBox.appendChild(c);
    });
  }

  function loadFolders(dir) {
    dlg.folders.innerHTML = '';
    dlg.folders.appendChild(el('div', 'bdq-folder', '加载中…'));
    listDir(dir).then(function (r) {
      dlg.folders.innerHTML = '';
      if (!r || r.errno !== 0) {
        dlg.folders.appendChild(el('div', 'bdq-folder', '读取失败：' + errText(r && r.errno)));
        return;
      }
      var dirs = (r.list || []).filter(function (x) { return x.isdir === 1; });
      if (dir === '/') {
        var up = el('div', 'bdq-folder');
        up.appendChild(el('span', 'bdq-ico', '↖'));
        up.appendChild(el('span', '', '（当前是根目录）'));
        up.style.color = '#bbb';
        dlg.folders.appendChild(up);
      } else {
        var up2 = el('div', 'bdq-folder');
        up2.appendChild(el('span', 'bdq-ico', '↖'));
        up2.appendChild(el('span', '', '上一级'));
        up2.addEventListener('click', function () {
          var p = dir.replace(/\/[^/]+$/, '') || '/';
          pickDir = p; renderPath(); loadFolders(p);
        });
        dlg.folders.appendChild(up2);
      }
      dirs.forEach(function (d) {
        var row = el('div', 'bdq-folder');
        row.appendChild(el('span', 'bdq-ico', '📁'));
        row.appendChild(el('span', '', d.server_filename));
        row.addEventListener('click', function () {
          pickDir = d.path; renderPath(); loadFolders(pickDir);
        });
        dlg.folders.appendChild(row);
      });
      if (!dirs.length) dlg.folders.appendChild(el('div', 'bdq-folder', '（没有子文件夹）'));
    }).catch(function (e) {
      dlg.folders.innerHTML = '';
      dlg.folders.appendChild(el('div', 'bdq-folder', '读取失败：' + e));
    });
  }

  // ---------------------------------------------------------------- 执行
  function topLevelSubpaths(zipPath) {
    return listArchive(zipPath, '/').then(function (r) {
      if (!r || r.errno !== 0 || !r.list || !r.list.length) return [];
      if (r.list.length > 100) return null; // 过多，退回整包解压
      return r.list.map(function (x) { return '/' + x.file_name; });
    });
  }

  function waitTask(taskid) {
    var deadline = Date.now() + 10 * 60 * 1000;
    return new Promise(function (resolve) {
      (function tick() {
        if (Date.now() > deadline) return resolve({ ok: false, msg: '等待超时' });
        setTimeout(function () {
          taskQuery(taskid).then(function (q) {
            if (!q || q.errno !== 0) return resolve({ ok: false, msg: '查询任务失败' });
            if (q.status === 'success') return resolve({ ok: true, ext: q.extra || {} });
            if (q.status === 'failed') return resolve({ ok: false, errno: q.task_errno, ext: q.extra || {} });
            tick();
          }).catch(function () { tick(); });
        }, 1200);
      })();
    });
  }

  async function runAll() {
    if (running) return;
    var files = collectSelected();
    if (!files.length) return pushLog('没有选中压缩包', 'warn');

    running = true;
    dlg.startBtn.disabled = true;
    dlg.startBtn.textContent = '解压中…';

    var okCount = 0, failCount = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      dlg.startBtn.textContent = '解压中… ' + (i + 1) + '/' + files.length;
      pushLog('[' + (i + 1) + '/' + files.length + '] ' + f.name);
      try {
        var subs = flatMode ? await topLevelSubpaths(f.path) : [];
        if (subs === null) {
          pushLog('  包内顶层条目过多，改为建同名文件夹', 'warn');
          subs = [];
        }
        var res = await startUnzip(f.path, pickDir, subs);
        if (res.errno === 31180) { pushLog('  ✗ 需要解压密码，跳过', 'err'); failCount++; continue; }
        if (res.errno !== 0) { pushLog('  ✗ ' + errText(res.errno), 'err'); failCount++; continue; }
        if (!res.taskid) { pushLog('  ✓ 已提交', 'ok'); okCount++; continue; }
        var done = await waitTask(res.taskid);
        if (done.ok) {
          var n = (done.ext && (done.ext.success_num || done.ext.success_file_num)) || 0;
          pushLog('  ✓ 完成' + (n ? '，' + n + ' 个文件' : ''), 'ok');
          okCount++;
        } else {
          pushLog('  ✗ ' + (done.errno ? errText(done.errno) : done.msg), 'err');
          failCount++;
        }
      } catch (e) {
        pushLog('  ✗ 异常：' + (e && e.message ? e.message : e), 'err');
        failCount++;
      }
      if (i < files.length - 1) await new Promise(function (r) { setTimeout(r, 800); });
    }

    running = false;
    dlg.startBtn.disabled = false;
    dlg.startBtn.textContent = '开始解压';
    pushLog('===== 结束：成功 ' + okCount + '，失败 ' + failCount + ' =====', failCount ? 'warn' : 'ok');
    if (okCount) {
      var refresh = el('button', 'bdq-plain', '刷新页面');
      refresh.style.marginLeft = '6px';
      refresh.addEventListener('click', function () { location.reload(); });
      dlg.log.appendChild(refresh);
      dlg.log.scrollTop = dlg.log.scrollHeight;
    }
  }

  // ---------------------------------------------------------------- 启动
  injectCss();
  setInterval(function () {
    try { syncToolbar(); } catch (e) { /* 忽略 */ }
  }, 500);
})();
