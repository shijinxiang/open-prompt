import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, ChevronDown, Copy, Database, Download, FilePlus2, FileText, FolderOpen, History, ImagePlus, Layers3, List, Loader2, MessageSquareText, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, RotateCcw, Search, Settings, ShieldCheck, Sun, Trash2, X, ZoomIn } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import BackupRecordPicker from './BackupRecordPicker.jsx'
import ImagePreview from './ImagePreview.jsx'
import UpdateSettings from './UpdateSettings.jsx'
import useWorkspaceLayout from './useWorkspaceLayout.js'
import { DEFAULT_SETTINGS, EXTRA_MODELS, FONT_SIZE_LIMITS, MODELS, PRIMARY_MODELS, SCHEMA_VERSION, TYPES, combineBackups, countChars, createRecord, displayTitle, exportText, exportQuestionsText, imageCount, legacyText, missingFields, normalizeSettings, qualityWarnings, recordModels, searchText, uid, upgradeBackup, mergeRecordLists } from './domain.js'
import { copyImage, downloadText, imageSource, loadData, loadSettings, saveData, saveSettings, storeImage } from './storage.js'

const dateText = date => new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const IconButton = ({ icon: Icon, title, ...props }) => <button type="button" className="icon-button" title={title} aria-label={title} {...props}><Icon size={17} /></button>
const Field = ({ label, hint, children }) => <label className="field"><span className="field-title">{label}{hint && <span className="field-hint">{hint}</span>}</span>{children}</label>
const Badge = ({ result }) => <span className={`badge ${['达成', '通过'].includes(result) ? 'green' : ['未达成', '不通过'].includes(result) ? 'red' : 'muted'}`}>{result || '未填写'}</span>
const BACKUP_SCOPES = [
  { id: 'all', label: '全部记录', archived: null },
  { id: 'active', label: '未归档', archived: false },
  { id: 'archived', label: '已归档', archived: true },
  { id: 'selected', label: '选择特定记录' },
]
const recordsForBackup = (records, scope, selectedIds = []) => {
  if (scope.id === 'selected') { const selected = new Set(selectedIds); return records.filter(record => selected.has(record.id)) }
  return scope.archived === null ? records : records.filter(record => record.archived === scope.archived)
}

function MissingNotice({ record }) {
  const missing = missingFields(record)
  if (!missing.length) return <div className="complete-notice"><CheckCircle2 size={16} />资料完整</div>
  return <details className="missing-notice" key={record.id}>
    <summary><AlertCircle size={16} /><span>缺失 {missing.length} 项资料</span><ChevronDown size={15} /></summary>
    <div className="missing-fields">{missing.map(field => <span key={field.key}>{field.label}</span>)}</div>
  </details>
}

function ImageTray({ images, onChange, onError, onPreview, label = '截图', onBusy, onCopied }) {
  const input = useRef(null)
  const busyRef = useRef(false)
  const dragDepth = useRef(0)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [copying, setCopying] = useState(null)
  const imagesRef = useRef(images)
  imagesRef.current = images
  const addFiles = async files => {
    if (busyRef.current) return
    const list = [...files].filter(file => file.type.startsWith('image/'))
    if (!list.length) return onError('未找到图片，请选择或粘贴图片。')
    if (imagesRef.current.length + list.length > 500) return onError('单个区域最多保存 500 张图片。')
    busyRef.current = true
    setBusy(true)
    onBusy(1)
    try {
      for (const file of list) {
        const added = await storeImage(file)
        const next = [...imagesRef.current, added]
        imagesRef.current = next
        onChange(next)
      }
    } catch (error) { onError(error.message) }
    finally { busyRef.current = false; setBusy(false); onBusy(-1) }
  }
  const copyScreenshot = async image => {
    if (copying) return
    setCopying(image.id)
    try { await copyImage(image); onCopied('图片已复制，可直接粘贴。') }
    catch (error) { onError(`复制图片失败：${error.message}`) }
    finally { setCopying(null) }
  }
  return <div className="image-section">
    <div className="section-heading"><h3>{label}<span className="sub-count">{images.length}</span></h3><button className="text-button" disabled={busy} onClick={() => input.current.click()}>{busy ? <Loader2 className="spin" size={15} /> : <ImagePlus size={15} />}添加图片</button></div>
    <input hidden ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { addFiles(event.target.files); event.target.value = '' }} />
    <div className={`image-tray ${images.length ? 'has-images' : ''} ${dragging ? 'dragging' : ''}`} tabIndex={0} aria-label={`${label}粘贴区域`} onPaste={event => {
      const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean)
      if (files.length) { event.preventDefault(); addFiles(files) }
    }} onDragEnter={event => { event.preventDefault(); if ([...event.dataTransfer.items].some(item => item.kind === 'file')) { dragDepth.current += 1; setDragging(true) } }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles(event.dataTransfer.files) }}>
      {dragging && <div className="drop-hint"><ImagePlus size={22} /><span>松开即可导入图片</span></div>}
      {images.length ? images.map((image, index) => <div className="image-item" key={image.id}>
        <button className="image-preview" draggable={Boolean(window.desktopApi?.startImageDrag)} onDragStart={event => { if (!window.desktopApi?.startImageDrag) return; event.preventDefault(); window.desktopApi.startImageDrag({ fileName: image.fileName, name: image.name }) }} title="拖出缩略图可将原图放入其他位置" onClick={() => onPreview({ images, index })} aria-label={`查看${image.name}`}><img src={imageSource(image)} alt={image.name} draggable={false} /><span><ZoomIn size={16} /></span></button>
        <div className="image-caption"><span title={image.name}>{image.name}</span><IconButton icon={copying === image.id ? Loader2 : Copy} className={`icon-button ${copying === image.id ? 'spin' : ''}`} title={`复制图片：${image.name}`} disabled={busy || copying !== null} onClick={() => copyScreenshot(image)} /><IconButton icon={Trash2} title={`移除${image.name}`} disabled={busy || copying !== null} onClick={() => onChange(images.filter(value => value.id !== image.id))} /></div>
      </div>) : <div className="image-empty"><ImagePlus size={24} strokeWidth={1.4} /><span>暂无{label}</span></div>}
    </div>
  </div>
}

