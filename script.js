const SAVE_KEY     = 'winxp-state';
const UNLOCK_KEY   = 'winxp-unlocks';
const FILE_KEY     = 'winxp-files';
const UPGRADES_KEY = 'winxp-upgrades';

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
//wiring stuff
const canvas = document.getElementById('cables');
const ctx    = canvas.getContext('2d');

const resizeCanvas = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const ICON_ROW_H   = 82;
const ICON_COL_W   = 92;
const ICON_TOP_PAD = 20;

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
    `;
    document.head.appendChild(s);
})();

function iconRows() {
    const h = (desktop.offsetHeight || window.innerHeight - 42) - ICON_TOP_PAD;
    return Math.max(1, Math.floor(h / ICON_ROW_H));
}
function iconPos(idx, leftStart) {
    const rows = iconRows();
    return { top: ICON_TOP_PAD + (idx % rows) * ICON_ROW_H, left: leftStart + Math.floor(idx / rows) * ICON_COL_W };
}

function drawConnections() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    connections.forEach(({ from, to }) => {
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
    dinheiro: { icon: '💰', onDblClick: file => openDinheiroViewer(file) }
    // art: { icon: '💰', onDblClick: file => openDinheiroViewer(file)
      // msc: { icon: '💰', onDblClick: file => openDinheiroViewer(file)
        // exe: { icon: '💰', onDblClick: file => openDinheiroViewer(file)
};
const TYPE_ICONS = { text:'📝', folder:'📁', fish:'🐟', app:'⚙️', image:'🖼️', shortcut:'⭐', dinheiro:'💰',art:'🎨' }; // Implementar formato .art depois que e adicionar handler pra importar projetos no GoPaint PIMP

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

window.renderDesktopFiles = function() {
    document.querySelectorAll('.icon.file').forEach(e => e.remove());
    const allFiles = getFiles();
    const childIds = new Set();
    allFiles.forEach(f => {
        if (f.type === 'folder' && Array.isArray(f.data?.children))
            f.data.children.forEach(id => childIds.add(id));
    });
    let col = 0;
    allFiles.forEach(file => {
        if (childIds.has(file.id)) return;
        const typeDef = DESKTOP_FILE_TYPES[file.type];
        if (!typeDef) return;
        const icon          = document.createElement('div');
        icon.className      = 'icon file';
        icon.dataset.fileId = file.id;
        const fp = iconPos(col, 120);
        icon.style.top  = fp.top  + 'px';
        icon.style.left = fp.left + 'px';
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
        col++;
    });
};
const renderDesktopFiles = window.renderDesktopFiles;

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
//Blue Square forgor name FIX BUG WHERE it demands at least one app or holding ctrl to drag PIMP
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
    const realImages = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (realImages.length) { realImages.forEach(importRealImage); return; }
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
function importImageFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.onchange = e => [...e.target.files].forEach(importRealImage);
    input.click();
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

function openFishViewer(file) {  //Adicionar BackDoor no outro site dps pra fazer crossover  PIMP
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

function openDinheiroViewer(file) { // criar handler dps PIMP
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
    createDesktopIcons();
    renderDesktopFiles();
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
    if (!document.querySelector(`.icon[data-app="${appId}"]`)) {
        const app = appsList.find(a => a.id === appId);
        if (app) desktop.appendChild(buildAppIcon(app));
    }
    populateStartMenu();
}
window.unlockApp = unlockApp;

function lockApp(appId) { const u = getUnlocks(); u[appId] = false; saveUnlocks(u); }

function removeApp(appId) {
    const exe = getFiles().find(f => f.type === 'app' && f.data?.appId === appId);
    if (exe) { deleteFile(exe.id); } else { lockApp(appId); removeDesktopIcon(appId); }
    populateStartMenu();
}

function createDesktopIcons() {
    document.querySelectorAll('.icon[data-app]').forEach(e => e.remove());
    let idx = 0;
    appsList.forEach(app => { if (isUnlocked(app)) desktop.appendChild(buildAppIcon(app, idx++)); });
}

function buildAppIcon(app, index = 0) {
    const icon = document.createElement('div');
    icon.className = 'icon'; icon.dataset.app = app.id;
    const ap = iconPos(index, 20);
    icon.style.top = ap.top + 'px'; icon.style.left = ap.left + 'px';
    icon.innerHTML = `<div class="icon-img">${app.icone}</div><span>${app.nome}</span>`;
    makeDraggable(icon);
    icon.addEventListener('dblclick', () => openAppById(app.id));
    icon.addEventListener('click', e => { if (e.ctrlKey) { e.stopPropagation(); icon.classList.toggle('sel-highlight'); } });
    icon.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); currentTargetIcon = icon; showContextMenu(e.pageX, e.pageY, 'app'); });
    return icon;
}
function removeDesktopIcon(appId) { document.querySelector(`.icon[data-app="${appId}"]`)?.remove(); }

window.getUsedRAM = () => usedRAM;
window.getRAMInfo = () => `${usedRAM}/${window.systemInfo.ram} MB`;

function openAppById(appId) { //FOPEN
    const app = appsList.find(a => a.id === appId); if (!app) return;
    if (usedRAM + (app.ram || 0) > window.systemInfo.ram) {
        alert(`RAM insuficiente!\nUsando: ${usedRAM}/${window.systemInfo.ram}MB\nPrecisa: ${app.ram || 0}MB`); return;
    }
    if (!app.instantiable) {
        if (openApps.has(appId)) { document.getElementById(`window-${appId}`)?.style.setProperty('z-index', ++zIndexCounter); return; }
        openApps.add(appId);
    }
    
    usedRAM += (app.ram || 0);
    return createWindow(app);
}
//==================
// WINDOW
//+===================
function createWindow(app) { // FWINDOW COLOCAR ATRIBUTO SIZE DPS QUE EU ESQUECI AAA, E GERAR A BOTAO FULLSCREEN PIMP 
    const winUid = app.instantiable ? `${app.id}-${Date.now()}` : app.id;
    const win    = document.createElement('div');
    win.className = 'window'; win.id = `window-${winUid}`; win.style.zIndex = ++zIndexCounter;
    const offset = (document.querySelectorAll('.window').length * 22) + 50;
    win.style.top = `${offset}px`; win.style.left = `${offset}px`;

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
            <div style="display:flex;gap:1px;margin-left:3px;align-items:center;">${rightBtns}<button class="close-btn">X</button></div>
        </div>
        <div class="window-content">
            <iframe src="${app.html}" style="width:100%;height:100%;border:none;"></iframe>
        </div>
        <div class="resize-handle right"></div>
        <div class="resize-handle bottom"></div>
        <div class="resize-handle corner"></div>`;

    desktop.appendChild(win);

    const taskItem = document.createElement('div');
    taskItem.className = 'taskbar-app active';
    taskItem.innerHTML = `<span class="taskbar-label">${app.nome}</span><button class="taskbar-close-btn" title="Fechar">✕</button>`;
    taskbarApps.appendChild(taskItem);
    taskItem.querySelector('.taskbar-label').onclick     = () => win.style.zIndex = ++zIndexCounter;
    taskItem.querySelector('.taskbar-close-btn').onclick = e => { e.stopPropagation(); closeWindow(win, app, taskItem); };

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
    taskItem.remove(); win.remove();
}

