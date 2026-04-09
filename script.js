const openApps = new Set();
let zIndexCounter = 10;
let appsList = [];
let connections = [];
const SAVE_KEY = 'winxp-state';
const UNLOCK_KEY = 'winxp-unlocks';

function getUnlocks() {
    return JSON.parse(localStorage.getItem(UNLOCK_KEY)) || {};
}
function saveUnlocks(data) {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify(data));
}
function isUnlocked(app) {
    if (app.unlocked === undefined) return true;
    const unlocks = getUnlocks();
    if (unlocks.hasOwnProperty(app.id)) {
        return unlocks[app.id];
    }

    return app.unlocked;
}
function unlockApp(appId) {
    const unlocks = getUnlocks();
    unlocks[appId] = true;
    saveUnlocks(unlocks);

    createDesktopIcons();
}
window.unlockApp = unlockApp;
//VARIAVEIS DE CONTROLE 
let pendingConnection = null;

let systemInfo = {
    username: "",
    ram: 64,
    space: 2048,
    session_time: 0
};
window.systemInfo = {
    username: "",
    ram: 64,
    space: 2048,
    session_time: 0
};

function saveState(data) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function loadState() {
    const data = localStorage.getItem(SAVE_KEY);
    return data ? JSON.parse(data) : {};
}

const desktop = document.getElementById('desktop');
const taskbarApps = document.getElementById('taskbar-apps');
const contextMenu = document.getElementById('context-menu');

const startBtn = document.getElementById('start-btn');
const startMenu = document.getElementById('start-menu');

const wallpaperInput = document.getElementById('wallpaper-input');
const changeWallpaperBtn = document.getElementById('change-wallpaper');

let currentTargetIcon = null;
///FCANVAS
const canvas = document.getElementById('cables');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
function drawConnections() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    connections.forEach(conn => {
        const rect1 = conn.from.getBoundingClientRect();
        const rect2 = conn.to.getBoundingClientRect();

        const x1 = rect1.left + rect1.width;
        const y1 = rect1.top + rect1.height / 2;

        const x2 = rect2.left;
        const y2 = rect2.top + rect2.height / 2;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(
            x1 + 100, y1,
            x2 - 100, y2,
            x2, y2
        );

        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
////FClock
function updateClock() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('clock').innerText = `${h}:${m}`;
}
setInterval(updateClock, 1000);
updateClock();
//FDRAG
function makeDraggable(element, handleElement) {
    let pos1=0,pos2=0,pos3=0,pos4=0;
    const dragHandle = handleElement || element;

    dragHandle.onmousedown = (e) => {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;

        document.onmouseup = () => {
            document.onmouseup = null;
            document.onmousemove = null;
        };

        document.onmousemove = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            drawConnections();

            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        };

        if (element.classList.contains('window')) {
            element.style.zIndex = ++zIndexCounter;
        }
        if (element.classList.contains('window')) {
            drawConnections();
        }
    };
}

async function loadApps() {
    const res = await fetch('apps.json');
    appsList = await res.json();
    createDesktopIcons();
    populateStartMenu();
}
function createDesktopIcons() {
    desktop.innerHTML = '';

    appsList.forEach((app, i) => {

        // FILTRO DE UNLOCK
        if (!isUnlocked(app)) return;

        const icon = document.createElement('div');
        icon.className = 'icon';
        icon.dataset.app = app.id;

        icon.style.top = `${20 + i * 80}px`;
        icon.style.left = `20px`;

        icon.innerHTML = `
            <div class="icon-img">${app.icone}</div>
            <span>${app.nome}</span>
        `;

        makeDraggable(icon);

        icon.addEventListener('dblclick', () => openAppById(app.id));

        icon.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            currentTargetIcon = icon;

            contextMenu.style.left = `${e.pageX}px`;
            contextMenu.style.top = `${e.pageY}px`;
            contextMenu.classList.add('visible');
        });

        desktop.appendChild(icon);
    });
}

function openAppById(appId) {
    const app = appsList.find(a => a.id === appId);
    if (!app) return;

    if (openApps.has(appId)) {
        const existing = document.getElementById(`window-${appId}`);
        if (existing) existing.style.zIndex = ++zIndexCounter;
        return;
    }

    openApps.add(appId);
    createWindow(app);
}