function ModelRecord({ model, data, update, onError, onPreview, onBusy, onCopied }) {
  const [preview, setPreview] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [copyingResponse, setCopyingResponse] = useState(false)
  const copyResponse = async () => {
    setCopyingResponse(true)
    try { await navigator.clipboard.writeText(data.response); onCopied('模型回复已复制，保留 Markdown 原文格式。') }
    catch (error) { onError(`复制模型回复失败：${error.message}`) }
    finally { setCopyingResponse(false) }
  }
  return <section className="model-section" id={`section-${model.id}`}>
    <div className="model-heading"><span className={`model-avatar ${model.color}`}>{model.mark}</span><h3>{model.custom && data.actualName.trim() ? `${model.name} · ${data.actualName}` : model.name}</h3><Badge result={data.result} /><IconButton icon={ChevronDown} title={collapsed ? `展开${model.name}` : `收起${model.name}`} className={`icon-button ${collapsed ? '' : 'rotated'}`} onClick={() => setCollapsed(!collapsed)} /></div>
    <div hidden={collapsed}>
      <div className="model-meta-row model-meta-row-compact"><Field label={`${model.name}实际名称`}><input aria-label={`${model.name}实际名称`} value={data.actualName} onChange={event => update({ actualName: event.target.value })} onBlur={() => { if (!model.custom && !data.actualName.trim()) update({ actualName: model.name }) }} placeholder={model.custom ? '准确模型名称' : model.name} /></Field><Field label={`${model.name}总体结果`}><select aria-label={`${model.name}总体结果`} value={data.result} onChange={event => update({ result: event.target.value })}><option value="">未填写</option><option>达成</option><option>未达成</option></select></Field></div>
      <div className="response-header"><label htmlFor={`response-${model.id}`}>原始回复<span className="sub-count">{countChars(data.response)} 字</span></label><div className="response-tools"><div className="segmented"><button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>原文</button><button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Markdown 预览</button></div><IconButton icon={Copy} title={`复制${model.name}回复`} disabled={copyingResponse || !data.response.trim()} onClick={copyResponse} /></div></div>
      {preview ? <div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{data.response || ''}</ReactMarkdown></div> : <textarea id={`response-${model.id}`} aria-label={`${model.name}原始回复`} className="response-input" value={data.response} onChange={event => update({ response: event.target.value })} placeholder="模型回复" />}
      <Field label={`${model.name}达成性备注`}><textarea aria-label={`${model.name}达成性备注`} className="note-input" value={data.note} onChange={event => update({ note: event.target.value })} placeholder="备注" /></Field>
      <ImageTray label={`${model.name}截图`} images={data.screenshots} onChange={screenshots => update({ screenshots })} onError={onError} onPreview={onPreview} onBusy={onBusy} onCopied={onCopied} />
    </div>
  </section>
}

function RankingFields({ record, update }) {
  const quality = record.quality
  const warnings = qualityWarnings(record)
  const chars = countChars(quality.rankingExplanation)
  return <section className="ranking-section" id="section-ranking">
    <div className="section-heading"><h2>五模型达成性排序</h2></div>
    <div className="model-number-key">{MODELS.map((model, index) => <span key={model.id}><b>模型{index + 1}</b>{record.models[model.id].actualName || model.name}</span>)}</div>
    <Field label="核心考点的达成性排序"><input aria-label="核心考点的达成性排序" value={quality.ranking} onChange={event => update({ ranking: event.target.value })} placeholder="模型1 = 模型3 ＞ 模型2 ＞ 模型5 ＞ 模型4" /></Field>
    <Field label="核心考点的达成性排序说明" hint={<span className={quality.rankingExplanation && chars < 300 ? 'short-explanation' : ''}>{chars} / 300 字</span>}><textarea aria-label="核心考点的达成性排序说明" className="ranking-explanation" value={quality.rankingExplanation} onChange={event => update({ rankingExplanation: event.target.value })} placeholder={'总结：\n\n模型1：\n\n模型2：\n\n模型3：\n\n模型4：\n\n模型5：'} /></Field>
    {warnings.length > 0 && <div className="quality-warnings" role="status">{warnings.map(message => <div key={message}><AlertCircle size={15} /><span>{message}</span></div>)}</div>}
  </section>
}

function RecordForm({ record, update, updateModel, onError, onPreview, onBusy, onCopied, disabled }) {
  return <div className="record-form"><MissingNotice record={record} /><fieldset disabled={disabled}>
    <section id="section-question" className="question-section">
      <div className="section-heading"><h2>题目信息</h2><span className="small-muted">创建于 {dateText(record.createdAt)}</span></div>
      <Field label="标题"><input value={record.title} onChange={event => update({ title: event.target.value })} placeholder="记录标题" /></Field>
      <div className="form-row"><Field label="问题类型"><select aria-label="问题类型" value={record.type} onChange={event => update({ type: event.target.value })}><option value="">未分类</option>{TYPES.map(type => <option key={type}>{type}</option>)}</select></Field><Field label="领域"><input aria-label="领域" value={record.field} onChange={event => update({ field: event.target.value })} /></Field></div>
      <Field label="标签"><input value={record.tags} onChange={event => update({ tags: event.target.value })} placeholder="标签" /></Field>
      <Field label="问题（Prompt）" hint={`${countChars(record.prompt)} 字`}><textarea aria-label="问题（Prompt）" className="prompt-input" value={record.prompt} onChange={event => update({ prompt: event.target.value })} placeholder="问题正文" /></Field>
      <Field label="关键洞察（Insight）"><textarea aria-label="关键洞察（Insight）" className="insight-input" value={record.insight} onChange={event => update({ insight: event.target.value })} placeholder="关键洞察" /></Field>
      <Field label="决定性核心考点" hint={`${countChars(record.criteriaText)} 字`}><textarea aria-label="决定性核心考点" className="criteria-input" value={record.criteriaText} onChange={event => update({ criteriaText: event.target.value })} placeholder="核心考点全文" /></Field>
      <Field label="非决定性核心考点" hint={`可选 · ${countChars(record.nonDecisiveCriteriaText)} 字`}><textarea aria-label="非决定性核心考点" className="non-decisive-criteria-input" value={record.nonDecisiveCriteriaText} onChange={event => update({ nonDecisiveCriteriaText: event.target.value })} placeholder="可留空，填写补充的非决定性考点" /></Field>
    </section>
    <div className="models-section-label"><MessageSquareText size={18} /><h2>模型记录</h2><span>{recordModels(record).filter(model => record.models[model.id].response.trim()).length} / {recordModels(record).length} 条回复</span></div>
    {PRIMARY_MODELS.map(model => <ModelRecord key={model.id} model={model} data={record.models[model.id]} update={patch => updateModel(model.id, patch)} onError={onError} onPreview={onPreview} onBusy={onBusy} onCopied={onCopied} />)}
    <section id="section-quality" className="quality-section"><div className="section-heading quality-heading"><h2>模型4/5与五模型排序</h2><label className="quality-toggle"><span>二轮资料</span><input aria-label="二轮资料" role="switch" type="checkbox" checked={record.quality.enabled} onChange={event => update({ quality: { ...record.quality, enabled: event.target.checked } })} /></label></div>
      {record.quality.enabled && <>
        {EXTRA_MODELS.map(model => <ModelRecord key={model.id} model={model} data={record.models[model.id]} update={patch => updateModel(model.id, patch)} onError={onError} onPreview={onPreview} onBusy={onBusy} onCopied={onCopied} />)}
        <RankingFields record={record} update={patch => update({ quality: { ...record.quality, ...patch } })} />
      </>}
    </section>
    <section id="section-notes" className="extra-section"><div className="section-heading"><h2>补充记录</h2></div><Field label="验收结果"><select aria-label="验收结果" className="acceptance-select" value={record.acceptanceResult} onChange={event => update({ acceptanceResult: event.target.value })}><option value="">未填写</option><option>通过</option><option>不通过</option></select></Field></section>
  </fieldset></div>
}