function tryConnect(pending, targetWin, targetPort) {
    if (pending.win === targetWin) return;
    const aPort = pending.port;
    const bPort = targetPort || { dir: 'in', format: 'any' };

    const aIsOut = aPort.dir === 'out';
    const bIsIn  = bPort.dir === 'in' || bPort.dir === 'storage';
    const aIsIn  = aPort.dir === 'in' || aPort.dir === 'storage';
    const bIsOut = bPort.dir === 'out';

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

    if (fromPort.dir === 'storage' || toPort.dir === 'storage') {
        const storageWin = fromPort.dir === 'storage' ? from : to;
        const otherWin   = storageWin === from ? to : from;
        const fmt        = (otherWin === to ? toPort : fromPort).format;
        conn.fuelInterval = setInterval(() => storageFuelTick(storageWin, otherWin, fmt), 3000);
    }
    

    connections.push(conn);
    drawConnections();
}

function storageFuelTick(storageWin, targetWin, fmt) { // FAUTO ROUTE 
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

function routeResourceToWindow(resource, targetWin) { // FSEND RESOURCE
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

    // FOLDER
    if (!sourceWin && String(appId).startsWith('folder-')) {
        sourceWin = document.getElementById(`window-folder-${appId.replace('folder-','')}`);
    }
    if (!sourceWin) {
        for (const w of document.querySelectorAll('.window')) {
            if (w.id.startsWith(`window-${appId}-`)) { sourceWin = w; break; }
        }
    }
    if (!sourceWin) return false;

    const conn = connections.find(c => c.from === sourceWin);
    if (!conn) { alert('Nenhuma conexão encontrada!'); return false; }
    const targetWin = conn.to;

    routeResourceToWindow(resource, targetWin);
    return true;
};

window.pescar = appId => window.emitResource(appId, {
    name: 'Peixe_' + Math.floor(Math.random() * 100),
    type: 'fish',
    size: Math.floor(Math.random() * 100) + 10,
    data: { raridade: Math.random() },
});

function createNotepadFile() { // PLACEHOLDER GERAR HANDLER DE AQUIVO DPS PIMP 
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

    const resource = {
        name: file.name,
        type: file.type,
        size: file.size,
        data: { ...(file.data || {}) }
    };

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
        drawConnections(); win.remove();
    };

    win.querySelectorAll('.connect-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const port = {
            dir: btn.dataset.portDir,
            format: btn.dataset.portFmt
        };

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

    function refreshFolder() { //FREFRESH FOLDER
        const allFiles = getFiles();
        const folder   = allFiles.find(f => f.id === fileId);
        if (!folder) { win.remove(); return; }
        document.getElementById(`folder-title-${fileId}`).innerText = `📁 ${folder.name}`;
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

function baixar(id) { // FDOWNLOAD
    const app = appsList.find(a => a.id === id); if (!app) return;
    if (getFiles().some(f => f.type === 'app' && f.data?.appId === id)) { alert(`${app.nome} já está instalado!`); return; }
    const appSize = app.size || 20, used = window.getUsedSpace();
    if (used + appSize > window.systemInfo.space) { alert(`Sem espaço!\nUsado: ${used}/${window.systemInfo.space} MB\nPrecisa: ${appSize} MB`); return; }
    const saved = addFile({ name: app.nome + '.exe', type: 'app', size: appSize, data: { appId: id } });
    if (!saved) return;
    unlockApp(id); alert('Download concluído! 🎉');
    setTimeout(() => openAppById(id), 250);
}
function baixarDireto(id) { unlockApp(id); alert('Download concluído! 🎉'); } //AUXILIAR DOWNLOAD SEM RENDER

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

document.getElementById('menu-unlock')     ?.addEventListener('click', () => unlockApp('pescaria'));
document.getElementById('menu-new-notepad') ?.addEventListener('click', createNotepadFile);
document.getElementById('menu-new-folder')  ?.addEventListener('click', createFolder);
document.getElementById('menu-new-image')   ?.addEventListener('click', importImageFile); //REMOVER PIMP 
document.getElementById('menu-new-art-project')  ?.addEventListener('click', createNewArt); //implementar arquivo formato ".art" PIMP 

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

window.addEventListener('message', event => {
    if (!event.data) return;
    const { type, appId, fileId, name, url } = event.data;
    if (type === 'download-app'    && appId)          baixar(appId);
    if (type === 'open-app'        && appId)          openAppById(appId);
    if (type === 'delete-file'     && fileId != null) deleteFile(fileId);
    if (type === 'create-shortcut' && url)            createShortcut(name || url, url);
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
//===========================
// PAINT STUFF
//========================
function createNewArt() { 
    
}

//set "favorite folder" to save drawings on it >:V PIMP
//set folder new handler to see as a canvas diplay


//====================
//COMMAND API HANDLER  STUFF GOGOCOMPILER O MAI GAAAH
//==============

window.getOpenWindows = function() {
    return [...document.querySelectorAll('.window')].map(win => ({
        id: win.id,
        app: win.dataset.appType || win.id,
        element: win
    }));
};  
window.OpenWindow = function(id) {
    openAppById(id)
}
window.closeWindowById = function(id) {
    const win = document.getElementById(id);
    if (!win) return false;
    const closeBtn = win.querySelector('.close-btn');
    if (closeBtn) {
        closeBtn.click(); 
        return true;
    }
    win.remove();
    return true;
};
//====================
//Go Music
//==============


//============================
//HANDLERS PIMP handler de criar arquivo depois faz a função novo pra api >:V
//============================



//===========================
// INIT
//========================

// PIMP somar render de desktopicons a partir de uma unica array >:V    apps + files
applySavedState();
applyUpgrades();
initSessionTime();
loadApps();

