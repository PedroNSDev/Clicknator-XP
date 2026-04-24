const SAVE_KEY     = 'winxp-state';
const UNLOCK_KEY   = 'winxp-unlocks';
const FILE_KEY     = 'winxp-files';
const UPGRADES_KEY = 'winxp-upgrades';
const sounds = {
    click: new Audio('click.mp3'),
    open: new Audio('open.mp3')
};
const openApps        = new Set();
let zIndexCounter     = 10;
let appsList          = [];
let connections       = [];
let pendingConnection = null;
let usedRAM           = 0;
let currentTargetIcon = null;

window.systemInfo = { username: '', ram: 256, space: 2048, session_time: 0 };

const saveState    = d => localStorage.setItem(SAVE_KEY,     JSON.stringify(d));
const loadState    = () => JSON.parse(localStorage.getItem(SAVE_KEY))     || {};
const saveUnlocks  = d => localStorage.setItem(UNLOCK_KEY,  JSON.stringify(d));
const getUnlocks   = () => JSON.parse(localStorage.getItem(UNLOCK_KEY))   || {};
const getFiles     = () => JSON.parse(localStorage.getItem(FILE_KEY))     || [];
const saveFiles    = f  => localStorage.setItem(FILE_KEY,   JSON.stringify(f));
const getUpgrades  = () => JSON.parse(localStorage.getItem(UPGRADES_KEY)) || { ram: 0, space: 0 };
const saveUpgrades = d  => localStorage.setItem(UPGRADES_KEY, JSON.stringify(d));
window.getFiles     = getFiles;
window.saveFiles    = saveFiles;
window.getUpgrades  = getUpgrades;
window.saveUpgrades = function(d) { saveUpgrades(d); applyUpgrades(); };

const desktop            = document.getElementById('desktop');
const taskbarApps        = document.getElementById('taskbar-apps');
const contextMenu        = document.getElementById('context-menu');
const startBtn           = document.getElementById('start-btn');
const startMenu          = document.getElementById('start-menu');
const wallpaperInput     = document.getElementById('wallpaper-input');
const changeWallpaperBtn = document.getElementById('change-wallpaper');
const canvas = document.getElementById('cables');
const ctx    = canvas.getContext('2d');

const resizeCanvas = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
window.addEventListener('resize', () => {
    resizeCanvas();
    clearTimeout(window._iconResizeTimer);
    window._iconResizeTimer = setTimeout(() => {
        if (appsList.length) renderAllIcons();
    }, 120);
});
resizeCanvas();

// ── NEW GRID  ──
const ICON_PAD_TOP  = 12; 
const ICON_PAD_SIDE = 10; 

function gridCellSize() {
    const dw = desktop.offsetWidth  || window.innerWidth;
    const dh = (desktop.offsetHeight || window.innerHeight - 42);
    const cw = Math.min(100, Math.max(76, Math.round(dw / 14)));
    const ch = Math.min(98,  Math.max(78, Math.round(dh / 7)));
    return { cw, ch };
}

function gridRows() {
    const dh = (desktop.offsetHeight || window.innerHeight - 42) - ICON_PAD_TOP;
    const { ch } = gridCellSize();
    return Math.max(1, Math.floor(dh / ch));
}

function iconPos(idx) {
    const rows    = gridRows();
    const { cw, ch } = gridCellSize();
    const col = Math.floor(idx / rows);
    const row = idx % rows;
    return {
        top:  ICON_PAD_TOP  + row * ch,
        left: ICON_PAD_SIDE + col * cw,
    };
}

const WINDOW_SIZES = {
    small:      { w: 320,  h: 240  },
    medium:     { w: 540,  h: 380  },
    big:        { w: 800,  h: 580  },
    fullscreen: null
};

(function () {
    const s = document.createElement('style');
    s.textContent = `
        .icon.sel-highlight { background:rgba(49,106,197,0.22);border-radius:3px; }
        .icon.sel-highlight .icon-img { outline:2px solid #316ac5; }
        #sel-rubber { position:absolute;border:1px solid #316ac5;
            background:rgba(49,106,197,0.08);pointer-events:none;z-index:9998; }
        .connect-btn-left  { background:#316ac5!important;color:white!important;
            border-color:#1a4a9a!important;border-radius:2px 0 0 2px!important; }
        .connect-btn-right { background:#6a1b9a!important;color:white!important;
            border-color:#4a0f6e!important;border-radius:0 2px 2px 0!important; }
        .taskbar-app.minimized { opacity:0.65; font-style:italic; }
        .taskbar-app.minimized .taskbar-label::before { content:'— '; }

        /* ── AUDIO TOAST ── */
        #audio-toast {
            position:fixed;
            bottom:50px; right:12px;
            background:#d4d0c8;
            color:#e8e8e8;
            border-radius:1px;
            padding:10px 14px;
            z-index:99999;
            display:none;
            align-items:center;
            gap:10px;
            box-shadow:0 4px 24px rgba(0,0,0,0.5);
            font-family:Tahoma,sans-serif;
            font-size:12px;
            min-width:240px;
            max-width:300px;
            border:1px solid #2a2a44;
            animation:toast-in 0.25s ease;
            cursor:default;
        }
        #audio-toast.visible { display:flex; }
        @keyframes toast-in {
            from { opacity:0; transform:translateY(14px) scale(0.95); }
            to   { opacity:1; transform:translateY(0)  scale(1); }
        }
        #audio-toast .toast-art {
            width:38px; height:38px; border-radius:2px;
            background:linear-gradient(to top, #0058e6 50%, #3a93ff 100%);
            display:flex; align-items:center; justify-content:center;
            font-size:20px; flex-shrink:0;
        }
        #audio-toast .toast-info { flex:1; overflow:hidden; }
        #audio-toast .toast-track {
            font-weight:600; font-size:12px; color:#fff;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        }
        #audio-toast .toast-status { font-size:10px; color:#777; margin-top:2px; }
        .toast-ctrl {
            background:none; border:none; color:#aaa; cursor:pointer;
            font-size:16px; padding:4px; border-radius:4px; transition:color .15s;
        }
        .toast-ctrl:hover { color:#fff; background:rgba(255,255,255,0.08); }
        #audio-toast .toast-close {
            position:absolute; top:6px; right:8px;
            background:none; border:none; color:#444; cursor:pointer;
            font-size:12px; padding:0 2px;
        }
        #audio-toast .toast-close:hover { color:#aaa; }
        #audio-toast .toast-progress {
            position:absolute; bottom:0; left:0; right:0; height:2px;
            background:rgba(255,255,255,0.06); border-radius:0 0 10px 10px; overflow:hidden;
        }
        #audio-toast .toast-progress-fill {
            height:100%; background:linear-gradient(90deg,#6c63ff,#a78bfa);
            width:0%; transition:width 0.5s linear;
        }
        #audio-toast { position:fixed; } /* re-assert for safety */
    `;
    document.head.appendChild(s);
})();

// ── AUDIO TOAST ──
let _audioToastPinned = false;

