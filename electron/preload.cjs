const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApi', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  sharedInfo: () => ipcRenderer.invoke('shared:info'),
  applicationInfo: () => ipcRenderer.invoke('application:info'),
  updateState: () => ipcRenderer.invoke('updates:state'),
  configureUpdates: (settings) => ipcRenderer.invoke('updates:configure', settings),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  restartApplication: () => ipcRenderer.invoke('application:restart'),
  onUpdateState: (callback) => { const listener = (_event, state) => callback(state); ipcRenderer.on('updates:state-changed', listener); return () => ipcRenderer.removeListener('updates:state-changed', listener) },
  onUpdateError: (callback) => { const listener = (_event, message) => callback(message); ipcRenderer.on('updates:error', listener); return () => ipcRenderer.removeListener('updates:error', listener) },
  onDataChanged: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('data:changed', listener)
    return () => ipcRenderer.removeListener('data:changed', listener)
  },
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  saveAttachment: (payload) => ipcRenderer.invoke('attachment:save', payload),
  copyImage: (payload) => ipcRenderer.invoke('attachment:copy', payload),
  startImageDrag: (payload) => ipcRenderer.send('attachment:drag', payload),
  onImageDragError: (callback) => {
    const listener = (_event, message) => callback(message)
    ipcRenderer.on('attachment:drag-error', listener)
    return () => ipcRenderer.removeListener('attachment:drag-error', listener)
  },
  exportBackup: (payload) => ipcRenderer.invoke('backup:export', payload),
  exportQuestions: (payload) => ipcRenderer.invoke('questions:export', payload),
  discardImport: (importId) => ipcRenderer.invoke('backup:discard-import', importId),
  onBackupProgress: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('backup:progress', listener)
    return () => ipcRenderer.removeListener('backup:progress', listener)
  },
  importBackup: () => ipcRenderer.invoke('backup:import'),
  onImportProgress: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('backup:import-progress', listener)
    return () => ipcRenderer.removeListener('backup:import-progress', listener)
  },
  applyImport: (payload) => ipcRenderer.invoke('backup:apply', payload),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  onBeforeClose: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('window:before-close', listener)
    return () => ipcRenderer.removeListener('window:before-close', listener)
  },
  allowClose: () => ipcRenderer.send('window:allow-close'),
  cancelClose: () => ipcRenderer.send('window:cancel-close'),
})
