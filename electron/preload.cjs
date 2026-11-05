/**
 * Мост между веб-клиентом и Electron. Только явно разрешённые методы —
 * никакого прямого доступа к Node из страницы.
 */
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

function emit(fn) {
  for (const cb of listeners) {
    try {
      cb(fn);
    } catch { /* ignore */ }
  }
}

contextBridge.exposeInMainWorld('rautDesktop', {
  version: process.versions.electron,
  platform: process.platform,
  isDesktop: true,

  /** Информация о приложении: сервер, папка данных, версия. */
  info: () => ipcRenderer.invoke('raut:info'),

  /** Переключить адрес сервера (пустая строка — снова локальный). */
  setServerUrl: (url) => ipcRenderer.invoke('raut:set-server-url', url),

  openDataDir: () => ipcRenderer.invoke('raut:open-data-dir'),

  /** Состояние трея и бейджа: { unread } */
  setTrayState: (state) => {
    ipcRenderer.send('raut:unread', state?.unread || 0);
    ipcRenderer.invoke('raut:set-tray', state || {}).catch(() => {});
    ipcRenderer.invoke('raut:set-badge', state?.unread || 0).catch(() => {});
  },

  copy: (text) => ipcRenderer.invoke('raut:copy', text),

  notify: ({ title, body } = {}) => ipcRenderer.invoke('raut:notify', { title, body }),

  /** События из меню приложения. */
  on: (event, cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = {
      callback: (payload) => {
        if (event === 'context') cb(payload);
        if (event === 'open-settings') cb();
      },
    };
    const channel = event === 'context' ? 'raut:context' : 'raut:open-settings';
    const wrapped = (_e, payload) => handler.callback(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  subscribe: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  /** Горячие клавиши окна (используются веб-клиентом для подсказок). */
  platformShortcut: process.platform === 'darwin' ? 'Cmd' : 'Ctrl',
});