function ensureAudioToast() {
    if (document.getElementById('audio-toast')) return;
    const toast = document.createElement('div');
    toast.id = 'audio-toast';
    toast.innerHTML = `
        <div class="toast-art">🎵</div>
        <div class="toast-info">
            <div class="toast-track" id="toast-track-name">—</div>
            <div class="toast-status" id="toast-status">Parado</div>
        </div>
        <button class="toast-ctrl" id="toast-prev" title="Anterior">⏮</button>
        <button class="toast-ctrl" id="toast-play" title="Play/Pausa">▶</button>
        <button class="toast-ctrl" id="toast-next" title="Próxima">⏭</button>
        <button class="toast-close" id="toast-close" title="Fechar">✕</button>
        <div class="toast-progress"><div class="toast-progress-fill" id="toast-prog"></div></div>
    `;
    toast.style.position = 'fixed';
    document.body.appendChild(toast);

    const sendCtrl = action => {
        const wins = document.querySelectorAll('.window');
        for (const w of wins) {
            if (w.id.includes('go-music')) {
                w.querySelector('iframe')?.contentWindow?.postMessage({ type:'control', action }, '*');
                break;
            }
        }
    };

    document.getElementById('toast-prev') .onclick = () => sendCtrl('prev');
    document.getElementById('toast-play') .onclick = () => sendCtrl('toggle');
    document.getElementById('toast-next') .onclick = () => sendCtrl('next');
    document.getElementById('toast-close').onclick = () => {
        _audioToastPinned = false;
        hideAudioToast();
    };

    // Make toast draggable
    let tx1=0,ty1=0,tx2=0,ty2=0;
    toast.addEventListener('mousedown', e => {
        if (e.target.closest('button')) return;
        tx2 = e.clientX; ty2 = e.clientY;
        const onMove = e => {
            tx1 = tx2 - e.clientX; ty1 = ty2 - e.clientY;
            tx2 = e.clientX; ty2 = e.clientY;
            toast.style.top    = (toast.offsetTop  - ty1) + 'px';
            toast.style.right  = 'auto';
            toast.style.left   = (toast.offsetLeft - tx1) + 'px';
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function showAudioToast(info) {
    ensureAudioToast();
    const toast = document.getElementById('audio-toast');
    document.getElementById('toast-track-name').textContent = info.name || '—';
    document.getElementById('toast-status').textContent     = info.playing ? '▶ Tocando' : '⏸ Pausado';
    document.getElementById('toast-play').textContent       = info.playing ? '⏸' : '▶';
    if (info.progress != null) document.getElementById('toast-prog').style.width = (info.progress * 100) + '%';
    toast.classList.add('visible');
}

function hideAudioToast() {
    document.getElementById('audio-toast')?.classList.remove('visible');
}

function isAudioWinMinimized() {
    const wins = document.querySelectorAll('.window');
    for (const w of wins) {
        if (w.id.includes('go-music') && w.dataset.minimized === '1') return true;
    }
    return false;
}

function drawConnections() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    connections.forEach(({ from, to }) => {
        if (from.dataset.minimized === '1' || to.dataset.minimized === '1') return;
        const r1 = from.getBoundingClientRect();
        const r2 = to.getBoundingClientRect();
        const x1 = r1.right, y1 = r1.top + r1.height / 2;
        const x2 = r2.left,  y2 = r2.top  + r2.height / 2;
        const cdx = Math.max(60, Math.abs(x2 - x1) * 0.5);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1 + cdx, y1, x2 - cdx, y2, x2, y2);
        ctx.strokeStyle = 'black';
        ctx.lineWidth   = 2;
        ctx.stroke();
    });
}

function updateClock() {
    const now = new Date();
    document.getElementById('clock').innerText =
        `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}
setInterval(updateClock, 1000);
updateClock();

function makeDraggable(element, handle) {
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    (handle || element).onmousedown = e => {
        e.preventDefault();
        x2 = e.clientX; y2 = e.clientY;

        let companions = [];
        if (element.classList.contains('icon') && element.classList.contains('sel-highlight')) {
            companions = [...document.querySelectorAll('.icon.sel-highlight')].filter(i => i !== element);
        }
        document.onmouseup = upEvent => {
            document.onmouseup = document.onmousemove = null;
            if (element.classList.contains('file') && element.dataset.fileId) {
                for (const fw of document.querySelectorAll('[id^="window-folder-"]')) {
                    const r = fw.getBoundingClientRect();
                    if (upEvent.clientX >= r.left && upEvent.clientX <= r.right &&
                        upEvent.clientY >= r.top  && upEvent.clientY <= r.bottom) {
                        const folderId = parseInt(fw.id.replace('window-folder-', ''));
                        const toMove = [element, ...companions].filter(el => el.classList.contains('file') && el.dataset.fileId);
                        toMove.forEach(el => moveFileBetween(parseInt(el.dataset.fileId), folderId));
                        return;
                    }
                }
            }
        };
        document.onmousemove = e => {
            e.preventDefault();
            x1 = x2 - e.clientX; y1 = y2 - e.clientY;
            x2 = e.clientX;      y2 = e.clientY;
            element.style.top  = (element.offsetTop  - y1) + 'px';
            element.style.left = (element.offsetLeft - x1) + 'px';
            companions.forEach(c => {
                c.style.top  = (c.offsetTop  - y1) + 'px';
                c.style.left = (c.offsetLeft - x1) + 'px';
            });
            if (element.classList.contains('window')) drawConnections();
        };
        if (element.classList.contains('window')) {
            element.style.zIndex = ++zIndexCounter;
            drawConnections();
        }
    };
}

function makeResizable(win) {
    const minW = 200, minH = 150;
    function initResize(e, type) {
        e.preventDefault();
        const sX = e.clientX, sY = e.clientY;
        const sW = win.offsetWidth, sH = win.offsetHeight;
        const onMove = e => {
            if (type !== 'bottom') win.style.width  = Math.max(minW, sW + e.clientX - sX) + 'px';
            if (type !== 'right')  win.style.height = Math.max(minH, sH + e.clientY - sY) + 'px';
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }
    const rr = win.querySelector('.resize-handle.right');
    const rb = win.querySelector('.resize-handle.bottom');
    const rc = win.querySelector('.resize-handle.corner');
    if (rr) rr.onmousedown = e => initResize(e, 'right');
    if (rb) rb.onmousedown = e => initResize(e, 'bottom');
    if (rc) rc.onmousedown = e => initResize(e, 'corner');
}

function getWinPorts(win) {
    try { return JSON.parse(win.dataset.ports || '[]'); } catch { return []; }
}
function getInputPorts(win)  { return getWinPorts(win).filter(p => p.dir === 'in' || p.dir === 'storage'); }
function winAcceptsFormat(win, fmt) {
    if (win.id.startsWith('window-folder-')) return true;
    return getInputPorts(win).some(p => p.format === 'any' || p.format === fmt);
}
function winHasStoragePort(win) {
    return getWinPorts(win).some(p => p.dir === 'storage');
}

const DESKTOP_FILE_TYPES = {
    text:     { icon: '📝', onDblClick: file => openNotepad(file.id)     },
    folder:   { icon: '📁', onDblClick: file => openFolder(file.id)      },
    image:    { icon: '🖼️', onDblClick: file => openImageViewer(file)    },
    shortcut: { icon: '⭐', onDblClick: file => openShortcut(file)        },
    fish:     { icon: '🐟', onDblClick: file => openFishViewer(file)     },
    dinheiro: { icon: '💰', onDblClick: file => openDinheiroViewer(file) },
    audio:    { icon: '🎵', onDblClick: file => openAudioPlayer(file)    },
};
const TYPE_ICONS = { text:'📝', folder:'📁', fish:'🐟', app:'⚙️', image:'🖼️', shortcut:'⭐', dinheiro:'💰', art:'🎨', audio:'🎵' };

const FILE_DELETE_HANDLERS = {
    app: file => {
        const id = file.data?.appId;
        if (!id) return;
        appsList = appsList.filter(a => a.id !== id);
        lockApp(id);
        removeDesktopIcon(id);
    },
};

window.getUsedSpace = () => getFiles().reduce((acc, f) => acc + (f.size || 50), 0);

window.addFile = function(file) {
    const files    = getFiles();
    const fileSize = file.size || 50;
    const used     = files.reduce((acc, f) => acc + (f.size || 50), 0);
    if (used + fileSize > window.systemInfo.space) { alert('Armazenamento cheio!'); return null; }
    const saved = { id: Date.now(), name: file.name, type: file.type, size: fileSize, data: file.data || null };
    files.push(saved);
    saveFiles(files);
    return saved;
};
const addFile = window.addFile;

window.deleteFile = function(id) {
    let files = getFiles();
    const file = files.find(f => f.id == id);
    if (!file) return;
    files.forEach(f => {
        if (f.type === 'folder' && Array.isArray(f.data?.children))
            f.data.children = f.data.children.filter(c => c != id);
    });
    FILE_DELETE_HANDLERS[file.type]?.(file);
    saveFiles(files.filter(f => f.id != id));
    renderDesktopFiles();
    document.querySelectorAll('[id^="window-folder-"]').forEach(w => w.refreshFolder?.());
    document.getElementById('window-inventario')?.querySelector('iframe')
        ?.contentWindow?.postMessage({ type: 'file-deleted' }, '*');
};
const deleteFile = window.deleteFile;

function moveFileBetween(fileId, targetFolderId) {
    const files = getFiles();
    files.forEach(f => {
        if (f.type === 'folder' && Array.isArray(f.data?.children))
            f.data.children = f.data.children.filter(c => c != fileId);
    });
    if (targetFolderId != null) {
        const folder = files.find(f => f.id === targetFolderId);
        if (folder) {
            if (!folder.data.children) folder.data.children = [];
            if (!folder.data.children.includes(fileId)) folder.data.children.push(fileId);
        }
    }
    saveFiles(files);
    renderDesktopFiles();
    document.querySelectorAll('[id^="window-folder-"]').forEach(w => w.refreshFolder?.());
}

// ── RENDER ICons ──
function renderAllIcons() {
    document.querySelectorAll('.icon[data-app], .icon.file').forEach(e => e.remove());

    let slotIdx = 0; 
    appsList.forEach(app => {
        if (!isUnlocked(app)) return;
        const icon = document.createElement('div');
        icon.className     = 'icon';
        icon.dataset.app   = app.id;
        const pos = iconPos(slotIdx++);
        icon.style.top  = pos.top  + 'px';
        icon.style.left = pos.left + 'px';
        icon.innerHTML = `<div class="icon-img">${app.icone}</div><span>${app.nome}</span>`;
        makeDraggable(icon);
        icon.addEventListener('dblclick', () => openAppById(app.id));
        icon.addEventListener('click', e => {
            if (e.ctrlKey) { e.stopPropagation(); icon.classList.toggle('sel-highlight'); }
        });
        icon.addEventListener('contextmenu', e => {
            e.preventDefault(); e.stopPropagation();
            currentTargetIcon = icon;
            showContextMenu(e.pageX, e.pageY, 'app');
        });
        desktop.appendChild(icon);
    });

    const allFiles = getFiles();
    const childIds = new Set();
    allFiles.forEach(f => {
        if (f.type === 'folder' && Array.isArray(f.data?.children))
            f.data.children.forEach(id => childIds.add(id));
    });

    allFiles.forEach(file => {
        if (childIds.has(file.id)) return;
        const typeDef = DESKTOP_FILE_TYPES[file.type];
        if (!typeDef) return;

        const icon          = document.createElement('div');
        icon.className      = 'icon file';
        icon.dataset.fileId = file.id;
        const pos = iconPos(slotIdx++);
        icon.style.top  = pos.top  + 'px';
        icon.style.left = pos.left + 'px';

        let iconContent = typeDef.icon;
        if (file.type === 'image' && file.data?.src) {
            iconContent = `<img src="${file.data.src}" style="width:36px;height:28px;object-fit:cover;border:1px solid #999;border-radius:2px;display:block;margin:0 auto 2px;">`;
        }
        icon.innerHTML = `<div class="icon-img">${iconContent}</div><span>${file.name}</span>`;
        makeDraggable(icon);
        icon.draggable = true;
        icon.addEventListener('dragstart', ev => {
            ev.dataTransfer.setData('vfs-file-id', String(file.id));
            ev.dataTransfer.setData('text/plain',  String(file.id));
            icon.style.opacity = '0.5';
        });
        icon.addEventListener('dragend', () => { icon.style.opacity = '1'; });
        icon.addEventListener('dblclick', () => typeDef.onDblClick(file));
        icon.addEventListener('click', e => {
            if (e.ctrlKey) { e.stopPropagation(); icon.classList.toggle('sel-highlight'); }
        });
        icon.addEventListener('contextmenu', e => {
            e.preventDefault(); e.stopPropagation();
            currentTargetIcon = icon;
            showContextMenu(e.pageX, e.pageY, 'file');
        });
        desktop.appendChild(icon);
    });
}

// PLACEHLDER DPS FAZER UM RUN TIME PRA UNIFICAR TUDO
window.renderDesktopFiles = renderAllIcons;
const renderDesktopFiles  = renderAllIcons;

desktop.addEventListener('contextmenu', e => {
    e.preventDefault();
    currentTargetIcon = null;
    showContextMenu(e.pageX, e.pageY, 'desktop');
});

let _rbs = null, _rbEl = null;

desktop.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target !== desktop) return;
    if (!e.ctrlKey) document.querySelectorAll('.icon.sel-highlight').forEach(i => i.classList.remove('sel-highlight'));
    const dr = desktop.getBoundingClientRect();
    _rbs  = { x: e.clientX - dr.left + desktop.scrollLeft, y: e.clientY - dr.top + desktop.scrollTop };
    _rbEl = document.createElement('div');
    _rbEl.id = 'sel-rubber';
    _rbEl.style.left = _rbs.x + 'px';
    _rbEl.style.top  = _rbs.y + 'px';
    desktop.appendChild(_rbEl);
});

document.addEventListener('mousemove', e => {
    if (!_rbs || !_rbEl) return;
    const dr   = desktop.getBoundingClientRect();
    const cx   = e.clientX - dr.left + desktop.scrollLeft;
    const cy   = e.clientY - dr.top  + desktop.scrollTop;
    const minX = Math.min(_rbs.x, cx), maxX = Math.max(_rbs.x, cx);
    const minY = Math.min(_rbs.y, cy), maxY = Math.max(_rbs.y, cy);
    _rbEl.style.left   = minX + 'px';
    _rbEl.style.top    = minY + 'px';
    _rbEl.style.width  = (maxX - minX) + 'px';
    _rbEl.style.height = (maxY - minY) + 'px';
    document.querySelectorAll('.icon').forEach(icon => {
        const r  = icon.getBoundingClientRect();
        const ix = r.left - dr.left + r.width  / 2 + desktop.scrollLeft;
        const iy = r.top  - dr.top  + r.height / 2 + desktop.scrollTop;
        icon.classList.toggle('sel-highlight', ix >= minX && ix <= maxX && iy >= minY && iy <= maxY);
    });
});

document.addEventListener('mouseup', () => {
    if (!_rbs) return;
    _rbs = null;
    _rbEl?.remove(); _rbEl = null;
});

desktop.addEventListener('click', e => {
    if (e.target === desktop && !e.ctrlKey)
        document.querySelectorAll('.icon.sel-highlight').forEach(i => i.classList.remove('sel-highlight'));
});

desktop.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain') ||
        e.dataTransfer.types.includes('vfs-file-id')) e.preventDefault();
});
desktop.addEventListener('drop', e => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    const images = files.filter(f => f.type.startsWith('image/'));
    const audios = files.filter(f => f.type.startsWith('audio/'));
    const texts  = files.filter(f => f.type.startsWith('text/') || f.name.endsWith('.txt') || f.name.endsWith('.md') || f.name.endsWith('.csv'));
    if (images.length) images.forEach(importRealImage);
    if (audios.length) audios.forEach(ImportAudioFile);
    if (texts.length)  texts.forEach(importTextFile);
    const vfsId = e.dataTransfer.getData('vfs-file-id');
    if (vfsId) moveFileBetween(parseInt(vfsId), null);
});

function importRealImage(file) {
    const sizeMB = Math.max(1, Math.round(file.size / 1024 / 1024));
    const reader = new FileReader();
    reader.onload = ev => {
        const saved = addFile({ name: file.name, type: 'image', size: sizeMB, data: { src: ev.target.result } });
        if (saved) renderDesktopFiles();
    };
    reader.readAsDataURL(file);
}

function importTextFile(file) {
    const sizeMB = Math.max(1, Math.ceil(file.size / 1024));
    const reader = new FileReader();
    reader.onload = ev => {
        const saved = addFile({ name: file.name, type: 'text', size: sizeMB, data: { content: ev.target.result } });
        if (saved) renderDesktopFiles();
    };
    reader.readAsText(file);
}

function importImageFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.onchange = e => [...e.target.files].forEach(importRealImage);
    input.click();
}

// ── AUDIO PLAYER ──
window.openAudioPlayer = function(file) {
    const existing = document.getElementById('window-go-music');
    if (!existing) {
        const app = appsList.find(a => a.id === 'go-music');
        if (app) {
            openAppById('go-music');
        } else {
            // fallback
            openSimpleAudioPlayer(file);
            return;
        }
        setTimeout(() => {
            const win = document.getElementById('window-go-music');
            if (win && file?.data?.src) {
                win.querySelector('iframe')?.contentWindow?.postMessage({
                    type: 'resource-received',
                    resource: { name: file.name, type: 'audio', size: file.size, data: file.data }
                }, '*');
            }
        }, 400);
    } else {
        existing.style.zIndex = ++zIndexCounter;
        if (existing.dataset.minimized === '1') restoreWindow(existing, document.querySelector(`[data-win-id="window-go-music"]`));
        if (file?.data?.src) {
            existing.querySelector('iframe')?.contentWindow?.postMessage({
                type: 'resource-received',
                resource: { name: file.name, type: 'audio', size: file.size, data: file.data }
            }, '*');
        }
    }
};
const openAudioPlayer = window.openAudioPlayer;

function openSimpleAudioPlayer(file) {
    const winId = `audio-simple-${file.id}`;
    if (document.getElementById(winId)) { document.getElementById(winId).style.zIndex = ++zIndexCounter; return; }
    const win = document.createElement('div');
    win.className = 'window'; win.id = winId; win.style.zIndex = ++zIndexCounter;
    win.style.top = '120px'; win.style.left = '160px'; win.style.width = '300px'; win.style.height = '110px';
    win.innerHTML = `
        <div class="title-bar"><span>🎵 ${file.name}</span><button class="close-btn">X</button></div>
        <div style="padding:12px;font-family:Tahoma;font-size:12px;background:#1a1a2e;color:#eee;display:flex;flex-direction:column;gap:8px;height:calc(100% - 34px);">
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${file.name}</div>
            <audio controls style="width:100%;height:32px;" src="${file.data?.src}"></audio>
        </div>
        <div class="resize-handle right"></div><div class="resize-handle bottom"></div><div class="resize-handle corner"></div>`;
    desktop.appendChild(win);
    win.querySelector('.close-btn').onclick = () => win.remove();
    win.addEventListener('mousedown', () => win.style.zIndex = ++zIndexCounter);
    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);
}

window.openImageViewer = function(file) {
    const winId = `img-viewer-${file.id}`;
    const existing = document.getElementById(winId);
    if (existing) { existing.style.zIndex = ++zIndexCounter; return; }
    const win = document.createElement('div');
    win.className = 'window'; win.id = winId; win.style.zIndex = ++zIndexCounter;
    win.style.top = '60px'; win.style.left = '80px'; win.style.width = '540px'; win.style.height = '420px';
    win.innerHTML = `
        <div class="title-bar"><span>🖼️ ${file.name}</span><button class="close-btn">X</button></div>
        <div style="width:100%;height:calc(100% - 62px);overflow:auto;background:#1a1a1a;display:flex;align-items:center;justify-content:center;">
            <img src="${file.data?.src}" alt="${file.name}" style="max-width:100%;max-height:100%;object-fit:contain;display:block;transform-origin:center;transition:transform .15s;" id="${winId}-img">
        </div>
        <div style="background:#d4d0c8;border-top:1px solid #999;padding:3px 8px;font-size:11px;font-family:Tahoma;display:flex;justify-content:space-between;align-items:center;height:28px;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;" title="${file.name}">${file.name}</span>
            <div style="display:flex;gap:3px;">
                <button id="${winId}-zi">🔍+</button><button id="${winId}-zo">🔍−</button>
                <button id="${winId}-dl">💾 Baixar</button>
            </div>
        </div>
        <div class="resize-handle right"></div><div class="resize-handle bottom"></div><div class="resize-handle corner"></div>`;
    desktop.appendChild(win);
    let zoom = 1;
    const img = document.getElementById(`${winId}-img`);
    document.getElementById(`${winId}-zi`).onclick = () => { zoom = Math.min(5, +(zoom+0.25).toFixed(2)); img.style.transform = `scale(${zoom})`; };
    document.getElementById(`${winId}-zo`).onclick = () => { zoom = Math.max(0.1, +(zoom-0.25).toFixed(2)); img.style.transform = `scale(${zoom})`; };
    document.getElementById(`${winId}-dl`).onclick = () => { const a = document.createElement('a'); a.href = file.data?.src; a.download = file.name; a.click(); };
    win.querySelector('.close-btn').onclick = () => win.remove();
    win.addEventListener('mousedown', () => win.style.zIndex = ++zIndexCounter);
    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);
};
const openImageViewer = window.openImageViewer;

function openShortcut(file) {
    const url = file.data?.url; if (!url) return;
    const browserWin = document.getElementById('window-gonetgo');
    if (browserWin) { browserWin.style.zIndex = ++zIndexCounter; browserWin.querySelector('iframe')?.contentWindow?.postMessage({ type: 'navigate', url }, '*'); }
    else window.open(url, '_blank');
}
function createShortcut(name, url) {
    if (!url) return null;
    const existing = getFiles().find(f => f.type === 'shortcut' && f.data?.url === url);
    if (existing) return existing;
    const saved = addFile({ name: name || url, type: 'shortcut', size: 1, data: { url } });
    if (saved) {
        renderDesktopFiles();
        setTimeout(() => {
            const el = document.querySelector(`.icon[data-file-id="${saved.id}"]`);
            if (el) { el.style.transform = 'scale(1.3)'; setTimeout(() => el.style.transform = '', 300); }
        }, 50);
    }
    return saved;
}
window.createShortcut = createShortcut;

function openFishViewer(file) {
    const winId = `fish-viewer-${file.id}`;
    if (document.getElementById(winId)) { document.getElementById(winId).style.zIndex = ++zIndexCounter; return; }
    const raridade = file.data?.raridade ?? Math.random();
    const stars    = '⭐'.repeat(Math.ceil(raridade * 5));
    const rarLabel = raridade > 0.9 ? '🟣 Lendário' : raridade > 0.7 ? '🔵 Raro' : raridade > 0.4 ? '🟢 Incomum' : '⚪ Comum';
    const win = document.createElement('div');
    win.className = 'window'; win.id = winId; win.style.zIndex = ++zIndexCounter;
    win.style.top = '100px'; win.style.left = '160px'; win.style.width = '240px'; win.style.height = '200px';
    win.innerHTML = `
        <div class="title-bar"><span>🐟 ${file.name}</span><button class="close-btn">X</button></div>
        <div style="padding:14px;font-family:Tahoma;font-size:12px;background:#f0ede5;display:flex;flex-direction:column;gap:6px;">
            <div style="font-size:36px;text-align:center;">🐟</div>
            <div><b>Nome:</b> ${file.name}</div><div><b>Tamanho:</b> ${file.size} MB</div>
            <div><b>Raridade:</b> ${rarLabel}</div><div><b>Nota:</b> ${stars}</div>
            <div style="font-size:10px;color:#888;">Valor estimado: 💰 ${Math.ceil(raridade * 50)} moedas</div>
        </div>
        <div class="resize-handle right"></div><div class="resize-handle bottom"></div><div class="resize-handle corner"></div>`;
    desktop.appendChild(win);
    win.querySelector('.close-btn').onclick = () => win.remove();
    win.addEventListener('mousedown', () => win.style.zIndex = ++zIndexCounter);
    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);
}

function openDinheiroViewer(file) {
    const winId  = `din-viewer-${file.id}`;
    if (document.getElementById(winId)) { document.getElementById(winId).style.zIndex = ++zIndexCounter; return; }
    const valor  = file.data?.valor  ?? 0;
    const origem = file.data?.origem ?? '?';
    const qtd    = file.data?.qtd    ?? '?';
    const taxa   = file.data?.taxa   ?? '?';
    const win = document.createElement('div');
    win.className = 'window'; win.id = winId; win.style.zIndex = ++zIndexCounter;
    win.style.top = '100px'; win.style.left = '180px'; win.style.width = '260px'; win.style.height = '220px';
    win.innerHTML = `
        <div class="title-bar"><span>💰 ${file.name}</span><button class="close-btn">X</button></div>
        <div style="padding:16px 14px;font-family:Tahoma;font-size:12px;background:#fffbe6;height:calc(100% - 34px);display:flex;flex-direction:column;gap:7px;">
            <div style="font-size:42px;text-align:center;line-height:1;">💰</div>
            <div style="font-size:20px;font-weight:bold;text-align:center;color:#b8860b;">${valor} moedas</div>
            <hr style="border:none;border-top:1px solid #ddd;">
            <div style="font-size:11px;color:#555;">Origem: ${qtd}× ${TYPE_ICONS[origem] || '📄'} ${origem}</div>
            <div style="font-size:11px;color:#555;">Taxa: ${taxa} moedas/item</div>
            <div style="font-size:11px;color:#555;">Tamanho: ${file.size} MB</div>
        </div>
        <div class="resize-handle right"></div><div class="resize-handle bottom"></div><div class="resize-handle corner"></div>`;
    desktop.appendChild(win);
    win.querySelector('.close-btn').onclick = () => win.remove();
    win.addEventListener('mousedown', () => win.style.zIndex = ++zIndexCounter);
    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);
}

const BASE_RAM = 256, BASE_SPACE = 2048;
function applyUpgrades() {
    const u = getUpgrades();
    window.systemInfo.ram   = BASE_RAM   + (u.ram   || 0);
    window.systemInfo.space = BASE_SPACE + (u.space || 0);
}
window.applyUpgrades = applyUpgrades;

async function loadApps() {
    const res = await fetch('apps.json');
    appsList  = await res.json();
    renderAllIcons();   
    populateStartMenu();
}

function isUnlocked(app) {
    if (!Object.prototype.hasOwnProperty.call(app, 'unlocked')) return true;
    const p = getUnlocks();
    return Object.prototype.hasOwnProperty.call(p, app.id) ? p[app.id] : app.unlocked;
}
const isRemovable = app => Object.prototype.hasOwnProperty.call(app, 'unlocked');

function unlockApp(appId) {
    const u = getUnlocks(); u[appId] = true; saveUnlocks(u);
    renderAllIcons();   
    populateStartMenu();
}
window.unlockApp = unlockApp;

function lockApp(appId) { const u = getUnlocks(); u[appId] = false; saveUnlocks(u); }

function removeApp(appId) {
    const exe = getFiles().find(f => f.type === 'app' && f.data?.appId === appId);
    if (exe) { deleteFile(exe.id); } else { lockApp(appId); removeDesktopIcon(appId); }
    populateStartMenu();
}


function createDesktopIcons() { renderAllIcons(); }
function removeDesktopIcon(appId) { renderAllIcons(); } 

window.getUsedRAM = () => usedRAM;
window.getRAMInfo = () => `${usedRAM}/${window.systemInfo.ram} MB`;

function openAppById(appId) {
    const app = appsList.find(a => a.id === appId); if (!app) return;
    if (usedRAM + (app.ram || 0) > window.systemInfo.ram) {
        alert(`RAM insuficiente!\nUsando: ${usedRAM}/${window.systemInfo.ram}MB\nPrecisa: ${app.ram || 0}MB`); return;
    }
    if (!app.instantiable) {
        const existWin = document.getElementById(`window-${appId}`);
        if (existWin) {

            if (existWin.dataset.minimized === '1') {
                const taskItem = document.querySelector(`[data-win-id="window-${appId}"]`);
                restoreWindow(existWin, taskItem);
            } else {
                existWin.style.zIndex = ++zIndexCounter;
            }
            return;
        }
    }

    usedRAM += (app.ram || 0);
    return createWindow(app);
}


function minimizeWindow(win, taskItem) {
    win.style.display = 'none';
    win.dataset.minimized = '1';
    if (taskItem) {
        taskItem.classList.remove('active');
        taskItem.classList.add('minimized');
    }

    if (win.id.includes('go-music')) {
        _audioToastPinned = true;
        const lastInfo = win._lastAudioStatus;
        if (lastInfo) showAudioToast(lastInfo);
        else {
            ensureAudioToast();
            document.getElementById('audio-toast').classList.add('visible');
            document.getElementById('toast-track-name').textContent = 'GoMusic';
            document.getElementById('toast-status').textContent = '— minimizado';
        }
    }
    drawConnections();
}

function restoreWindow(win, taskItem) {
    win.style.display = '';
    win.dataset.minimized = '0';
    win.style.zIndex = ++zIndexCounter;
    if (taskItem) {
        taskItem.classList.add('active');
        taskItem.classList.remove('minimized');
    }

    if (win.id.includes('go-music')) {
        if (!_audioToastPinned) hideAudioToast();
        else hideAudioToast();
        _audioToastPinned = false;
    }
    drawConnections();
}

// ─────────────────────────────────────────────────────
// WINDOW
// ─────────────────────────────────────────────────────
function createWindow(app) {
    const winUid = app.instantiable ? `${app.id}-${Date.now()}` : app.id;
    const win    = document.createElement('div');
    win.className = 'window'; win.id = `window-${winUid}`; win.style.zIndex = ++zIndexCounter;
    win.dataset.minimized = '0';
    const offset = (document.querySelectorAll('.window').length * 22) + 50;

    const sizeKey    = app.size || 'medium';
    const sizePreset = WINDOW_SIZES[sizeKey];

    if (sizeKey === 'fullscreen' || !sizePreset) {
        const dh = desktop.offsetHeight || window.innerHeight - 42;
        win.style.top    = '0px';
        win.style.left   = '0px';
        win.style.width  = desktop.offsetWidth + 'px';
        win.style.height = dh + 'px';
    } else {
        win.style.top    = `${offset}px`;
        win.style.left   = `${offset}px`;
        win.style.width  = sizePreset.w + 'px';
        win.style.height = sizePreset.h + 'px';
    }

    const ports = app.ports || [];
    win.dataset.ports   = JSON.stringify(ports);
    win.dataset.appType = app.appType || '';

    const inPorts  = ports.filter(p => p.dir === 'in' || p.dir === 'storage');
    const outPorts = ports.filter(p => p.dir === 'out');

    const leftBtns  = inPorts.map(p =>
        `<button class="connect-btn connect-btn-left" data-port-dir="${p.dir}" data-port-fmt="${p.format}" title="${p.dir}:${p.format}">🔌</button>`
    ).join('');
    const rightBtns = outPorts.map(p =>
        `<button class="connect-btn connect-btn-right" data-port-dir="${p.dir}" data-port-fmt="${p.format}" title="${p.dir}:${p.format}">🔌</button>`
    ).join('');

    win.innerHTML = `
        <div class="title-bar" style="display:flex;align-items:center;padding:0 2px;">
            <div style="display:flex;gap:1px;margin-right:3px;">${leftBtns}</div>
            <span style="flex:1;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${app.nome}</span>
            <div style="display:flex;gap:1px;margin-left:3px;align-items:center;">
                ${rightBtns}
                <button class="minimize-btn" title="Minimizar" style="padding:6px 6px;font-size:11px;line-height:1;color:#fff;background-color:#808080;border:1px solid #ffffff;">-</button>
                <button class="fullscreen-btn" title="Maximizar" style="padding:0 6px;font-size:11px;color:#fff;background-color:#008000;border:1px solid #ffffff;">⬜</button>
                <button class="close-btn">X</button>
            </div>
        </div>
        <div class="window-content">
            <iframe src="${app.html}" style="width:100%;height:100%;border:none;"></iframe>
        </div>
        <div class="resize-handle right"></div>
        <div class="resize-handle bottom"></div>
        <div class="resize-handle corner"></div>`;

    desktop.appendChild(win);

    // ── FULLSCREEN  ──
    win.querySelector('.fullscreen-btn').addEventListener('click', () => {
        if (win.dataset.maximized === '1') {
            win.style.top    = win.dataset.prevTop;
            win.style.left   = win.dataset.prevLeft;
            win.style.width  = win.dataset.prevWidth;
            win.style.height = win.dataset.prevHeight;
            win.dataset.maximized = '0';
            win.querySelector('.fullscreen-btn').textContent = '⬜';
        } else {
            win.dataset.prevTop    = win.style.top;
            win.dataset.prevLeft   = win.style.left;
            win.dataset.prevWidth  = win.style.width;
            win.dataset.prevHeight = win.style.height;
            const dh = desktop.offsetHeight || window.innerHeight - 42;
            win.style.top    = '0px';
            win.style.left   = '0px';
            win.style.width  = desktop.offsetWidth + 'px';
            win.style.height = dh + 'px';
            win.dataset.maximized = '1';
            win.querySelector('.fullscreen-btn').textContent = '❐';
        }
        drawConnections();
    });

    // ── TASKBAR ITEM ──
    const taskItem = document.createElement('div');
    taskItem.className = 'taskbar-app active';
    taskItem.dataset.winId = `window-${winUid}`;
    taskItem.innerHTML = `<span class="taskbar-label">${app.nome}</span><button class="taskbar-close-btn" title="Fechar">✕</button>`;
    taskbarApps.appendChild(taskItem);


    taskItem.querySelector('.taskbar-label').onclick = () => {
        if (win.dataset.minimized === '1') {
            restoreWindow(win, taskItem);
        } else {
       
            if (parseInt(win.style.zIndex) >= zIndexCounter) {
                minimizeWindow(win, taskItem);
            } else {
                win.style.zIndex = ++zIndexCounter;
                taskItem.classList.add('active');
            }
        }
    };
    taskItem.querySelector('.taskbar-close-btn').onclick = e => { e.stopPropagation(); closeWindow(win, app, taskItem); };

    // ── MINIMIZE BUTTON ──
    win.querySelector('.minimize-btn').addEventListener('click', () => minimizeWindow(win, taskItem));

    win.querySelectorAll('.connect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const port = { dir: btn.dataset.portDir, format: btn.dataset.portFmt };
            if (!pendingConnection) {
                pendingConnection = { win, port };
                btn.style.background = 'yellow';
            } else {
                tryConnect(pendingConnection, win, port);
                pendingConnection = null;
                document.querySelectorAll('.connect-btn').forEach(b => b.style.background = '');
            }
        });
    });

    win.querySelector('.close-btn').onclick = () => closeWindow(win, app, taskItem);
    win.addEventListener('mousedown', () => win.style.zIndex = ++zIndexCounter);
    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);
    return win;
}

function closeWindow(win, app, taskItem) {
    usedRAM = Math.max(0, usedRAM - (app.ram || 0));
    connections.filter(c => c.from === win || c.to === win).forEach(c => { if (c.fuelInterval) clearInterval(c.fuelInterval); });
    connections = connections.filter(c => c.from !== win && c.to !== win);
    drawConnections();
    if (!app.instantiable) openApps.delete(app.id);
    if (win.id.includes('go-music')) hideAudioToast();
    taskItem.remove(); win.remove();
}

function tryConnect(pending, targetWin, targetPort) {
    if (pending.win === targetWin) return;
    const aPort = pending.port;
    const bPort = targetPort || { dir: 'in', format: 'any' };

    const aIsOut = aPort.dir === 'out' || aPort.dir === 'storage';
    const bIsIn  = bPort.dir === 'in'  || bPort.dir === 'storage';
    const aIsIn  = aPort.dir === 'in'  || aPort.dir === 'storage';
    const bIsOut = bPort.dir === 'out' || bPort.dir === 'storage';

    if (!((aIsOut && bIsIn) || (aIsIn && bIsOut))) { alert('Precisa conectar saída ↔ entrada'); return; }

    const fmtA = aPort.format, fmtB = bPort.format;
    if (fmtA !== 'any' && fmtB !== 'any' && fmtA !== fmtB) { alert(`Formato incompatível: ${fmtA} ↔ ${fmtB}`); return; }

    const existIdx = connections.findIndex(c =>
        (c.from === pending.win && c.to === targetWin) || (c.from === targetWin && c.to === pending.win)
    );
    if (existIdx !== -1) {
        const removed = connections.splice(existIdx, 1)[0];
        if (removed.fuelInterval) clearInterval(removed.fuelInterval);
        drawConnections(); return;
    }

    const from     = aIsOut ? pending.win : targetWin;
    const to       = aIsOut ? targetWin   : pending.win;
    const fromPort = aIsOut ? aPort       : bPort;
    const toPort   = aIsOut ? bPort       : aPort;
    const conn     = { from, to, fromPort, toPort };

    if (fromPort.dir === 'storage') {
        conn.fuelInterval = setInterval(() => storageFuelTick(from, to, toPort.format), 3000);
    }

    connections.push(conn);
    drawConnections();
}

// ── AUDIO FILE IMPORT ──
function ImportAudioFile(file) {
    const sizeMB = Math.max(1, Math.round(file.size / 1024 / 1024));
    const reader = new FileReader();
    reader.onload = ev => {
        const saved = addFile({
            name: file.name,
            type: 'audio',
            size: sizeMB,
            data: { src: ev.target.result }
        });
        if (saved) renderDesktopFiles();
    };
    reader.readAsDataURL(file);
}

function routeResourceToWindow(resource, targetWin) {
    if (!targetWin) {
        const s = addFile(resource); if (s) renderDesktopFiles(); return;
    }

    if (targetWin.id.startsWith('window-folder-')) {
        const fid    = parseInt(targetWin.id.replace('window-folder-', ''));
        const saved  = addFile(resource); if (!saved) return;
        const files  = getFiles();
        const folder = files.find(f => f.id === fid);
        if (folder) {
            if (!folder.data.children) folder.data.children = [];
            folder.data.children.push(saved.id);
            saveFiles(files); renderDesktopFiles(); targetWin.refreshFolder?.();
        }
        return;
    }

    targetWin.querySelector('iframe')?.contentWindow?.postMessage({ type: 'resource-received', resource }, '*');

    if (targetWin.dataset.appType === 'processor') return;

    if (winHasStoragePort(targetWin)) {
        const s = addFile(resource); if (s) renderDesktopFiles();
    }
}

window.emitResource = function(appId, resource) {
    let sourceWin = document.getElementById(`window-${appId}`);

    if (!sourceWin && String(appId).startsWith('folder-')) {
        sourceWin = document.getElementById(`window-folder-${appId.replace('folder-', '')}`);
    }
    if (!sourceWin) {
        for (const w of document.querySelectorAll('.window')) {
            if (w.id.startsWith(`window-${appId}-`)) { sourceWin = w; break; }
        }
    }
    if (!sourceWin) return false;

    const conn = connections.find(c => c.from === sourceWin);
    if (!conn) { alert('Nenhuma conexão encontrada!'); return false; }

    routeResourceToWindow(resource, conn.to);
    return true;
};

function storageFuelTick(storageWin, targetWin, fmt) {
    if (!document.body.contains(storageWin) || !document.body.contains(targetWin)) return;
    const allFiles = getFiles();
    let candidates = [];
    if (storageWin.id.startsWith('window-folder-')) {
        const folderId = parseInt(storageWin.id.replace('window-folder-', ''));
        const folder   = allFiles.find(f => f.id === folderId);
        if (folder?.data?.children?.length) {
            folder.data.children.forEach(cid => {
                const child = allFiles.find(f => f.id === cid);
                if (child && child.type !== 'app' && child.type !== 'folder' &&
                    (fmt === 'any' || child.type === fmt)) candidates.push(child);
            });
        }
    } else {
        const childIds = new Set();
        allFiles.forEach(f => { if (f.type === 'folder' && Array.isArray(f.data?.children)) f.data.children.forEach(id => childIds.add(id)); });
        candidates = allFiles.filter(f => !childIds.has(f.id) && f.type !== 'folder' && f.type !== 'app' && (fmt === 'any' || f.type === fmt));
    }
    if (!candidates.length) return;
    const file     = candidates[0];
    const resource = { name: file.name, type: file.type, size: file.size, data: { ...(file.data || {}) } };
    routeResourceToWindow(resource, targetWin);
    deleteFile(file.id);
}

window.pescar = appId => window.emitResource(appId, {
    name: 'Peixe_' + Math.floor(Math.random() * 100),
    type: 'fish',
    size: Math.floor(Math.random() * 100) + 10,
    data: { raridade: Math.random() },
});

function createNotepadFile() {
    const saved = addFile({ name: 'Novo.txt', type: 'text', size: 1, data: { content: '' } });
    if (saved) renderDesktopFiles();
}

function openNotepad(fileId) {
    const files = getFiles(); const file = files.find(f => f.id === fileId); if (!file) return;
    const win = document.createElement('div');
    win.className = 'window'; win.style.zIndex = ++zIndexCounter;
    win.style.top = '120px'; win.style.left = '150px'; win.style.width = '320px'; win.style.height = '220px';
    win.innerHTML = `
        <div class="title-bar"><span>📝 ${file.name}</span><button class="close-btn">X</button></div>
        <textarea class="notepad-area" style="width:100%;height:calc(100% - 34px);resize:none;box-sizing:border-box;padding:4px;">${file.data?.content || ''}</textarea>
        <div class="resize-handle right"></div><div class="resize-handle bottom"></div><div class="resize-handle corner"></div>`;
    desktop.appendChild(win);
    const ta = win.querySelector('.notepad-area');
    ta.addEventListener('mousedown', e => e.stopPropagation());
    ta.addEventListener('input', () => { file.data.content = ta.value; saveFiles(files); });
    win.querySelector('.close-btn').onclick = () => win.remove();
    win.addEventListener('mousedown', () => win.style.zIndex = ++zIndexCounter);
    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);
}

function createFolder() {
    const nome = prompt('Nome da pasta:', 'Nova Pasta'); if (!nome) return;
    const saved = addFile({ name: nome, type: 'folder', size: 1, data: { children: [] } });
    if (saved) renderDesktopFiles();
}

function emitFromFolder(folderWin, targetWin, fmt = 'any') {
    const folderId = parseInt(folderWin.id.replace('window-folder-', ''));
    const files = getFiles();
    const folder = files.find(f => f.id === folderId);
    if (!folder?.data?.children?.length) return;
    const candidates = folder.data.children
        .map(id => files.find(f => f.id === id))
        .filter(f => f && f.type !== 'folder' && (fmt === 'any' || f.type === fmt));
    if (!candidates.length) return;
    const file = candidates[0];
    const resource = { name: file.name, type: file.type, size: file.size, data: { ...(file.data || {}) } };
    routeResourceToWindow(resource, targetWin);
    deleteFile(file.id);
}

function openFolder(fileId) {
    const existing = document.getElementById(`window-folder-${fileId}`);
    if (existing) { existing.style.zIndex = ++zIndexCounter; return; }
    const win = document.createElement('div');
    win.className = 'window'; win.id = `window-folder-${fileId}`; win.style.zIndex = ++zIndexCounter;
    win.dataset.ports = JSON.stringify([
        { dir: 'in', format: 'any' },
        { dir: 'out', format: 'any' },
        { dir: 'storage', format: 'any' }
    ]);
    win.dataset.minimized = '0';
    win.style.top = '100px'; win.style.left = '140px'; win.style.width = '420px'; win.style.height = '320px';
    win.innerHTML = `
        <div class="title-bar" style="display:flex;align-items:center;padding:0 2px;">
            <div style="display:flex;gap:1px;">
                <button class="connect-btn connect-btn-left" data-port-dir="in" data-port-fmt="any" title="in:any">🔌</button>
                <button class="connect-btn connect-btn-left" data-port-dir="storage" data-port-fmt="any" title="storage:any">📦</button>
            </div>
            <span id="folder-title-${fileId}" style="flex:1;text-align:center;">📁 Pasta</span>
            <div style="display:flex;gap:1px;">
                <button class="connect-btn connect-btn-right" data-port-dir="out" data-port-fmt="any" title="out:any">🔌</button>
                <button class="minimize-btn" title="Minimizar" style="padding:0 5px;font-size:11px;background-color:#808080;color:#fff;border:1px solid #666;">-</button>
                <button class="close-btn">X</button>
            </div>
        </div>
        <div style="padding:5px 6px;background:#d4d0c8;border-bottom:1px solid #999;display:flex;gap:6px;align-items:center;">
            <button id="btn-add-folder-${fileId}">➕ Adicionar</button>
            <span id="folder-info-${fileId}" style="font-size:11px;color:#555;"></span>
            <span style="font-size:10px;color:#888;margin-left:auto;">↙ Arraste arquivos aqui</span>
        </div>
        <div id="folder-content-${fileId}" style="display:flex;flex-wrap:wrap;gap:8px;padding:10px;height:calc(100% - 70px);overflow-y:auto;background:#fff;align-content:flex-start;transition:background 0.1s;"></div>
        <div class="resize-handle right"></div><div class="resize-handle bottom"></div><div class="resize-handle corner"></div>`;
    desktop.appendChild(win);

    // Folder taskbar item
    const taskItem = document.createElement('div');
    taskItem.className = 'taskbar-app active';
    taskItem.dataset.winId = `window-folder-${fileId}`;
    taskItem.innerHTML = `<span class="taskbar-label">📁 Pasta</span><button class="taskbar-close-btn" title="Fechar">✕</button>`;
    taskbarApps.appendChild(taskItem);

    taskItem.querySelector('.taskbar-label').onclick = () => {
        if (win.dataset.minimized === '1') restoreWindow(win, taskItem);
        else if (parseInt(win.style.zIndex) >= zIndexCounter) minimizeWindow(win, taskItem);
        else win.style.zIndex = ++zIndexCounter;
    };
    taskItem.querySelector('.taskbar-close-btn').onclick = e => {
        e.stopPropagation();
        connections.filter(c => c.from === win || c.to === win).forEach(c => { if (c.fuelInterval) clearInterval(c.fuelInterval); });
        connections = connections.filter(c => c.from !== win && c.to !== win);
        drawConnections(); taskItem.remove(); win.remove();
    };

    win.querySelector('.minimize-btn').addEventListener('click', () => minimizeWindow(win, taskItem));

    const content = document.getElementById(`folder-content-${fileId}`);
    content.addEventListener('dragover',  e => { e.preventDefault(); content.style.background = '#d8ecff'; });
    content.addEventListener('dragleave', () => { content.style.background = '#fff'; });
    content.addEventListener('drop', e => {
        e.preventDefault(); content.style.background = '#fff';
        const vfsId = e.dataTransfer.getData('vfs-file-id');
        if (vfsId) moveFileBetween(parseInt(vfsId), fileId);
        const realImages = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
        realImages.forEach(f => {
            const sizeMB = Math.max(1, Math.round(f.size / 1024 / 1024));
            const reader = new FileReader();
            reader.onload = ev => {
                const saved = addFile({ name: f.name, type: 'image', size: sizeMB, data: { src: ev.target.result } });
                if (!saved) return;
                const files3 = getFiles(); const folder3 = files3.find(x => x.id === fileId);
                if (folder3) { folder3.data.children.push(saved.id); saveFiles(files3); }
                renderDesktopFiles(); win.refreshFolder?.();
            };
            reader.readAsDataURL(f);
        });
    });

    win.querySelector('.close-btn').onclick = () => {
        connections.filter(c => c.from === win || c.to === win).forEach(c => { if (c.fuelInterval) clearInterval(c.fuelInterval); });
        connections = connections.filter(c => c.from !== win && c.to !== win);
        drawConnections(); taskItem.remove(); win.remove();
    };

    win.querySelectorAll('.connect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const port = { dir: btn.dataset.portDir, format: btn.dataset.portFmt };
            if (!pendingConnection) {
                pendingConnection = { win, port };
                btn.style.background = 'yellow';
            } else {
                tryConnect(pendingConnection, win, port);
                pendingConnection = null;
                document.querySelectorAll('.connect-btn').forEach(b => b.style.background = '');
            }
        });
    });

    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);

    function refreshFolder() {
        const allFiles = getFiles();
        const folder   = allFiles.find(f => f.id === fileId);
        if (!folder) { taskItem.remove(); win.remove(); return; }
        document.getElementById(`folder-title-${fileId}`).innerText = `📁 ${folder.name}`;
        taskItem.querySelector('.taskbar-label').textContent = `📁 ${folder.name}`;
        const children = folder.data?.children || [];
        document.getElementById(`folder-info-${fileId}`).innerText = `${children.length} item(s)`;
        content.innerHTML = '';
        if (!children.length) { content.innerHTML = '<span style="color:#aaa;font-size:12px;padding:8px;">Pasta vazia</span>'; return; }
        children.forEach(childId => {
            const child   = allFiles.find(f => f.id === childId); if (!child) return;
            const typeDef = DESKTOP_FILE_TYPES[child.type];
            const ico     = TYPE_ICONS[child.type] || '📄';
            const item    = document.createElement('div');
            item.style.cssText = `text-align:center;width:68px;cursor:pointer;font-size:11px;word-break:break-word;padding:4px 2px;border-radius:3px;border:2px solid transparent;user-select:none;`;
            item.title = child.name;
            let iconHtml = `<div style="font-size:28px;line-height:1.2;">${ico}</div>`;
            if (child.type === 'image' && child.data?.src) {
                iconHtml = `<div style="width:48px;height:36px;margin:0 auto 3px;overflow:hidden;border:1px solid #ccc;border-radius:2px;"><img src="${child.data.src}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`;
            }
            item.innerHTML = `${iconHtml}<span>${child.name}</span>`;
            item.draggable = true;
            item.addEventListener('dragstart', e => { e.dataTransfer.setData('vfs-file-id', String(child.id)); e.dataTransfer.setData('source-folder', String(fileId)); item.style.opacity = '0.5'; });
            item.addEventListener('dragend', () => { item.style.opacity = '1'; });
            item.addEventListener('dblclick', () => typeDef?.onDblClick(child));
            item.addEventListener('contextmenu', e => {
                e.preventDefault();
                const del = confirm(`"${child.name}"\n\nOK = Excluir permanentemente\nCancelar = Remover só desta pasta`);
                if (del) { deleteFile(child.id); } else {
                    const fresh = getFiles(); const fp = fresh.find(f => f.id === fileId);
                    if (fp) { fp.data.children = fp.data.children.filter(id => id !== childId); saveFiles(fresh); renderDesktopFiles(); refreshFolder(); }
                }
            });
            content.appendChild(item);
        });
    }
    win.refreshFolder = refreshFolder;

    document.getElementById(`btn-add-folder-${fileId}`).onclick = () => {
        const allFiles = getFiles(); const folder = allFiles.find(f => f.id === fileId); if (!folder) return;
        const childSet = new Set(folder.data?.children || []);
        const addable  = allFiles.filter(f => f.id !== fileId && f.type !== 'app' && !childSet.has(f.id));
        if (!addable.length) { alert('Nenhum arquivo disponível.'); return; }
        const opts = addable.map((f, i) => `${i}: ${DESKTOP_FILE_TYPES[f.type]?.icon || '📄'} ${f.name}`).join('\n');
        const idx  = parseInt(prompt(`Escolha o arquivo:\n${opts}`));
        if (isNaN(idx) || !addable[idx]) return;
        folder.data.children.push(addable[idx].id);
        saveFiles(allFiles); renderDesktopFiles(); refreshFolder();
    };

    refreshFolder();
}