export default function App() {
  const layout = useWorkspaceLayout()
  const [records, setRecords] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveStatus, setSaveStatus] = useState('saved')
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('全部记录')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('updated')
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [menu, setMenu] = useState(false)
  const [working, setWorking] = useState(false)
  const [imageBusy, setImageBusy] = useState(0)
  const [dataPath, setDataPath] = useState('')
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsStatus, setSettingsStatus] = useState('saved')
  const [sharedInfo, setSharedInfo] = useState(null)
  const [backupProgress, setBackupProgress] = useState(null)
  const [importProgress, setImportProgress] = useState(null)
  const [updateInfo, setUpdateInfo] = useState(null)
  const [application, setApplication] = useState(null)
  const savedRecords = useRef([])
  const sharedSequence = useRef(0)
  const syncConflict = useRef(null)
  const latestSettings = useRef(DEFAULT_SETTINGS)
  const settingsQueue = useRef(Promise.resolve())
  const settingsTimer = useRef(null)
  const firstSettingsSave = useRef(true)
  const importInput = useRef(null)
  const latestRecords = useRef(records)
  const saveQueue = useRef(Promise.resolve())
  const saveTimer = useRef(null)
  const imageJobs = useRef(0)
  const imageWaiters = useRef([])
  latestRecords.current = records
  const notify = (message, error = false) => setToast({ message, error })
  useEffect(() => window.desktopApi?.onImageDragError?.(message => setToast({ message: `拖出图片失败：${message}`, error: true })), [])
  const onImageBusy = delta => {
    imageJobs.current += delta
    setImageBusy(imageJobs.current)
    if (!imageJobs.current) { for (const resolve of imageWaiters.current) resolve(); imageWaiters.current = [] }
  }
  const waitImages = () => imageJobs.current ? new Promise(resolve => imageWaiters.current.push(resolve)) : Promise.resolve()

  const replaceRecords = next => { latestRecords.current = next; setRecords(next) }
  const changeRecords = change => replaceRecords(change(latestRecords.current))
  const receiveSharedData = (data, ownSnapshot) => {
    if (!data?.records || (data.sequence && data.sequence < sharedSequence.current)) return
    if (data.sequence && data.sequence === sharedSequence.current && JSON.stringify(savedRecords.current) === JSON.stringify(data.records)) { setSaveStatus(JSON.stringify(latestRecords.current) === JSON.stringify(data.records) ? 'saved' : 'saving'); return }
    const before = ownSnapshot || savedRecords.current, local = latestRecords.current
    const merged = mergeRecordLists(before, local, data.records)
    savedRecords.current = data.records; sharedSequence.current = data.sequence || sharedSequence.current
    replaceRecords(merged.records)
    if (merged.conflicts.length) {
      clearTimeout(saveTimer.current)
      const pending = { kind: 'shared-conflict', title: '共享题库中的同一字段已更新', local: merged.records, remote: mergeRecordLists(before, local, data.records, false).records, base: data.records, count: merged.conflicts.length }
      syncConflict.current = pending; setModal(pending); setSaveStatus('error')
    } else setSaveStatus(JSON.stringify(merged.records) === JSON.stringify(data.records) ? 'saved' : 'saving')
    setSelected(current => merged.records.some(record => record.id === current) ? current : merged.records.find(record => !record.archived)?.id || merged.records[0]?.id || null)
  }
  useEffect(() => window.desktopApi?.onDataChanged?.(receiveSharedData), [])
  useEffect(() => window.desktopApi?.onBackupProgress?.(setBackupProgress), [])
  useEffect(() => window.desktopApi?.onImportProgress?.(setImportProgress), [])
  useEffect(() => {
    window.desktopApi?.updateState?.().then(setUpdateInfo).catch(() => {})
    window.desktopApi?.applicationInfo?.().then(setApplication).catch(() => {})
    return window.desktopApi?.onUpdateState?.(setUpdateInfo)
  }, [])
  useEffect(() => window.desktopApi?.onUpdateError?.(message => notify(message, true)), [])
  useEffect(() => {
    const importId = modal?.kind === 'import' && modal.data.importId
    return () => { if (importId) window.desktopApi?.discardImport?.(importId).catch(() => {}) }
  }, [modal?.kind, modal?.data?.importId])
  useEffect(() => { window.desktopApi?.sharedInfo?.().then(setSharedInfo).catch(() => {}) }, [])
  useEffect(() => {
    loadData().then(async raw => {
      const data = upgradeBackup(raw)
      if (raw.version !== data.version || JSON.stringify(raw.records) !== JSON.stringify(data.records)) await saveData({ version: SCHEMA_VERSION, records: data.records })
      if (!raw.sequence || raw.sequence >= sharedSequence.current) { savedRecords.current = data.records; sharedSequence.current = raw.sequence || 0; replaceRecords(data.records) }
      setSelected(data.records.find(record => !record.archived)?.id || data.records[0]?.id || null)
      setDataPath(raw.dataPath || '浏览器预览数据')
      setLoaded(true)
    }).catch(error => setLoadError(error.message))
  }, [])

  useEffect(() => {
    loadSettings().then(raw => {
      const value = normalizeSettings(raw)
      latestSettings.current = value; setSettings(value); setSettingsLoaded(true)
    }).catch(error => { setSettingsLoaded(true); notify(`无法读取字号设置：${error.message}`, true) })
  }, [])
  const persistSettings = async () => {
    clearTimeout(settingsTimer.current)
    const snapshot = latestSettings.current
    setSettingsStatus('saving')
    const task = settingsQueue.current.catch(() => {}).then(() => saveSettings(snapshot))
    settingsQueue.current = task
    try { await task; if (snapshot === latestSettings.current) setSettingsStatus('saved') }
    catch (error) { setSettingsStatus('error'); notify(`字号设置保存失败：${error.message}`, true); throw error }
  }
  const updateSettings = patch => {
    const value = normalizeSettings({ ...latestSettings.current, ...patch })
    latestSettings.current = value; setSettings(value)
  }
  useEffect(() => {
    if (!settingsLoaded) return
    if (firstSettingsSave.current) { firstSettingsSave.current = false; return }
    setSettingsStatus('saving')
    settingsTimer.current = setTimeout(() => persistSettings().catch(() => {}), 250)
    return () => clearTimeout(settingsTimer.current)
  }, [settings, settingsLoaded])
  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-size', `${settings.fontSize}px`)
    document.documentElement.style.setProperty('--app-font-scale', String(settings.fontSize / DEFAULT_SETTINGS.fontSize))
    document.documentElement.dataset.fontSize = String(settings.fontSize)
  }, [settings.fontSize])
  useEffect(() => { document.documentElement.dataset.theme = settings.theme }, [settings.theme])

  const persist = async () => {
    clearTimeout(saveTimer.current)
    if (syncConflict.current) { setModal(syncConflict.current); throw new Error('请先选择共享修改的处理方式。') }
    let snapshot
    setSaveStatus('saving')
    const task = saveQueue.current.catch(() => {}).then(() => {
      if (syncConflict.current) throw new Error('请先处理共享修改冲突。')
      snapshot = { version: SCHEMA_VERSION, records: latestRecords.current, baseRecords: savedRecords.current }
      return saveData(snapshot)
    })
    saveQueue.current = task
    try { const result = await task; if (result?.data) receiveSharedData(result.data, snapshot.records); else { savedRecords.current = snapshot.records; if (latestRecords.current === snapshot.records) setSaveStatus('saved') } }
    catch (error) { if (error.latestData) receiveSharedData(error.latestData); setSaveStatus('error'); notify(`保存失败：${error.message}`, true); throw error }
  }
  useEffect(() => {
    if (!loaded) return
    if (syncConflict.current) return
    if (JSON.stringify(records) === JSON.stringify(savedRecords.current)) { setSaveStatus('saved'); return }
    setSaveStatus('saving')
    saveTimer.current = setTimeout(() => persist().catch(() => {}), 450)
    return () => clearTimeout(saveTimer.current)
  }, [records, loaded])
  useEffect(() => {
    if (!window.desktopApi?.onBeforeClose) return
    return window.desktopApi.onBeforeClose(async () => {
      if (!loaded || loadError) return window.desktopApi.allowClose()
      try {
        await waitImages()
        clearTimeout(saveTimer.current)
        await saveQueue.current.catch(() => {})
        if (syncConflict.current) { setModal(syncConflict.current); throw new Error('共享修改尚未处理') }
        await saveData({ version: SCHEMA_VERSION, records: latestRecords.current, baseRecords: savedRecords.current })
        if (settingsLoaded) { clearTimeout(settingsTimer.current); await settingsQueue.current.catch(() => {}); await saveSettings(latestSettings.current) }
        window.desktopApi.allowClose()
      } catch { setSaveStatus('error'); window.desktopApi.cancelClose() }
    })
  }, [loaded, loadError, settingsLoaded])
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), 4200); return () => clearTimeout(timer) } }, [toast])
  useEffect(() => {
    const key = event => {
      if (event.key === 'Escape') { setImagePreview(null); if (!working && !syncConflict.current) setModal(null); setMenu(false) }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (loaded) persist().catch(() => {}) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [loaded, working])

  const record = records.find(value => value.id === selected)
  const missingById = new Map(records.map(value => [value.id, missingFields(value)]))
  const updateRecord = (id, patch) => changeRecords(current => current.map(value => value.id === id ? { ...value, ...patch, updatedAt: new Date().toISOString() } : value))
  const updateModelRecord = (id, modelId, patch) => changeRecords(current => current.map(value => value.id === id ? { ...value, models: { ...value.models, [modelId]: { ...value.models[modelId], ...patch } }, updatedAt: new Date().toISOString() } : value))
  const newRecord = () => {
    const next = createRecord()
    changeRecords(current => [next, ...current]); setSelected(next.id); setFilter('全部记录'); setQuery(''); setMenu(false)
  }
  const duplicate = () => {
    const copy = structuredClone(record)
    copy.id = uid(); copy.title = `${displayTitle(record)}（副本）`; copy.archived = false; copy.createdAt = copy.updatedAt = new Date().toISOString()
    changeRecords(current => [copy, ...current]); setSelected(copy.id); setFilter('全部记录'); setQuery(''); setMenu(false); notify('整条记录已复制。')
  }
  const copyText = async text => { try { await navigator.clipboard.writeText(text); notify('记录文本已复制。') } catch { notify('复制失败，请使用导出文本。', true) } }
  const backup = async (scopeId, selectedIds, format = 'json') => {
    const scope = BACKUP_SCOPES.find(value => value.id === scopeId)
    if (!scope) return
    setWorking(true); setBackupProgress(null)
    try {
      await waitImages(); await persist()
      const payload = { version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), records: recordsForBackup(latestRecords.current, scope, selectedIds) }
      if (!payload.records.length) { notify(scope.id === 'selected' ? '请先选择需要导出的记录。' : '所选范围暂无记录，请选择其他范围。'); return }
      if (format === 'questions-txt') {
        const prompts = payload.records.filter(record => record.prompt.trim()).map(record => record.prompt)
        if (!prompts.length) { notify('所选记录没有题目正文。'); return }
        if (window.desktopApi) { const result = await window.desktopApi.exportQuestions({ prompts }); if (result.canceled) return }
        else downloadText('\uFEFF' + exportQuestionsText(payload.records), `开放题目-${scope.label}-${new Date().toLocaleDateString('en-CA')}.txt`)
        setModal(null); notify(`${scope.label}题目 TXT 已导出，共 ${prompts.length} 道，仅包含题目正文。`); return
      }
      if (window.desktopApi) {
        const result = await window.desktopApi.exportBackup(payload)
        if (result.canceled) return
      } else downloadText(JSON.stringify(payload, null, 2), `开放题记录备份-${scope.label}-${new Date().toLocaleDateString('en-CA')}.json`, 'application/json')
      setModal(null)
      notify(`${scope.label}备份已导出，共 ${payload.records.length} 条，包含完整文本和截图。`)
    } catch (error) { notify(error.message, true) } finally { setWorking(false) }
  }
  const prepareImport = raw => {
    const data = upgradeBackup(raw)
    const existing = new Set(latestRecords.current.map(value => value.id))
    setModal({ kind: 'import', data, duplicates: data.records.filter(value => existing.has(value.id)).length + (data.duplicateAcrossFiles || 0) })
  }
  const importBackup = async () => {
    layout.closeDrawers()
    if (!window.desktopApi) return importInput.current.click()
    setWorking(true); setImportProgress(null); setModal({ kind: 'import-reading', title: '读取备份' })
    try { const result = await window.desktopApi.importBackup(); if (!result.canceled) prepareImport(result.data); else setModal(null) } catch (error) { setModal(null); notify(`导入失败：${error.message}`, true) }
    finally { setWorking(false) }
  }
  const saveBeforeRestart = async () => {
    if (working) throw new Error('正在处理导入或导出，请完成后再重启。')
    await waitImages(); await persist()
    if (settingsLoaded) await persistSettings()
  }
  const applyImport = async () => {
    setWorking(true)
    try {
      await waitImages(); await persist()
      const incoming = structuredClone(modal.data.records)
      if (window.desktopApi) {
        const result = await window.desktopApi.applyImport({ version: SCHEMA_VERSION, records: incoming, ...(modal.data.importId ? { importId: modal.data.importId } : {}) })
        replaceRecords(result.data.records)
        if (!selected && result.data.records.length) setSelected(result.data.records[0].id)
        setModal(null); setSaveStatus('saved'); notify(`已导入 ${result.imported} 条新记录，跳过 ${result.skipped + (modal.data.duplicateAcrossFiles || 0)} 条同编号记录。`)
        return
      }
      const current = new Map(latestRecords.current.map(value => [value.id, value]))
      const countBefore = current.size
      for (const value of incoming) if (!current.has(value.id)) current.set(value.id, value)
      const next = [...current.values()]
      await saveData({ version: SCHEMA_VERSION, records: next })
      replaceRecords(next); if (!selected && next.length) setSelected(next[0].id); setModal(null); notify(`已导入 ${next.length - countBefore} 条新记录，跳过 ${(modal.data.recordCount ?? incoming.length) - (next.length - countBefore)} 条同编号记录。`)
    } catch (error) { notify(`导入失败：${error.message}`, true) } finally { setWorking(false) }
  }
  const active = records.filter(value => !value.archived)
  const backupOptions = BACKUP_SCOPES.map(scope => ({ ...scope, count: recordsForBackup(records, scope, modal?.selectedIds).length }))
  const backupCount = backupOptions.find(scope => scope.id === modal?.scope)?.count || 0
  const questionsOnly = modal?.kind === 'backup' && modal.format === 'questions-txt'
  const questionCount = modal?.kind === 'backup' ? recordsForBackup(records, BACKUP_SCOPES.find(scope => scope.id === modal.scope), modal.selectedIds).filter(record => record.prompt.trim()).length : 0
  const filtered = records.filter(value => {
    if (filter === '已归档' ? !value.archived : value.archived) return false
    if (TYPES.includes(filter) && value.type !== filter) return false
    return searchText(value).includes(query.toLowerCase())
  }).sort((a, b) => new Date(b[sort === 'created' ? 'createdAt' : 'updatedAt']) - new Date(a[sort === 'created' ? 'createdAt' : 'updatedAt']))
  const navItems = [{ label: '全部记录', icon: Layers3, count: active.length }, ...TYPES.map(type => ({ label: type, icon: FileText, count: active.filter(value => value.type === type).length })), { label: '已归档', icon: Archive, count: records.filter(value => value.archived).length }]
  const jumpTo = id => document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (loadError) return <div className="fatal-error"><AlertCircle size={35} /><h1>无法读取本地数据</h1><p>{loadError}</p><button className="button" onClick={() => window.location.reload()}><RotateCcw size={16} />重试</button><button className="button" onClick={() => window.desktopApi?.openDataFolder()}><FolderOpen size={16} />打开数据目录</button></div>
  if (!loaded) return <div className="loading-screen"><Loader2 className="spin" size={28} /><span>正在读取本地记录</span></div>
  return <div className={layout.className} style={layout.style}>
    {layout.compact && layout.sidebarVisible && <button className="layout-backdrop" aria-label="关闭侧边栏" onClick={layout.closeDrawers} />}
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Layers3 size={24} strokeWidth={1.6} /></div><div><h1>开放题记录</h1><span>本地资料库</span></div><IconButton icon={PanelLeftClose} title="收起侧边栏" onClick={layout.toggleSidebar} /></div>
      <div className="workspace-label">记录分类</div><nav>{navItems.map(({ label, icon: Icon, count }) => <button key={label} className={`nav-item ${filter === label ? 'active' : ''}`} onClick={() => { setFilter(label); setQuery(''); layout.chooseFilter() }}><Icon size={18} /><span>{label}</span><b>{count}</b></button>)}</nav>
      <div className="sidebar-bottom"><div className="workspace-status"><span className="status-dot" /><span>本地存储</span><ShieldCheck size={15} /></div><button className="storage-path" title={dataPath} onClick={() => window.desktopApi?.openDataFolder()}><FolderOpen size={14} /><span>{window.desktopApi ? '打开 data 目录' : '浏览器预览'}</span></button><div className="backup-actions"><button disabled={working || imageBusy > 0} onClick={() => { layout.closeDrawers(); setModal({ kind: 'backup', title: '导出备份', scope: 'all', selectedIds: [] }) }}><ArrowDownToLine size={16} />导出备份</button><button disabled={working || imageBusy > 0} onClick={importBackup}><ArrowUpFromLine size={16} />导入备份</button></div><button className="questions-export-button" disabled={working || imageBusy > 0} onClick={() => { layout.closeDrawers(); setModal({ kind: 'backup', title: '导出题目 TXT', format: 'questions-txt', scope: 'all', selectedIds: [] }) }}><FileText size={16} />导出题目 TXT</button><div className="sidebar-footnote">OPEN QUESTION STUDIO</div></div>
    </aside>
    <main className="main-workspace">
      <header className="topbar"><div className="page-title"><IconButton icon={layout.sidebarVisible ? PanelLeftClose : PanelLeftOpen} title={layout.sidebarVisible ? '收起侧边栏' : '展开侧边栏'} aria-expanded={layout.sidebarVisible} onClick={layout.toggleSidebar} /><IconButton icon={List} title={layout.recordsVisible ? '收起记录列表' : '展开记录列表'} aria-expanded={layout.recordsVisible} onClick={layout.toggleRecords} /><h1>记录库</h1><span className="page-record-count">{active.length} 条记录</span></div><div className="topbar-actions">{['available','downloaded'].includes(updateInfo?.status) && <button className="update-notice" onClick={() => setModal({ kind: 'settings', title: '设置' })}>新版本 {updateInfo.availableVersion}</button>}<IconButton icon={Settings} title="设置" disabled={!settingsLoaded} onClick={() => setModal({ kind: 'settings', title: '设置' })} /><button className={`save-indicator ${saveStatus}`} onClick={() => persist().catch(() => {})} title="立即保存">{saveStatus === 'saving' ? <Loader2 size={14} className="spin" /> : saveStatus === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}<span>{saveStatus === 'saving' ? '保存中' : saveStatus === 'error' ? '保存失败 · 重试' : '已保存到本地'}</span></button><button className="button primary" aria-label="新建记录" disabled={working} onClick={newRecord}><Plus size={17} /><span>新建记录</span></button></div></header>
      <section className="summary-strip"><div><span className="metric-label"><Layers3 size={15} />记录</span><strong>{active.length}<small>条</small></strong></div><div><span className="metric-label"><MessageSquareText size={15} />模型回复</span><strong>{active.reduce((count, value) => count + MODELS.filter(model => value.models[model.id].response.trim()).length, 0)}<small>份</small></strong></div><div><span className="metric-label"><ImagePlus size={15} />截图与附件</span><strong className="teal-text">{active.reduce((count, value) => count + imageCount(value), 0)}<small>张</small></strong></div></section>
      <section className="workspace-panels">
        {layout.compact && layout.recordsVisible && <button className="record-panel-backdrop" aria-label="关闭记录列表" onClick={layout.closeDrawers} />}
        <aside className="record-panel"><div className="record-panel-heading"><h2>{filter}<span>{filtered.length}</span></h2><select aria-label="排序" className="sort-select" value={sort} onChange={event => setSort(event.target.value)}><option value="updated">最近修改</option><option value="created">最近创建</option></select></div>
          <div className="list-filters"><div className="search-field"><Search size={16} /><input aria-label="搜索记录" placeholder="搜索问题、考点、备注与回复" value={query} onChange={event => setQuery(event.target.value)} />{query && <IconButton icon={X} title="清空搜索" onClick={() => setQuery('')} />}</div></div>
          <div className="record-list">{filtered.map(value => <button key={value.id} className={`record-item ${value.id === selected ? 'selected' : ''}`} onClick={() => { setSelected(value.id); setMenu(false); layout.closeDrawers() }}><div className="record-item-meta"><span className="type-label">{value.type || '未分类'}{value.quality.enabled ? ' · 二轮' : ''}</span><span>{dateText(value.updatedAt)}</span></div><h3>{displayTitle(value)}</h3><p>{value.prompt || value.criteriaText || value.notes || '暂无正文'}</p>{missingById.get(value.id).length > 0 ? <div className="record-item-missing" title={`缺失：${missingById.get(value.id).map(field => field.label).join('；')}`}><AlertCircle size={13} /><span>缺失 {missingById.get(value.id).length} 项：{missingById.get(value.id).map(field => field.label).join('、')}</span></div> : <div className="record-item-complete"><CheckCircle2 size={13} />资料完整</div>}<div className="record-item-bottom"><span className="record-image-count"><ImagePlus size={12} />{imageCount(value)} 张图片</span><div className="reply-dots">{recordModels(value).map(model => <span key={model.id} title={`${model.name}：${value.models[model.id].response ? '已记录' : '未填写'}`} className={value.models[model.id].response ? `filled ${model.color}` : ''} />)}</div></div></button>)}{!filtered.length && <div className="list-empty"><Search size={25} strokeWidth={1.4} /><p>{records.length ? '没有符合条件的记录' : '暂无记录'}</p>{records.length > 0 && <button className="text-button" onClick={() => { setQuery(''); setFilter('全部记录') }}>清除筛选</button>}</div>}</div>
          <div className="list-footer"><Database size={13} />{filtered.length} 条记录<span>本地资料库</span></div>
        </aside>
        <div className="record-panel-splitter" role="separator" aria-label="调整记录列表宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={480} tabIndex={0} {...layout.splitter} />
        <section className="detail-panel">{record ? <>
          <div className="detail-heading"><div className="detail-eyebrow"><span>RECORD / {record.id.slice(0, 8).toUpperCase()}</span>{record.archived && <span className="badge muted">已归档</span>}</div><div className="detail-title-row"><h2 title={displayTitle(record)}>{displayTitle(record)}</h2>{record.archived && <span className="badge muted compact-archive-badge">已归档</span>}<div className="detail-tools"><IconButton icon={FileText} title="记录文本" onClick={() => setModal({ kind: 'text', text: exportText(record), title: '记录文本' })} /><IconButton icon={Copy} title="复制整条记录" disabled={working || imageBusy > 0} onClick={duplicate} /><IconButton icon={record.archived ? ArchiveRestore : Archive} title={record.archived ? '恢复记录' : '归档记录'} onClick={() => { updateRecord(record.id, { archived: !record.archived }); notify(record.archived ? '记录已恢复。' : '记录已归档。') }} /><div className="menu-wrapper"><IconButton icon={MoreHorizontal} title="更多操作" onClick={() => setMenu(!menu)} />{menu && <><div className="menu-backdrop" onClick={() => setMenu(false)} /><div className="context-menu">{record.legacy && <button onClick={() => { setModal({ kind: 'legacy', title: '旧版资料', text: legacyText(record) }); setMenu(false) }}><History size={15} />旧版资料</button>}<button className="danger" disabled={imageBusy > 0} onClick={() => { setModal({ kind: 'delete', recordId: record.id, title: displayTitle(record) }); setMenu(false) }}><Trash2 size={15} />删除记录</button></div></>}</div></div></div><div className="detail-subtitle"><span>{record.type || '未分类'}</span><span className="separator-dot" /><span>{record.field || '未填写领域'}</span><span className="separator-dot" /><span>更新于 {dateText(record.updatedAt)}</span></div></div>
          <div className="record-anchors"><button onClick={() => jumpTo('question')}><FileText size={14} />题目信息</button>{PRIMARY_MODELS.map(model => <button key={model.id} onClick={() => jumpTo(model.id)}><span className={`anchor-dot ${model.color}`} />{model.name}</button>)}<button onClick={() => jumpTo('quality')}>二轮资料</button>{record.quality.enabled && <>{EXTRA_MODELS.map(model => <button key={model.id} onClick={() => jumpTo(model.id)}><span className={`anchor-dot ${model.color}`} />{model.name}</button>)}<button onClick={() => jumpTo('ranking')}>五模型排序</button></>}<button onClick={() => jumpTo('notes')}>验收结果</button></div>
          <div className="detail-scroll" key={record.id}><RecordForm record={record} update={patch => updateRecord(record.id, patch)} updateModel={(modelId, patch) => updateModelRecord(record.id, modelId, patch)} onError={message => notify(message, true)} onPreview={setImagePreview} onBusy={onImageBusy} onCopied={message => notify(message)} disabled={working} /></div>
        </> : <div className="workspace-empty"><div className="empty-art"><FileText size={54} strokeWidth={1} /><span><Plus size={19} /></span></div><span className="empty-eyebrow">OPEN QUESTION STUDIO</span><h2>还没有记录</h2><button className="button primary" onClick={newRecord}><FilePlus2 size={17} />新建记录</button><button className="text-button" disabled={working} onClick={importBackup}><ArrowUpFromLine size={15} />导入备份</button><div className="empty-models">{PRIMARY_MODELS.map(model => <span key={model.id}><span className={`model-avatar ${model.color}`}>{model.mark}</span>{model.name}</span>)}</div></div>}</section>
      </section>
    </main>
    <input type="file" accept=".json,application/json" multiple hidden ref={importInput} onChange={async event => {
      const files = [...event.target.files]; event.target.value = ''; if (!files.length) return
      setWorking(true); setImportProgress(null); setModal({ kind: 'import-reading', title: '读取备份' })
      try {
        const inputs = []
        for (const [index, file] of files.entries()) { setImportProgress({ index: index + 1, total: files.length, name: file.name }); try { inputs.push({ name: file.name, data: JSON.parse(await file.text()) }) } catch (error) { throw new Error('文件“' + file.name + '”导入失败：' + error.message) } }
        prepareImport(combineBackups(inputs))
      } catch (error) { setModal(null); notify('导入失败：' + error.message, true) } finally { setWorking(false) }
    }} />
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><IconButton icon={X} title="关闭通知" onClick={() => setToast(null)} /></div>}
    {modal && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !working && !syncConflict.current) setModal(null) }}><div className={`modal ${['text', 'legacy'].includes(modal.kind) ? 'text-modal' : modal.kind === 'backup' && modal.scope === 'selected' ? 'backup-select-modal' : ''}`} role="dialog" aria-modal="true"><div className="modal-heading"><h2>{modal.kind === 'delete' ? '删除这条记录？' : modal.kind === 'import' ? '导入备份' : modal.title}</h2><IconButton icon={X} title="关闭" disabled={working || modal.kind === 'shared-conflict'} onClick={() => setModal(null)} /></div>
      {modal.kind === 'backup' && <>
        <Field label="导出格式"><select aria-label="导出格式" value={modal.format || 'json'} disabled={working} onChange={event => setModal(current => ({ ...current, format: event.target.value, title: event.target.value === 'questions-txt' ? '导出题目 TXT' : '导出备份' }))}><option value="json">完整备份 JSON（含截图）</option><option value="questions-txt">仅题目 TXT（只有题目正文）</option></select></Field>
        <p>{questionsOnly ? '只导出问题（Prompt）正文，题目之间用空行分隔，不额外添加标题、编号、答案、考点或截图。' : '选择导出范围。备份包含所选记录的完整文本、模型回复、截图和旧版资料。'}</p>
        <fieldset className="backup-scope"><legend>导出范围</legend><div className="backup-scope-options">{backupOptions.map(scope => <label key={scope.id} className={`backup-scope-option ${modal.scope === scope.id ? 'selected' : ''}`}><input type="radio" name="backup-scope" value={scope.id} aria-label={scope.label} checked={modal.scope === scope.id} disabled={working} onChange={() => setModal(current => ({ ...current, scope: scope.id }))} /><span>{scope.label}</span><b>{scope.id === 'selected' ? '已选 ' : ''}{scope.count} 条</b></label>)}</div></fieldset>
        {modal.scope === 'selected' && <BackupRecordPicker records={records} selectedIds={modal.selectedIds || []} disabled={working || imageBusy > 0} onChange={selectedIds => setModal(current => current?.kind === 'backup' ? { ...current, selectedIds } : current)} />}
        <p className="backup-summary" aria-live="polite">{questionsOnly ? (questionCount ? `将导出 ${questionCount} 道题目${backupCount > questionCount ? `，跳过 ${backupCount - questionCount} 条空白题目` : ''}。` : '所选记录没有题目正文。') : working && backupProgress ? `正在导出 ${backupProgress.completed} / ${backupProgress.total} 条记录，正在写入完整文本和截图…` : backupCount ? `将导出 ${backupCount} 条记录。` : modal.scope === 'selected' ? '请先选择需要导出的记录。' : '所选范围暂无记录，请选择其他范围。'}</p>
        <div className="modal-actions"><button className="button" disabled={working} onClick={() => setModal(null)}>取消</button><button className="button primary" disabled={working || imageBusy > 0 || !(questionsOnly ? questionCount : backupCount)} onClick={() => backup(modal.scope, modal.selectedIds, modal.format)}>{working ? <Loader2 size={16} className="spin" /> : <ArrowDownToLine size={16} />}开始导出</button></div>
      </>}
      {modal.kind === 'shared-conflict' && <><p>有 {modal.count} 处内容被两边同时修改。当前修改已保留，选择要采用的版本；其他独立修改仍会合并。</p><div className="modal-actions"><button className="button" onClick={() => { const pending = syncConflict.current; syncConflict.current = null; savedRecords.current = pending.base; replaceRecords(pending.remote); setModal(null) }}>采用共享修改</button><button className="button primary" onClick={() => { const pending = syncConflict.current; syncConflict.current = null; savedRecords.current = pending.base; replaceRecords(pending.local); setModal(null) }}>保留我的修改</button></div></>}
      {modal.kind === 'delete' && <><p>“{modal.title}”的文本、模型回复和截图关联将被删除。此操作无法撤销。</p><div className="modal-actions"><button className="button" onClick={() => setModal(null)}>取消</button><button className="button danger-fill" onClick={() => { const next = latestRecords.current.filter(value => value.id !== modal.recordId); replaceRecords(next); if (selected === modal.recordId) setSelected(next.find(value => !value.archived)?.id || next[0]?.id || null); setModal(null); notify('记录已删除。') }}><Trash2 size={16} />删除记录</button></div></>}
      {modal.kind === 'import-reading' && <div className="import-reading" role="status"><Loader2 className="spin" size={24} /><p>{importProgress ? `正在读取第 ${importProgress.index} / ${importProgress.total} 个文件：${importProgress.name}` : '可按住 Ctrl / Shift 同时选择多个 JSON 文件。'}</p></div>}
      {modal.kind === 'import' && <><p>备份{modal.data.files?.length > 1 ? `共 ${modal.data.files.length} 个文件，` : ''}包含 {modal.data.recordCount ?? modal.data.records.length} 条记录。将新增 {(modal.data.recordCount ?? modal.data.records.length) - modal.duplicates} 条，跳过 {modal.duplicates} 条同编号记录。</p>{modal.data.files?.length > 1 && <><ul className="import-file-list">{modal.data.files.map((file, index) => <li key={index}><span title={file.name}>{file.name}</span><small>{file.count} 条{file.duplicates ? ` · 文件间重复 ${file.duplicates} 条` : ''}</small></li>)}</ul><p className="import-hint">重复编号保留题库中已有的内容；文件之间重复时，保留先读取文件中的记录。</p></>}<div className="modal-actions"><button className="button" disabled={working} onClick={() => setModal(null)}>取消</button><button className="button primary" disabled={working} onClick={applyImport}>{working ? <Loader2 size={16} className="spin" /> : <ArrowUpFromLine size={16} />}合并导入</button></div></>}
      {modal.kind === 'settings' && <div className="settings-content"><label className="settings-label">显示主题</label><div className="theme-choice" role="group" aria-label="显示主题"><button type="button" className={settings.theme === 'light' ? 'active' : ''} aria-pressed={settings.theme === 'light'} onClick={() => updateSettings({ theme: 'light' })}><Sun size={16} />白天模式</button><button type="button" className={settings.theme === 'dark' ? 'active' : ''} aria-pressed={settings.theme === 'dark'} onClick={() => updateSettings({ theme: 'dark' })}><Moon size={16} />黑夜模式</button></div><label className="settings-label" htmlFor="font-size-slider">字号</label><div className="font-size-control"><input id="font-size-slider" type="range" min={FONT_SIZE_LIMITS.min} max={FONT_SIZE_LIMITS.max} step="1" value={settings.fontSize} onChange={event => updateSettings({ fontSize: Number(event.target.value) })} /><input className="font-size-number" aria-label="字号数值" type="number" min={FONT_SIZE_LIMITS.min} max={FONT_SIZE_LIMITS.max} value={settings.fontSize} onChange={event => { if (event.target.value !== '') updateSettings({ fontSize: Number(event.target.value) }) }} /><span>px</span></div><div className="font-size-range"><span>{FONT_SIZE_LIMITS.min} px</span><span>{FONT_SIZE_LIMITS.max} px</span></div><div className="settings-footer"><span className={`settings-save-status ${settingsStatus}`}>{settingsStatus === 'saving' ? '正在保存设置' : settingsStatus === 'error' ? '保存失败' : '设置已保存'}</span>{settingsStatus === 'error' && <button className="text-button" onClick={() => persistSettings().catch(() => {})}>重试</button>}<button className="text-button" onClick={() => updateSettings({ fontSize: DEFAULT_SETTINGS.fontSize })}><RotateCcw size={14} />恢复默认字号</button></div><div className="shared-settings"><h3>填写助手共享题库</h3><p>插件可直接使用当前题库，归档、恢复和内容修改双向同步。共享时保持存题软件运行。</p><button className="button" disabled={!sharedInfo?.available} onClick={async () => { try { await navigator.clipboard.writeText(sharedInfo.pairingCode); notify('连接码已复制，请在填写助手中连接共享题库。') } catch { notify('连接码复制失败，请重试。', true) } }}>复制共享题库连接码</button>{sharedInfo && !sharedInfo.available && <p>{sharedInfo.message}</p>}</div><UpdateSettings info={updateInfo} application={application} beforeRestart={saveBeforeRestart} /></div>}
      {['text', 'legacy'].includes(modal.kind) && <><pre className="export-preview">{modal.text}</pre><div className="modal-actions"><button className="button" onClick={() => copyText(modal.text)}><Copy size={15} />复制文本</button><button className="button" onClick={() => downloadText(modal.text, `${record ? displayTitle(record) : '记录'}${modal.kind === 'legacy' ? '-旧版资料' : ''}.txt`)}><Download size={15} />导出文本</button></div></>}
    </div></div>}
    {imagePreview && <ImagePreview key={imagePreview.index + '-' + imagePreview.images[imagePreview.index].id} images={imagePreview.images} index={imagePreview.index} onIndex={index => setImagePreview(current => ({ ...current, index }))} onClose={() => setImagePreview(null)} />}
  </div>
}