function createWindow(app) {
    const win = document.createElement('div');
    win.className = 'window';
    win.id = `window-${app.id}`;
    win.style.zIndex = ++zIndexCounter;
    
    const offset = (openApps.size * 20) + 50;
    win.style.top = `${offset}px`;
    win.style.left = `${offset}px`;

    win.dataset.conn = app.conn || 'none';
    win.dataset.format = app.format || 'any';

    win.innerHTML = `
        <div class="title-bar">
            <span>${app.nome}</span>
            <div>
                <button class="connect-btn">🔌</button>
                <button class="close-btn">X</button>
            </div>
        </div>
        <div class="window-content">
            <iframe src="${app.html}" style="width:100%;height:100%;border:none;"></iframe>
        </div>
        <div class="resize-handle right"></div>
        <div class="resize-handle bottom"></div>
        <div class="resize-handle corner"></div>
    `;

    desktop.appendChild(win);

    const connectBtn = win.querySelector('.connect-btn');

    connectBtn.onclick = () => {
        if (!pendingConnection) {
            pendingConnection = {
                win: win,
                type: win.dataset.conn,
                format: win.dataset.format
            };
            connectBtn.style.background = 'yellow';
        } else {
            tryConnect(pendingConnection, win);
            pendingConnection = null;

            document.querySelectorAll('.connect-btn')
                .forEach(btn => btn.style.background = '');
        }
    };

    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);

    const taskItem = document.createElement('div');
    taskItem.className = 'taskbar-app active';
    taskItem.innerText = app.nome;
    taskbarApps.appendChild(taskItem);

    taskItem.onclick = () => win.style.zIndex = ++zIndexCounter;

    win.querySelector('.close-btn').onclick = () => {
    
        connections = connections.filter(conn => 
            conn.from !== win && conn.to !== win
        );

    drawConnections(); // redesenha sem elas :P

    win.remove();
    taskItem.remove();
    openApps.delete(app.id);
};

    win.addEventListener('mousedown', () => {
        win.style.zIndex = ++zIndexCounter;
    });
}


function makeResizable(win) {
    const right = win.querySelector('.resize-handle.right');
    const bottom = win.querySelector('.resize-handle.bottom');
    const corner = win.querySelector('.resize-handle.corner');

    const minWidth = 200;
    const minHeight = 150;

    function initResize(e, type) {
        e.preventDefault();

        const startX = e.clientX;
        const startY = e.clientY;

        const startWidth = win.offsetWidth;
        const startHeight = win.offsetHeight;

        function resize(e) {
            if (type === 'right' || type === 'corner') {
                let newWidth = startWidth + (e.clientX - startX);
                win.style.width = Math.max(minWidth, newWidth) + 'px';
            }

            if (type === 'bottom' || type === 'corner') {
                let newHeight = startHeight + (e.clientY - startY);
                win.style.height = Math.max(minHeight, newHeight) + 'px';
            }
        }

        function stop() {
            document.removeEventListener('mousemove', resize);
            document.removeEventListener('mouseup', stop);
        }

        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stop);
    }

    right.onmousedown = (e) => initResize(e, 'right');
    bottom.onmousedown = (e) => initResize(e, 'bottom');
    corner.onmousedown = (e) => initResize(e, 'corner');
}

document.addEventListener('click', () => {
    contextMenu.classList.remove('visible');
});

document.getElementById('menu-open').onclick = () => {
    if (currentTargetIcon) {
        openAppById(currentTargetIcon.dataset.app);
    }
};
document.getElementById('menu-new-notepad').onclick = createNotepadFile;
document.getElementById('menu-rename').onclick = () => {
    if (!currentTargetIcon) return;

    const span = currentTargetIcon.querySelector('span');
    const nome = prompt("Novo nome:", span.innerText);

    if (nome) span.innerText = nome;
};

document.getElementById('menu-pin').onclick = () => {
    if (!currentTargetIcon) return;

    const appId = currentTargetIcon.dataset.app;

    if (document.getElementById(`quick-${appId}`)) return;

    const quick = document.createElement('div');
    quick.className = 'quick-icon';
    quick.id = `quick-${appId}`;
    quick.innerText = currentTargetIcon.querySelector('.icon-img').innerText;

    quick.onclick = () => openAppById(appId);

    document.getElementById('quick-launch').appendChild(quick);
};

startBtn.onclick = (e) => {
    e.stopPropagation();
    startMenu.classList.toggle('visible');
};

document.addEventListener('click', (e) => {
    if (!startMenu.contains(e.target) && e.target !== startBtn) {
        startMenu.classList.remove('visible');
    }
});

function populateStartMenu() {
    const list = document.getElementById('start-apps-list');
    if (!list) return;

    list.innerHTML = '';

    appsList.forEach(app => {
        const item = document.createElement('div');
        item.className = 'menu-item-right';
        item.innerHTML = `${app.icone} ${app.nome}`;

        item.onclick = () => {
            openAppById(app.id);
            startMenu.classList.remove('visible');
        };

        list.appendChild(item);
    });
}

if (changeWallpaperBtn && wallpaperInput) {
    changeWallpaperBtn.onclick = () => wallpaperInput.click();

    wallpaperInput.onchange = function() {
        const file = this.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = e => {
    const img = e.target.result;

    document.body.style.backgroundImage = `url('${img}')`;

    const state = loadState();
    state.wallpaper = img;
    saveState(state);
};
        reader.readAsDataURL(file);
    };
}

const shutdownBtn = document.getElementById('shutdown-btn');
if (shutdownBtn) {
    shutdownBtn.onclick = () => {
        if (confirm("Desligar?")) {
            document.body.innerHTML =
                "<div style='background:black;color:white;height:100vh;display:flex;align-items:center;justify-content:center;'>Pode desligar com segurança.</div>";
        }
    };
}
function applySavedState() {
    const state = loadState();

    if (state.wallpaper) {
        document.body.style.backgroundImage = `url('${state.wallpaper}')`;
    }

}