function baixar(id) {
    const app = appsList.find(a => a.id === id); if (!app) return;
    if (getFiles().some(f => f.type === 'app' && f.data?.appId === id)) { alert(`${app.nome} já está instalado!`); return; }
    const appSize = app.size || 20, used = window.getUsedSpace();
    if (used + appSize > window.systemInfo.space) { alert(`Sem espaço!\nUsado: ${used}/${window.systemInfo.space} MB\nPrecisa: ${appSize} MB`); return; }
    const saved = addFile({ name: app.nome + '.exe', type: 'app', size: appSize, data: { appId: id } });
    if (!saved) return;
    setTimeout(() => unlockApp(id), 250);
}
function baixarDireto(id) { unlockApp(id); alert('Download concluído! 🎉'); }

(function () {
    const item = document.createElement('div');
    item.id = 'menu-remove-app';
    item.className = contextMenu.querySelector('div')?.className || '';
    item.textContent = '🗑️ Remover App';
    item.style.display = 'none';
    item.onclick = () => {
        const appId = currentTargetIcon?.dataset.app;
        const app   = appsList.find(a => a.id === appId);
        if (app && confirm(`Remover "${app.nome}" do sistema?`)) removeApp(appId);
    };
    contextMenu.appendChild(item);
})();

function showContextMenu(x, y, targetType) {
    contextMenu.style.left = Math.min(x, window.innerWidth  - 164) + 'px';
    contextMenu.style.top  = Math.min(y, window.innerHeight - 184) + 'px';
    contextMenu.classList.add('visible');
    const isFile = targetType === 'file', isDesktop = targetType === 'desktop';
    const app    = targetType === 'app' ? appsList.find(a => a.id === currentTargetIcon?.dataset.app) : null;
    document.getElementById('menu-open')      .style.display = isDesktop ? 'none' : '';
    document.getElementById('menu-rename')    .style.display = isDesktop ? 'none' : '';
    document.getElementById('menu-delete')    .style.display = isFile ? '' : 'none';
    document.getElementById('menu-pin')       .style.display = app ? '' : 'none';
    document.getElementById('menu-remove-app').style.display = (app && isRemovable(app)) ? '' : 'none';
}

