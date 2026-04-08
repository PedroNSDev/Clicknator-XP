// ================= ESTADO =================
const openApps = new Set();
let zIndexCounter = 10;
let appsList = [];

const desktop = document.getElementById('desktop');
const taskbarApps = document.getElementById('taskbar-apps');
const contextMenu = document.getElementById('context-menu');

const startBtn = document.getElementById('start-btn');
const startMenu = document.getElementById('start-menu');

const wallpaperInput = document.getElementById('wallpaper-input');
const changeWallpaperBtn = document.getElementById('change-wallpaper');

let currentTargetIcon = null;

// ================= CLOCK =================
function updateClock() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('clock').innerText = `${h}:${m}`;
}
setInterval(updateClock, 1000);
updateClock();

// ================= DRAG =================
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

            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        };

        if (element.classList.contains('window')) {
            element.style.zIndex = ++zIndexCounter;
        }
    };
}

// ================= LOAD APPS =================
async function loadApps() {
    const res = await fetch('apps.json');
    appsList = await res.json();

    createDesktopIcons();
    populateStartMenu();
}

// ================= ICONS =================
function createDesktopIcons() {
    desktop.innerHTML = '';

    appsList.forEach((app, i) => {
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

// ================= OPEN APP =================
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

// ================= WINDOW =================
function createWindow(app) {
    const win = document.createElement('div');
    win.className = 'window';
    win.id = `window-${app.id}`;
    win.style.zIndex = ++zIndexCounter;

    const offset = (openApps.size * 20) + 50;
    win.style.top = `${offset}px`;
    win.style.left = `${offset}px`;

        win.innerHTML = `
        <div class="title-bar">
            <span>${app.nome}</span>
            <button class="close-btn">X</button>
        </div>
        <div class="window-content">
            <iframe src="${app.html}" style="width:100%;height:100%;border:none;"></iframe>
        </div>

        <!-- Handles de resize -->
        <div class="resize-handle right"></div>
        <div class="resize-handle bottom"></div>
        <div class="resize-handle corner"></div>
    `;

    desktop.appendChild(win);

    makeDraggable(win, win.querySelector('.title-bar'));
    makeResizable(win);

    // TASKBAR
    const taskItem = document.createElement('div');
    taskItem.className = 'taskbar-app active';
    taskItem.innerText = app.nome;
    taskbarApps.appendChild(taskItem);

    taskItem.onclick = () => win.style.zIndex = ++zIndexCounter;

    // CLOSE
    win.querySelector('.close-btn').onclick = () => {
        win.remove();
        taskItem.remove();
        openApps.delete(app.id);
    };

    win.addEventListener('mousedown', () => {
        win.style.zIndex = ++zIndexCounter;
    });
}

// ================= CONTEXT MENU =================
document.addEventListener('click', () => {
    contextMenu.classList.remove('visible');
});

document.getElementById('menu-open').onclick = () => {
    if (currentTargetIcon) {
        openAppById(currentTargetIcon.dataset.app);
    }
};

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

// ================= START MENU =================
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

// ================= WALLPAPER =================
if (changeWallpaperBtn && wallpaperInput) {
    changeWallpaperBtn.onclick = () => wallpaperInput.click();

    wallpaperInput.onchange = function() {
        const file = this.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = e => {
            document.body.style.backgroundImage = `url('${e.target.result}')`;
        };
        reader.readAsDataURL(file);
    };
}

// ================= SHUTDOWN =================
const shutdownBtn = document.getElementById('shutdown-btn');
if (shutdownBtn) {
    shutdownBtn.onclick = () => {
        if (confirm("Desligar?")) {
            document.body.innerHTML =
                "<div style='background:black;color:white;height:100vh;display:flex;align-items:center;justify-content:center;'>Pode desligar com segurança.</div>";
        }
    };
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
// ================= INIT =================
loadApps();