window.addEventListener('message', (event) => {
    if (event.data.type === 'open-app') {
        openAppById(event.data.appId);
    }
});
/////FFILE
const FILE_KEY = 'winxp-files';
window.addEventListener('message', (event) => {

    if (event.data.type === 'create-file') {
        const success = addFile(event.data.file);

        if (!success) {
            alert('Inventário cheio!');
        }
    }

});
function getFiles() {
    return JSON.parse(localStorage.getItem(FILE_KEY)) || [];
}

function saveFiles(files) {
    localStorage.setItem(FILE_KEY, JSON.stringify(files));
}

function addFile(file) {
    const files = getFiles();

    if (files.length >= 10) {
        alert('Inventário cheio!');
        return false;
    }

    files.push({
        id: Date.now(),
        name: file.name,
        type: file.type,
        data: file.data || null
    });

    saveFiles(files);
    return true;
}

function deleteFile(id) {
    let files = getFiles();
    files = files.filter(f => f.id !== id);
    saveFiles(files);
}
////FCONECT
function removeConnectionsByWindow(win) {
    connections = connections.filter(conn =>
        conn.from !== win && conn.to !== win
    );

    drawConnections();
}
function tryConnect(a, targetWin) {
    const b = {
        win: targetWin,
        type: targetWin.dataset.conn,
        format: targetWin.dataset.format
    };

    if (a.win === b.win) return;

    if (a.type === b.type) {
        alert('Precisa conectar input com output');
        return;
    }

    if (a.type !== 'storage' && b.type !== 'storage') {
        if (a.format !== b.format) {
            alert('Formato incompatível');
            return;
        }
    }

    const existingIndex = connections.findIndex(c =>
        (c.from === a.win && c.to === b.win) ||
        (c.from === b.win && c.to === a.win)
    );

    if (existingIndex !== -1) {
    
        connections.splice(existingIndex, 1);
        drawConnections();
        return;
    }
    connections.push({
        from: a.type === 'output' ? a.win : b.win,
        to: a.type === 'output' ? b.win : a.win
    });

    drawConnections();
}
window.emitResource = function(appId, resource) {

    const sourceWin = document.getElementById(`window-${appId}`);
    if (!sourceWin) return;

    const conn = connections.find(c => c.from === sourceWin);

    if (!conn) {
        alert('Nenhuma conexão encontrada!');
        return false;
    }

    const targetWin = conn.to;
    const targetType = targetWin.dataset.conn;
    const targetFormat = targetWin.dataset.format;

    //FCHECK
    if (targetType !== 'storage' && targetType !== 'input') {
        alert('Destino inválido!');
        return false;
    }

    // FCHECK .FORMAT
    if (targetType !== 'storage' && targetFormat !== resource.type) {
        alert('Formato incompatível!');
        return false;
    }

    const success = addFile(resource);

    if (!success) {
        alert('Inventário cheio!');
        return false;
    }

    return true;
};
window.pescar = function(appId) {

    const peixe = {
        name: "Peixe_" + Math.floor(Math.random()*100),
        type: "fish",
        data: {
            raridade: Math.random()
        }
    };

    emitResource(appId, peixe);
};

function renderDesktopFiles() {
    // SWIPE NOS ICONES ANTIGOS
    document.querySelectorAll('.icon.file').forEach(e => e.remove());

    const files = getFiles();

    files.forEach((file, i) => {
        if (file.type !== 'text') return;

        const icon = document.createElement('div');
        icon.className = 'icon file';

        icon.style.top = `${20 + i * 80}px`;
        icon.style.left = `120px`;

        icon.innerHTML = `
            <div class="icon-img">📝</div>
            <span>${file.name}</span>
        `;

        makeDraggable(icon);

        icon.ondblclick = () => openNotepad(file.id);

        desktop.appendChild(icon);
    });
}
function openNotepad(fileId) {
    const files = getFiles();
    const file = files.find(f => f.id === fileId);
    if (!file) return;

    const win = document.createElement('div');
    win.className = 'window';
    win.style.zIndex = ++zIndexCounter;

    win.style.top = '120px';
    win.style.left = '150px';
    win.style.width = '300px';
    win.style.height = '200px';

    win.innerHTML = `
        <div class="title-bar">
            <span>${file.name}</span>
            <button class="close-btn">X</button>
        </div>
        <textarea class="notepad-area" 
            style="width:100%;height:calc(100% - 30px);resize:none;">
${file.data?.content || ''}
        </textarea>
    `;

    desktop.appendChild(win);

    const textarea = win.querySelector('.notepad-area');

   
    textarea.addEventListener('mousedown', e => e.stopPropagation());

    // AUTO SAVE
    textarea.addEventListener('input', () => {
        file.data.content = textarea.value;
        saveFiles(files);
    });

    win.querySelector('.close-btn').onclick = () => {
        win.remove();
    };

    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);
}
function createNotepadFile() {
    const success = addFile({
        name: "Novo.txt",
        type: "text",
        data: {
            content: ""
        }
    });

    if (success) {
        renderDesktopFiles();
    }
}
//INIT
loadApps();
applySavedState();
renderDesktopFiles(); 