document.addEventListener('click', () => contextMenu.classList.remove('visible'));

document.getElementById('menu-open').onclick = () => {
    if (!currentTargetIcon) return;
    if (currentTargetIcon.dataset.fileId) {
        const file = getFiles().find(f => f.id === parseInt(currentTargetIcon.dataset.fileId));
        DESKTOP_FILE_TYPES[file?.type]?.onDblClick(file);
    } else openAppById(currentTargetIcon.dataset.app);
};
document.getElementById('menu-rename').onclick = () => {
    if (!currentTargetIcon) return;
    const span = currentTargetIcon.querySelector('span');
    const novo = prompt('Novo nome:', span.innerText); if (!novo) return;
    if (currentTargetIcon.dataset.fileId) {
        const files = getFiles(); const file = files.find(f => f.id === parseInt(currentTargetIcon.dataset.fileId));
        if (file) { file.name = novo; saveFiles(files); }
    }
    span.innerText = novo;
};
document.getElementById('menu-delete').onclick = () => {
    const selected = [...document.querySelectorAll('.icon.sel-highlight[data-file-id]')];
    if (selected.length > 1) {
        if (!confirm(`Excluir ${selected.length} arquivos permanentemente?`)) return;
        selected.forEach(el => deleteFile(parseInt(el.dataset.fileId))); return;
    }
    if (!currentTargetIcon?.dataset.fileId) return;
    if (!confirm('Excluir permanentemente?')) return;
    deleteFile(parseInt(currentTargetIcon.dataset.fileId));
};
document.getElementById('menu-pin').onclick = () => {
    if (!currentTargetIcon) return;
    const appId = currentTargetIcon.dataset.app;
    if (!appId || document.getElementById(`quick-${appId}`)) return;
    const quick = document.createElement('div');
    quick.className = 'quick-icon'; quick.id = `quick-${appId}`;
    quick.innerText = currentTargetIcon.querySelector('.icon-img').innerText;
    quick.onclick = () => openAppById(appId);
    document.getElementById('quick-launch').appendChild(quick);
};

