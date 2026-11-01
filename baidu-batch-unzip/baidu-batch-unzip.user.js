// ==UserScript==
// @name         百度网盘批量解压
// @namespace    pan.baidu.com
// @version      5.2.2
// @description  勾选压缩包，批量解压到指定文件夹。
// @author       zc
// @license      GPL-3.0-or-later
// @match        https://pan.baidu.com/disk/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * 百度网盘批量解压
 * Copyright (C) 2026 zc
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

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
  function errText(c) {
    var t = ERRNO[String(c)];
    if (t) return t;
    console.warn('[批量解压] 未收录错误码', c);
    return '未知错误';
  }

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
      if (!token) throw new Error('登录已失效');
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
    // 工具栏按钮：取网盘原生文字按钮规格（#06a7ff / 14px / 700 / 32px / 透明底）
    '.bdq-action{display:flex;align-items:center;flex:0 0 auto}',
    '.bdq-btn{display:inline-flex;align-items:center;height:32px;margin:0;padding:0 12px;border:0;border-radius:3px;',
    'background:transparent;color:#06a7ff;font:700 14px/14px SFUIText,PingFangSC-Regular,"Helvetica Neue",Helvetica,Arial,sans-serif;',
    'white-space:nowrap;cursor:pointer;transition:color .1s}',
    '.bdq-btn:hover{color:#38b9ff}',
    '.bdq-btn:active{color:#0596e6}',
    '.bdq-btn:focus-visible{outline:2px solid rgba(6,167,255,.35);outline-offset:-2px}',
    '.bdq-btn>i{font-size:16px;margin-top:-2px;position:relative;top:2px}',
    '.bdq-btn>span{margin-left:6px}',
    // 弹窗：对齐原生对话框（12px 圆角、14px 粗体标题、48px 头部、#06a7ff 主色）
    '.bdq-mask{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
    'background:rgba(0,0,0,.5);font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.bdq-dlg{width:600px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column;background:#fff;border-radius:12px;',
    'box-shadow:0 4px 24px rgba(3,11,26,.16);overflow:hidden;color:#606266}',
    '.bdq-hd{display:flex;align-items:center;justify-content:space-between;height:48px;padding:0 24px;',
    'border-bottom:1px solid #f1f3f8;flex:0 0 auto}',
    '.bdq-title{margin:0;font-size:14px;line-height:18px;font-weight:700;color:#303133}',
    '.bdq-x{display:flex;align-items:center;justify-content:center;width:24px;height:24px;margin-right:-6px;',
    'border:0;background:transparent;color:#979797;font-size:18px;line-height:1;cursor:pointer}',
    '.bdq-x:hover{color:#06a7ff}',
    '.bdq-body{padding:20px 24px 8px;overflow:auto}',
    '.bdq-sec{margin-bottom:16px}',
    '.bdq-lab{margin-bottom:8px;font-size:13px;color:#606266}',
    '.bdq-files{max-height:88px;padding:6px 10px;overflow:auto;border-radius:4px;background:#f7f8fa;font-size:12px;color:#606266}',
    '.bdq-file{line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.bdq-path{display:flex;align-items:center;flex-wrap:wrap;padding:4px 10px;border:1px solid #ebeef5;border-radius:4px;font-size:12px;line-height:20px}',
    '.bdq-crumb{color:#06a7ff;cursor:pointer}',
    '.bdq-crumb:hover{color:#38b9ff}',
    '.bdq-crumb.is-current{color:#303133;cursor:default}',
    '.bdq-crumb.is-current:hover{color:#303133}',
    '.bdq-sep{padding:0 2px;color:#c0c4cc}',
    '.bdq-folders{height:176px;margin-top:8px;overflow:auto;border:1px solid #ebeef5;border-radius:4px}',
    '.bdq-folder{display:flex;align-items:center;height:32px;padding:0 10px;font-size:13px;color:#606266;cursor:pointer}',
    '.bdq-folder>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.bdq-folder:hover{background:#f0faff}',
    '.bdq-ico{width:16px;height:16px;margin-right:8px;flex:0 0 auto;color:#06a7ff;',
    'display:flex;align-items:center;justify-content:center}',
    '.bdq-ico svg{display:block;width:16px;height:16px}',
    '.bdq-ico-up{color:#909399;font-size:12px}',
    '.bdq-empty{padding:6px 10px;font-size:12px;color:#c0c4cc}',
    '.bdq-new{display:flex;gap:8px;margin-top:8px}',
    '.bdq-new input{flex:1;height:32px;padding:0 10px;border:1px solid #dcdfe6;border-radius:4px;font-size:13px;color:#303133;outline:0}',
    '.bdq-new input:focus{border-color:#06a7ff}',
    '.bdq-new button{height:32px;padding:0 14px;border:1px solid #06a7ff;border-radius:4px;background:#fff;color:#06a7ff;font-size:13px;cursor:pointer}',
    '.bdq-new button:hover{background:#e6f6ff;border-color:#b4e5ff}',
    '.bdq-ft{display:flex;align-items:center;gap:12px;padding:14px 24px 20px;border-top:1px solid #f1f3f8}',
    '.bdq-opt{display:flex;align-items:center;gap:6px;margin-right:auto;font-size:13px;color:#606266;cursor:pointer}',
    '.bdq-opt input{width:14px;height:14px;margin:0;accent-color:#06a7ff}',
    '.bdq-primary{height:32px;padding:0 20px;border:0;border-radius:4px;background:#06a7ff;color:#fff;font-size:14px;cursor:pointer}',
    '.bdq-primary:hover{background:#38b9ff}',
    '.bdq-primary:disabled{background:#83d3ff;cursor:not-allowed}',
    '.bdq-plain{height:32px;padding:0 20px;border:1px solid #dcdfe6;border-radius:4px;background:#fff;color:#606266;font-size:14px;cursor:pointer}',
    '.bdq-plain:hover{color:#06a7ff;border-color:#b4e5ff;background:#e6f6ff}',
    '.bdq-log{display:none;max-height:120px;overflow:auto;padding:8px 24px;border-top:1px solid #f1f3f8;',
    'background:#fafbfc;font:12px/20px ui-monospace,Menlo,Consolas,monospace;color:#606266}',
    '.bdq-ok{color:#0bd6a7}.bdq-err{color:#ff436a}.bdq-warn{color:#e6a23c}'
  ].join('');

  function injectCss() {
    if (document.getElementById('bdq-style')) return;
    var s = document.createElement('style');
    s.id = 'bdq-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---------------------------------------------------------------- 工具栏按钮
  var toolbarWrap = null;
  var lastCount = -1;

  // 原生选中工具栏的动作组；结构变化时退回整条工具栏
  function findActionGroup() {
    var bar = document.querySelector('.wp-s-agile-tool-bar__header.is-header-tool');
    if (!bar) return null;
    return bar.querySelector('.wp-s-agile-tool-bar__h-button-group.is-list') ||
           bar.querySelector('.wp-s-agile-tool-bar__h-button-group') ||
           bar;
  }

  function makeToolbarButton() {
    var btn = el('button', 'bdq-btn u-button u-button--text u-button--small wp-s-agile-tool-bar__h-action-button');
    btn.type = 'button';
    btn.title = '批量解压';
    var ico = el('i', 'u-icon u-icon-unzip');
    ico.setAttribute('aria-hidden', 'true');
    var label = el('span', '', '批量解压');
    btn.appendChild(ico);
    btn.appendChild(label);
    btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openDialog();
    });
    btn.__label = label;
    return btn;
  }

  function removeToolbarButton() {
    if (toolbarWrap && toolbarWrap.parentNode) toolbarWrap.parentNode.removeChild(toolbarWrap);
    toolbarWrap = null;
    lastCount = -1;
  }

  function syncToolbar() {
    injectCss();
    var selected = collectSelected();
    var group = findActionGroup();

    if (!group || !selected.length) {
      removeToolbarButton();
      return;
    }
    if (!toolbarWrap) {
      toolbarWrap = el('div', 'bdq-action wp-s-agile-tool-bar__h-action is-need-left-sep is-list');
      toolbarWrap.appendChild(makeToolbarButton());
    }
    // 网盘每次勾选都会重绘工具栏，节点被清掉就放回动作组末尾
    if (toolbarWrap.parentNode !== group) group.appendChild(toolbarWrap);
    if (selected.length !== lastCount) {
      toolbarWrap.firstChild.__label.textContent = '批量解压（' + selected.length + '）';
      lastCount = selected.length;
    }
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
    if (running) { pushLog('解压中', 'warn'); return; }
    if (dlg) dlg.mask.style.display = 'none';
  }

  function buildDialog() {
    var mask = el('div', 'bdq-mask');
    mask.style.display = 'none';
    var box = el('div', 'bdq-dlg');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '批量解压');

    var hd = el('div', 'bdq-hd');
    hd.appendChild(el('h3', 'bdq-title', '批量解压'));
    var x = el('button', 'bdq-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', '关闭');
    x.addEventListener('click', closeDialog);
    hd.appendChild(x);

    var body = el('div', 'bdq-body');

    var filesSec = el('div', 'bdq-sec');
    filesSec.appendChild(el('div', 'bdq-lab', '已选压缩包'));
    var filesBox = el('div', 'bdq-files');
    filesSec.appendChild(filesBox);
    body.appendChild(filesSec);

    var tgtSec = el('div', 'bdq-sec');
    tgtSec.appendChild(el('div', 'bdq-lab', '解压到'));
    var pathBox = el('div', 'bdq-path');
    tgtSec.appendChild(pathBox);
    var folders = el('div', 'bdq-folders');
    tgtSec.appendChild(folders);

    var nf = el('div', 'bdq-new');
    var nfInput = el('input');
    nfInput.placeholder = '新建文件夹';
    var nfBtn = el('button', '', '新建');
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
    cb.checked = false;
    cb.addEventListener('change', function () { flatMode = !cb.checked; });
    opt.appendChild(cb);
    opt.appendChild(document.createTextNode('新建同名文件夹'));
    ft.appendChild(opt);

    var startBtn = el('button', 'bdq-primary', '开始解压');
    var cancelBtn = el('button', 'bdq-plain', '取消');
    var refreshBtn = el('button', 'bdq-plain', '刷新');
    refreshBtn.type = 'button';
    refreshBtn.style.display = 'none';
    cancelBtn.addEventListener('click', closeDialog);
    refreshBtn.addEventListener('click', function () { location.reload(); });
    startBtn.addEventListener('click', runAll);
    ft.appendChild(cancelBtn);
    ft.appendChild(refreshBtn);
    ft.appendChild(startBtn);

    box.appendChild(hd);
    box.appendChild(body);
    box.appendChild(ft);
    mask.appendChild(box);
    document.body.appendChild(mask);

    mask.addEventListener('click', function (e) { if (e.target === mask) closeDialog(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mask.style.display !== 'none') closeDialog();
    });

    nfBtn.addEventListener('click', function () {
      var name = (nfInput.value || '').trim();
      if (!name) return pushLog('文件夹名称不能为空', 'warn');
      if (/[\\/:*?"<>|]/.test(name)) return pushLog('文件夹名称不能包含特殊字符', 'warn');
      nfBtn.disabled = true;
      createFolder(pickDir, name).then(function (r) {
        nfBtn.disabled = false;
        if (r && (r.errno === 0 || r.errno === -8)) {
          nfInput.value = '';
          pickDir = join(pickDir, name);
          renderPath();
          loadFolders(pickDir);
          pushLog('新建完成', 'ok');
        } else {
          pushLog('新建失败：' + errText(r && r.errno), 'err');
        }
      }).catch(function () {
        nfBtn.disabled = false;
        pushLog('新建失败：网络异常', 'err');
      });
    });

    return { mask: mask, filesBox: filesBox, pathBox: pathBox, folders: folders, log: logBox, startBtn: startBtn, refreshBtn: refreshBtn };
  }

  function pushLog(msg, kind) {
    if (!dlg) return;
    var line = el('div', 'bdq-' + (kind || ''), '[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '] ' + msg);
    dlg.log.style.display = 'block';
    dlg.log.appendChild(line);
    dlg.log.scrollTop = dlg.log.scrollHeight;
  }

  function renderFiles() {
    var list = collectSelected();
    dlg.filesBox.innerHTML = '';
    if (!list.length) {
      dlg.filesBox.appendChild(el('div', 'bdq-empty', '未选择压缩包'));
      return;
    }
    list.forEach(function (f) {
      dlg.filesBox.appendChild(el('div', 'bdq-file', f.name));
    });
  }

  function renderPath() {
    dlg.pathBox.innerHTML = '';
    var parts = pickDir === '/' ? [] : pickDir.split('/').filter(Boolean);
    var root = el('span', 'bdq-crumb' + (parts.length ? '' : ' is-current'), '全部文件');
    if (parts.length) {
      root.addEventListener('click', function () { pickDir = '/'; renderPath(); loadFolders(pickDir); });
    }
    dlg.pathBox.appendChild(root);
    var cur = '';
    parts.forEach(function (p, idx) {
      cur += '/' + p;
      dlg.pathBox.appendChild(el('span', 'bdq-sep', '/'));
      var c = el('span', 'bdq-crumb' + (idx === parts.length - 1 ? ' is-current' : ''), p);
      if (idx < parts.length - 1) {
        var target = cur;
        c.addEventListener('click', function () {
          pickDir = target; renderPath(); loadFolders(pickDir);
        });
      }
      dlg.pathBox.appendChild(c);
    });
  }

  var FOLDER_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M1.9 4.4c0-.62.5-1.12 1.12-1.12h2.9l1.3 1.5h5.76c.62 0 1.12.5 1.12 1.12v5.68c0 .62-.5 1.12-1.12 1.12H3.02c-.62 0-1.12-.5-1.12-1.12V4.4Z" ' +
    'stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  function folderIcon() {
    var i = el('span', 'bdq-ico');
    i.innerHTML = FOLDER_SVG;
    return i;
  }

  function loadFolders(dir) {
    dlg.folders.innerHTML = '';
    dlg.folders.appendChild(el('div', 'bdq-empty', '加载中…'));
    listDir(dir).then(function (r) {
      dlg.folders.innerHTML = '';
      if (!r || r.errno !== 0) {
        dlg.folders.appendChild(el('div', 'bdq-empty', '加载失败：' + errText(r && r.errno)));
        return;
      }
      var dirs = (r.list || []).filter(function (x) { return x.isdir === 1; });
      if (dir !== '/') {
        var up = el('div', 'bdq-folder');
        up.appendChild(el('span', 'bdq-ico bdq-ico-up', '↑'));
        up.appendChild(el('span', '', '上一级'));
        up.addEventListener('click', function () {
          var p = dir.replace(/\/[^/]+$/, '') || '/';
          pickDir = p; renderPath(); loadFolders(p);
        });
        dlg.folders.appendChild(up);
      }
      dirs.forEach(function (d) {
        var row = el('div', 'bdq-folder');
        row.appendChild(folderIcon());
        row.appendChild(el('span', '', d.server_filename));
        row.addEventListener('click', function () {
          pickDir = d.path; renderPath(); loadFolders(pickDir);
        });
        dlg.folders.appendChild(row);
      });
      if (!dirs.length) dlg.folders.appendChild(el('div', 'bdq-empty', '暂无子文件夹'));
    }).catch(function () {
      dlg.folders.innerHTML = '';
      dlg.folders.appendChild(el('div', 'bdq-empty', '加载失败：网络异常'));
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
        if (Date.now() > deadline) return resolve({ ok: false, msg: '解压超时' });
        setTimeout(function () {
          taskQuery(taskid).then(function (q) {
            if (!q || q.errno !== 0) return resolve({ ok: false, msg: '无法获取进度' });
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
    if (!files.length) return pushLog('未选择压缩包', 'warn');

    running = true;
    dlg.startBtn.disabled = true;
    dlg.startBtn.textContent = '解压中';
    dlg.refreshBtn.style.display = 'none';

    var okCount = 0, failCount = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      dlg.startBtn.textContent = '解压中';
      pushLog('[' + (i + 1) + '/' + files.length + '] ' + f.name);
      try {
        var subs = flatMode ? await topLevelSubpaths(f.path) : [];
        if (subs === null) {
          pushLog('包内条目过多，改为整体解压', 'warn');
          subs = [];
        }
        var res = await startUnzip(f.path, pickDir, subs);
        if (res.errno === 31180) { pushLog('失败：需要解压密码', 'err'); failCount++; continue; }
        if (res.errno !== 0) { pushLog('失败：' + errText(res.errno), 'err'); failCount++; continue; }
        if (!res.taskid) { pushLog('已提交解压', 'ok'); okCount++; continue; }
        var done = await waitTask(res.taskid);
        if (done.ok) {
          var n = (done.ext && (done.ext.success_num || done.ext.success_file_num)) || 0;
          pushLog('完成' + (n ? '，' + n + ' 个文件' : ''), 'ok');
          okCount++;
        } else {
          pushLog('失败：' + (done.errno ? errText(done.errno) : done.msg), 'err');
          failCount++;
        }
      } catch (e) {
        if (e && /[\u4e00-\u9fa5]/.test(e.message || '')) {
          pushLog('失败：' + e.message, 'err');
        } else {
          console.warn('[批量解压] 解压失败', e);
          pushLog('失败：网络异常', 'err');
        }
        failCount++;
      }
      if (i < files.length - 1) await new Promise(function (r) { setTimeout(r, 800); });
    }

    running = false;
    dlg.startBtn.disabled = false;
    dlg.startBtn.textContent = '开始解压';
    pushLog(failCount ? '完成：成功 ' + okCount + '，失败 ' + failCount : '全部完成', failCount ? 'warn' : 'ok');
    if (okCount) dlg.refreshBtn.style.display = '';
  }

  // ---------------------------------------------------------------- 启动
  injectCss();
  setInterval(function () {
    try { syncToolbar(); } catch (e) { /* 忽略 */ }
  }, 500);
})();
