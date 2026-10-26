import { useEffect, useState } from 'react'
import { Download, FolderOpen, Loader2, RotateCcw, Save } from 'lucide-react'

export default function UpdateSettings({ info, application, beforeRestart }) {
  const [source, setSource] = useState(''), [automatic, setAutomatic] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => { if (info) { setSource(info.source); setAutomatic(info.autoCheck) } }, [info?.source, info?.autoCheck])
  const operation = async action => { setBusy(true); setMessage(''); try { await action() } catch (error) { setMessage(error.message) } finally { setBusy(false) } }
  const processing = busy || ['checking', 'downloading', 'installing'].includes(info?.status)
  return <div className="update-settings">
    <h3>软件安装与更新</h3>
    <p>当前版本 {info?.version || application?.version || '…'} · {info?.installed ? '安装版' : '免安装 / 开发版'}</p>
    {!info?.installed && <p>安装一次安装版后，可在软件内检查、下载和安装后续更新。</p>}
    <label className="field"><span className="field-title">更新仓库或下载目录</span><input aria-label="更新仓库或下载目录" value={source} disabled={processing} onChange={event => setSource(event.target.value)} placeholder="用户名/仓库名，或 HTTPS 更新目录" /></label>
    <label className="update-automatic"><input type="checkbox" checked={automatic} disabled={processing} onChange={event => setAutomatic(event.target.checked)} />启动后检查新版本</label>
    <div className="update-actions">
      <button className="button" disabled={processing || !info} onClick={() => operation(() => window.desktopApi.configureUpdates({ source, autoCheck: automatic }))}><Save size={15} />保存更新设置</button>
      <button className="button" disabled={processing || !info?.installed || !info?.source} onClick={() => operation(() => window.desktopApi.checkUpdates())}>{info?.status === 'checking' ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}检查更新</button>
      {info?.status === 'available' && <button className="button primary" disabled={processing} onClick={() => operation(() => window.desktopApi.downloadUpdate())}><Download size={15} />下载 {info.availableVersion}</button>}
      {info?.status === 'downloaded' && <button className="button primary" disabled={processing} onClick={() => operation(async () => { await beforeRestart(); await window.desktopApi.installUpdate() })}><RotateCcw size={15} />保存并安装更新</button>}
    </div>
    {info?.status === 'downloading' && <progress aria-label="更新下载进度" max="100" value={info.progress?.percent || 0} />}
    <p className={`update-message ${info?.status === 'error' || message ? 'error' : ''}`} role="status">{message || info?.message || '正在读取更新设置…'}{info?.status === 'downloading' ? ` ${info.progress?.percent || 0}%` : ''}</p>
    {info?.releaseNotes && ['available', 'downloaded'].includes(info.status) && <details><summary>版本更新说明</summary><pre>{info.releaseNotes}</pre></details>}
    {application?.mode === 'installed' && <div className="installed-library"><h3>使用原有题库</h3><p>当前题库：{application.dataRoot}</p><button className="button" disabled={processing} onClick={() => operation(async () => { await beforeRestart(); const result = await window.desktopApi.chooseLibrary(); if (!result.canceled) await window.desktopApi.restartApplication() })}><FolderOpen size={15} />关联已有题库并重启</button></div>}
  </div>
}