document.getElementById('menu-unlock')          ?.addEventListener('click', () => unlockApp('pescaria'));
document.getElementById('menu-new-notepad')      ?.addEventListener('click', createNotepadFile);
document.getElementById('menu-new-folder')       ?.addEventListener('click', createFolder);
document.getElementById('menu-new-image')        ?.addEventListener('click', importImageFile);
document.getElementById('menu-new-art-project')  ?.addEventListener('click', createNewArt);

startBtn.onclick = e => { e.stopPropagation(); startMenu.classList.toggle('visible'); };
document.addEventListener('click', e => { if (!startMenu.contains(e.target) && e.target !== startBtn) startMenu.classList.remove('visible'); });

function populateStartMenu() {
    const list = document.getElementById('start-apps-list'); if (!list) return;
    list.innerHTML = '';
    appsList.filter(isUnlocked).forEach(app => {
        const item = document.createElement('div');
        item.className = 'menu-item-right';
        item.innerHTML = `${app.icone} ${app.nome}`;
        item.onclick = () => { openAppById(app.id); startMenu.classList.remove('visible'); };
        list.appendChild(item);
    });
}

if (changeWallpaperBtn && wallpaperInput) {
    changeWallpaperBtn.onclick = () => wallpaperInput.click();
    wallpaperInput.onchange = function() {
        const file = this.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = e => { document.body.style.backgroundImage = `url('${e.target.result}')`; const state = loadState(); state.wallpaper = e.target.result; saveState(state); };
        reader.readAsDataURL(file);
    };
}

document.getElementById('shutdown-btn')?.addEventListener('click', () => {
    if (confirm('Desligar?'))
        document.body.innerHTML = "<div style='background:black;color:white;height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;'>Pode desligar com segurança.</div>";
});

// ── MESSAGE HANDLER ──
window.addEventListener('message', event => {
    if (!event.data) return;
    const { type, appId, fileId, name, url } = event.data;

    // ── AUDIO STATUS (for toast) ──
    if (type === 'audio-status') {
        let srcWin = null;
        for (const w of document.querySelectorAll('.window')) {
            if (w.querySelector('iframe')?.contentWindow === event.source) { srcWin = w; break; }
        }
        if (srcWin) {
            srcWin._lastAudioStatus = event.data;
            if (srcWin.dataset.minimized === '1') {
                showAudioToast(event.data);
            } else if (!_audioToastPinned) {
                hideAudioToast();
            }
        }
    }

    if (type === 'download-app'    && appId)          baixar(appId);
    if (type === 'baixar-musga')                      ImportAudioFile(musga)
    if (type === 'open-app'        && appId)          openAppById(appId);
    if (type === 'delete-file'     && fileId != null) deleteFile(fileId);
    if (type === 'create-shortcut' && url)            createShortcut(name || url, url);
    if (type === 'create-file'     && event.data.fileType)
        window.createNewFile(event.data.fileType, event.data.name, event.data.data || {}, event.data.size || 1);

    if (type === 'emit-from-window') {
        let srcWin = null;
        for (const w of document.querySelectorAll('.window')) {
            if (w.querySelector('iframe')?.contentWindow === event.source) { srcWin = w; break; }
        }
        const res = event.data.resource;
        if (srcWin && res) {
            const outConn = connections.find(c => c.from === srcWin);
            if (outConn) routeResourceToWindow(res, outConn.to);
            else { const sv = addFile(res); if (sv) renderDesktopFiles(); }
        }
    }
    if (type === 'emit-resource' && appId) {
        window.emitResource(appId, event.data.resource);
    }
    if (type === 'navigate' && url) {
        const bw = document.getElementById('window-gonetgo');
        bw?.querySelector('iframe')?.contentWindow?.postMessage({ type: 'navigate', url }, '*');
    }
});

function initSessionTime() {
    const state = loadState();
    window.systemInfo.session_time = state.session_time || 0;
    setInterval(() => window.systemInfo.session_time++, 1000);
    setInterval(() => { const s = loadState(); s.session_time = window.systemInfo.session_time; saveState(s); }, 10000);
}

function applySavedState() {
    const state = loadState();
    if (state.wallpaper) document.body.style.backgroundImage = `url('${state.wallpaper}')`;
}

// ── CLICK SOUND ──
const clickAudio = new Audio('click.mp3');
clickAudio.volume = 0.4;

function playClickSound() {
    const sound = new Audio('click.mp3');
    sound.volume = 0.4;
    sound.playbackRate = 0.8 + Math.random() * 0.4;
    sound.play().catch(() => {});
}

// ── PAINT ──
function createNewArt() {
   
}

// ── COMMAND API ──
window.getOpenWindows = function() {
    return [...document.querySelectorAll('.window')].map(win => ({
        id: win.id,
        app: win.dataset.appType || win.id,
        element: win
    }));
};
window.OpenWindow = function(id) { openAppById(id); };
window.closeWindowById = function(id) {
    const win = document.getElementById(id);
    if (!win) return false;
    const closeBtn = win.querySelector('.close-btn');
    if (closeBtn) { closeBtn.click(); return true; }
    win.remove(); return true;
};

// ── FILE CREATOR ──
//============================
// HANDLER DE CRIAR ARQUIVO
//  ('text'|'folder'|'image'|'fish'|'dinheiro'|'shortcut')
//       nome  (string com o nome visível)
//       data  (objeto com campos extras, opcional)
//       size  (número em MB, padrão 1)
//============================
window.createNewFile = function(type, name, data = {}, size = 1) {
    if (!DESKTOP_FILE_TYPES[type]) {
        console.warn(`[createNewFile] Tipo desconhecido: "${type}". Válidos: ${Object.keys(DESKTOP_FILE_TYPES).join(', ')}`);
        return null;
    }
    if (!name || !name.trim()) { console.warn('[createNewFile] Nome inválido.'); return null; }
    if (type === 'text'   && data.content   === undefined) data.content   = '';
    if (type === 'folder' && !Array.isArray(data.children)) data.children = [];
    const saved = addFile({ name: name.trim(), type, size, data });
    if (saved) renderDesktopFiles();
    return saved;
};

document.addEventListener('click', (e) => {
    const clickable = e.target.closest('button, .menu-item-right');
    if (clickable) playClickSound();
});

// ── INIT ──
applySavedState();
applyUpgrades();
initSessionTime();
loadApps();