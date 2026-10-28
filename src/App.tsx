import { useCallback, useEffect, useRef, useState } from 'react'
import { ViewerCanvas } from './components/ViewerCanvas'
import type {
  IfcElementInfo,
  IfcLoadResult,
  ImportedModelInfo,
  ViewerSelection,
  ViewerCanvasHandle,
} from './components/ViewerCanvas'
import type { TransformControlsMode } from 'three/addons/controls/TransformControls.js'
import { describeProjectResource, parseProjectDocument, resolveProjectResources, type FileWithPath, type IfcElementTransform, type ProjectDocument, type ProjectResource } from './project/project'
import { getGltfFilePath } from './gltf/resources'
import './App.css'

type LoadState = 'empty' | 'loading' | 'ready' | 'error'

const tools = [
  { id: 'select', label: '選取', icon: '↖' },
  { id: 'translate', label: '移動', icon: '✥' },
  { id: 'rotate', label: '旋轉', icon: '⟳' },
  { id: 'scale', label: '縮放', icon: '⤢' },
] as const

type GltfStatus = { phase: 'idle' | 'loading' | 'success' | 'error'; message: string }
function App() {
  const viewerRef = useRef<ViewerCanvasHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const gltfInputRef = useRef<HTMLInputElement>(null)
  const gltfFolderInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const projectResourcesInputRef = useRef<HTMLInputElement>(null)
  const projectResourceFolderInputRef = useRef<HTMLInputElement>(null)
  const elementsRef = useRef<IfcElementInfo[]>([])
  const ifcSourceRef = useRef<File | null>(null)
  const pendingIfcTransformsRef = useRef<IfcElementTransform[] | null>(null)
  const pendingProjectRef = useRef<ProjectDocument | null>(null)
  const [activeTool, setActiveTool] = useState('select')
  const [loadState, setLoadState] = useState<LoadState>('empty')
  const [model, setModel] = useState<IfcLoadResult | null>(null)
  const [elements, setElements] = useState<IfcElementInfo[]>([])
  const [assets, setAssets] = useState<ImportedModelInfo[]>([])
  const [selected, setSelected] = useState<ViewerSelection>(null)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [error, setError] = useState('')
  const [gltfStatus, setGltfStatus] = useState<GltfStatus>({ phase: 'idle', message: '' })
  const [draggingFile, setDraggingFile] = useState(false)
  const [projectName, setProjectName] = useState('未命名專案')
  const [projectMessage, setProjectMessage] = useState('')
  const [pendingProject, setPendingProject] = useState<ProjectDocument | null>(null)

  useEffect(() => {
    gltfFolderInputRef.current?.setAttribute('webkitdirectory', '')
    projectResourceFolderInputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  const onProgress = useCallback((completed: number, total: number) => {
    setProgress({ completed, total })
  }, [])
  const onElement = useCallback((element: IfcElementInfo) => {
    elementsRef.current.push(element)
  }, [])
  const onComplete = useCallback((result: IfcLoadResult) => {
    setModel(result)
    setElements(elementsRef.current)
    setSelected(null)
    setLoadState('ready')
    const savedTransforms = pendingIfcTransformsRef.current
    if (savedTransforms) {
      const restored = viewerRef.current?.applyIfcElementTransforms(savedTransforms) ?? { applied: 0, missing: savedTransforms.length }
      viewerRef.current?.resetView()
      pendingIfcTransformsRef.current = null
      setProjectMessage(`IFC 已還原 ${restored.applied} 個元件變換${restored.missing ? `；${restored.missing} 個識別碼未找到` : ''}。`)
    }
  }, [])
  const onModelsChange = useCallback((models: ImportedModelInfo[]) => {
    setAssets(models)
    if (models.length === 0) setGltfStatus({ phase: 'idle', message: '' })
  }, [])
  const onError = useCallback((message: string) => {
    pendingIfcTransformsRef.current = null
    setError(message)
    setLoadState('error')
  }, [])
  const onSelect = useCallback((selection: ViewerSelection) => {
    setSelected(selection)
    if (!selection) setActiveTool('select')
  }, [])

  const loadGltfFiles = async (files: File[]) => {
    if (!files.length) return
    setGltfStatus({ phase: 'loading', message: `正在載入 ${files.find((file) => /\.(glb|gltf)$/i.test(file.name))?.name ?? 'GLTF 模型'}…` })
    try {
      const imported = await viewerRef.current?.loadGltf(files)
      if (!imported) throw new Error('3D 場景尚未準備完成，請稍後再試。')
      setSelected({ kind: 'model', model: imported })
      setActiveTool('select')
      viewerRef.current?.setTransformMode(null)
      setGltfStatus({ phase: 'success', message: `已載入 ${imported.fileName}（${imported.format}）` })
      setProjectName((current) => current === '未命名專案' ? imported.name : current)
    } catch (cause) {
      setGltfStatus({
        phase: 'error',
        message: cause instanceof Error ? cause.message : 'GLB／GLTF 模型載入失敗。',
      })
    }
  }

  const selectGltfFiles = (input: HTMLInputElement) => {
    void loadGltfFiles(Array.from(input.files ?? []))
    input.value = ''
  }

  const changeTransformMode = (mode: string) => {
    setActiveTool(mode)
    viewerRef.current?.setTransformMode(mode === 'select' ? null : mode as TransformControlsMode)
  }

  const loadIfcFile = async (file: File, restoreTransforms?: IfcElementTransform[]) => {
    if (!file.name.toLowerCase().endsWith('.ifc')) {
      setError('目前只接受 .ifc 檔案。')
      setLoadState('error')
      return
    }
    setError('')
    ifcSourceRef.current = file
    pendingIfcTransformsRef.current = restoreTransforms ?? null
    if (restoreTransforms === undefined) setProjectName(file.name.replace(/\.ifc$/i, ''))
    setModel(null)
    setSelected(null)
    setElements([])
    elementsRef.current = []
    setProgress({ completed: 0, total: 0 })
    setLoadState('loading')
    try {
      const buffer = await file.arrayBuffer()
      viewerRef.current?.loadIfc(buffer, file.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法讀取選取的 IFC 檔案。')
      setLoadState('error')
    }
  }

  const selectFile = (file?: File) => {
    if (file) void loadIfcFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const saveProject = useCallback(async () => {
    try {
      setProjectMessage('正在整理場景變換並核對模型來源…')
      const ifcTransforms = viewerRef.current?.getIfcElementTransforms() ?? []
      const imported = viewerRef.current?.getImportedModelSnapshots() ?? []
      if (model && !ifcSourceRef.current) throw new Error('目前 IFC 原始檔案資訊遺失，請重新載入 IFC 後再儲存。')

      const ifcResource = model && ifcSourceRef.current
        ? await describeProjectResource(ifcSourceRef.current)
        : null
      const projectModels = await Promise.all(imported.map(async ({ info, files, transform }) => {
        const resources = await Promise.all(files.map((file) => describeProjectResource(file)))
        const mainFile = files.find((file) => file.name === info.fileName && /\.(glb|gltf)$/i.test(file.name))
        if (!mainFile) throw new Error(`找不到「${info.fileName}」的主模型檔，無法保存此專案。`)
        return {
          ...info,
          mainResourcePath: getGltfFilePath(mainFile),
          resources,
          transform,
        }
      }))
      const document: ProjectDocument = {
        format: 'bim-lightweight-viewer-project',
        version: 1,
        projectName,
        ifc: model && ifcResource ? {
          resource: ifcResource,
          schema: model.schema,
          elements: ifcTransforms,
        } : null,
        models: projectModels,
      }
      const contents = JSON.stringify(document, null, 2)
      const blob = new Blob([contents], { type: 'application/json' })
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = `${projectName === '未命名專案' ? 'bim-project' : projectName.replace(/\.(bimproj\.json|json)$/i, '')}.bimproj.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      setProjectMessage(`專案已下載：${anchor.download}`)
    } catch (cause) {
      setProjectMessage(cause instanceof Error ? `儲存失敗：${cause.message}` : '專案儲存失敗。')
    }
  }, [model, projectName])

  const restoreProject = async (document: ProjectDocument, resolved: Map<ProjectResource, FileWithPath>) => {
    const ifcFile = document.ifc ? resolved.get(document.ifc.resource) : undefined
    if (document.ifc && !ifcFile) throw new Error('找不到專案要求的 IFC 檔案。')
    viewerRef.current?.clearImportedModels()
    viewerRef.current?.clearIfc()
    setModel(null)
    setElements([])
    elementsRef.current = []
    setSelected(null)
    setLoadState('empty')
    setProjectName(document.projectName)
    pendingIfcTransformsRef.current = null
    ifcSourceRef.current = null

    if (ifcFile && document.ifc) await loadIfcFile(ifcFile, document.ifc.elements)
    for (const savedModel of document.models) {
      const modelFiles = savedModel.resources.map((resource) => resolved.get(resource)).filter((file): file is FileWithPath => Boolean(file))
      const mainFile = resolved.get(savedModel.resources.find((resource) => resource.path === savedModel.mainResourcePath)!)
      if (!mainFile || !modelFiles.includes(mainFile)) throw new Error(`缺少 GLTF 主模型「${savedModel.fileName}」或其相依檔案。`)
      const imported = await viewerRef.current?.loadGltf(modelFiles, {
        info: { id: savedModel.id, name: savedModel.name, fileName: savedModel.fileName, format: savedModel.format },
        transform: savedModel.transform,
      })
      if (!imported) throw new Error(`無法還原「${savedModel.fileName}」。`)
    }
    setAssets(document.models.map(({ id, name, fileName, format }) => ({ id, name, fileName, format })))
    if (!ifcFile && !document.models.length) viewerRef.current?.resetView()
    setProjectMessage(`專案「${document.projectName}」已開啟；IFC 元件變換會在模型解析完成後套用。`)
  }

  const openProjectFile = async (file?: File) => {
    if (!file) return
    if (projectInputRef.current) projectInputRef.current.value = ''
    try {
      const document = parseProjectDocument(await file.text())
      pendingProjectRef.current = document
      setPendingProject(document)
      setProjectName(document.projectName)
      const hasResources = Boolean(document.ifc) || document.models.length > 0
      if (!hasResources) {
        await restoreProject(document, new Map())
        pendingProjectRef.current = null
        setPendingProject(null)
      } else {
        const count = (document.ifc ? 1 : 0) + document.models.reduce((total, item) => total + item.resources.length, 0)
        setProjectMessage(`專案格式有效。請重新選取 ${count} 個原始模型／相依資源檔以還原幾何。`)
      }
    } catch (cause) {
      setProjectMessage(cause instanceof Error ? `開啟失敗：${cause.message}` : '無法開啟專案檔。')
    }
  }

  const selectProjectResources = async (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []) as FileWithPath[]
    input.value = ''
    const document = pendingProjectRef.current
    if (!document || !files.length) return
    try {
      setProjectMessage('正在核對所選模型檔案…')
      const result = await resolveProjectResources(document, files)
      if (result.missing.length) {
        setProjectMessage(`仍缺少或內容不符：${result.missing.join('、')}。請重新選取原始檔案。`)
        return
      }
      await restoreProject(document, result.resolved)
      pendingProjectRef.current = null
      setPendingProject(null)
    } catch (cause) {
      setProjectMessage(cause instanceof Error ? `還原失敗：${cause.message}` : '專案資源還原失敗。')
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveProject()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveProject])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">B</div>
          <div>
            <p className="eyebrow">BIM WORKSPACE</p>
            <h1>Lightweight Viewer</h1>
          </div>
        </div>
        <div className="project-title">
          <span className={`status-dot ${loadState === 'error' || gltfStatus.phase === 'error' ? 'error-dot' : ''}`} />
          <span>{projectName !== '未命名專案' ? projectName : model?.name ?? (assets.length ? `${assets.length} 個新增模型` : '未命名專案')}</span>
          <span className="unsaved-label">{model ? 'IFC 場景' : assets.length ? '3D 場景' : '本機專案'}</span>
        </div>
        <div className="topbar-actions">
          <button className="button button-quiet" type="button" onClick={() => projectInputRef.current?.click()}>開啟專案</button>
          <button className="button button-primary" type="button" onClick={() => fileInputRef.current?.click()}>匯入 IFC</button>
          <button className="button button-model" type="button" onClick={() => gltfInputRef.current?.click()} title="可多選 .gltf 的 .bin 與貼圖相依檔">匯入 GLB／GLTF</button>
          <button className="button button-quiet folder-import" type="button" onClick={() => gltfFolderInputRef.current?.click()} title="選取含有 .gltf 與外部資源的資料夾">GLTF 資料夾</button>
          <button className="button button-save" type="button" onClick={() => void saveProject()} title="Ctrl+S">儲存專案</button>
          <input
            accept=".json,.bimproj.json,application/json"
            className="visually-hidden"
            onChange={(event) => void openProjectFile(event.currentTarget.files?.[0])}
            ref={projectInputRef}
            type="file"
          />
          <input
            accept=".ifc,.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,application/octet-stream,image/*"
            className="visually-hidden"
            multiple
            onChange={(event) => void selectProjectResources(event.currentTarget)}
            ref={projectResourcesInputRef}
            type="file"
          />
          <input
            accept=".ifc,.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,application/octet-stream,image/*"
            className="visually-hidden"
            multiple
            onChange={(event) => void selectProjectResources(event.currentTarget)}
            ref={projectResourceFolderInputRef}
            type="file"
          />
          <input
            accept=".ifc,application/x-step"
            className="visually-hidden"
            onChange={(event) => selectFile(event.currentTarget.files?.[0])}
            ref={fileInputRef}
            type="file"
          />
          <input
            accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,model/gltf-binary,model/gltf+json,image/*,application/octet-stream"
            className="visually-hidden"
            multiple
            onChange={(event) => selectGltfFiles(event.currentTarget)}
            ref={gltfInputRef}
            type="file"
          />
          <input
            accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,model/gltf-binary,model/gltf+json,image/*,application/octet-stream"
            className="visually-hidden"
            multiple
            onChange={(event) => selectGltfFiles(event.currentTarget)}
            ref={gltfFolderInputRef}
            type="file"
          />
        </div>
      </header>

      <div className="workspace">
        <aside className="left-panel" aria-label="模型與物件面板">
          <div className="panel-tabs">
            <button className="panel-tab active" type="button">模型</button>
            <button className="panel-tab" type="button" disabled title="新增模型管理將於後續階段加入">物件</button>
          </div>

          <section className="panel-section model-section">
            <div className="section-heading">
              <div>
                <h2>模型來源</h2>
                <p>目前場景中的來源模型</p>
              </div>
              <span className="count-badge">{(model ? 1 : 0) + assets.length}</span>
            </div>
            {model ? (
              <div className="loaded-model-card">
                <span className="model-file-badge">IFC</span>
                <div className="loaded-model-details">
                  <strong title={model.name}>{model.name}</strong>
                  <span>{model.schema || 'IFC'} · {model.elementCount.toLocaleString()} 個元件</span>
                </div>
                <span className="loaded-check" aria-label="已載入">✓</span>
              </div>
            ) : (
              <div className="empty-model-card">
                <div className="file-icon" aria-hidden="true">▧</div>
                <strong>{loadState === 'loading' ? 'IFC 模型載入中' : '尚未載入模型'}</strong>
                <span>{loadState === 'loading' ? '正在背景解析幾何資料' : '選取或拖放 .ifc 檔案'}</span>
                {loadState === 'loading' ? (
                  <div className="side-progress"><i style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 2}%` }} /></div>
                ) : (
                  <button className="text-button" type="button" onClick={() => fileInputRef.current?.click()}>選擇 IFC 檔案 <span aria-hidden="true">＋</span></button>
                )}
              </div>
            )}
          </section>

          <section className="panel-section object-section">
            <div className="section-heading">
              <div>
                <h2>IFC 元件</h2>
                <p>{selected?.kind === 'ifc' ? '目前選取 IFC 元件' : '選取 IFC 元件以查看屬性'}</p>
              </div>
              <span className="count-badge muted">{elements.length.toLocaleString()}</span>
            </div>
            {elements.length ? (
              <div className="object-list">
                {elements.slice(0, 300).map((element) => (
                  <button
                    className={`object-row ${selected?.kind === 'ifc' && selected.element.expressId === element.expressId ? 'active' : ''}`}
                    key={element.expressId}
                    onClick={() => viewerRef.current?.selectIfcElement(element.expressId)}
                    type="button"
                    title={`${element.ifcType} · #${element.expressId}`}
                  >
                    <span className="object-row-icon">◫</span>
                    <span className="object-row-copy"><strong>{element.name}</strong><small>{element.ifcType}</small></span>
                  </button>
                ))}
                {elements.length > 300 && <p className="list-limit-note">清單先顯示 300 個元件；場景仍可選取全部 {elements.length.toLocaleString()} 個。</p>}
              </div>
            ) : (
              <div className="empty-list-message">載入 IFC 後，元件會顯示在這裡。</div>
            )}
          </section>

          <section className="panel-section imported-model-section">
            <div className="section-heading">
              <div><h2>新增模型</h2><p>可選取並變換的 GLB／GLTF</p></div>
              <span className="count-badge muted">{assets.length}</span>
            </div>
            {assets.length ? (
              <div className="object-list imported-model-list">
                {assets.map((asset) => (
                  <button
                    className={`object-row ${selected?.kind === 'model' && selected.model.id === asset.id ? 'active' : ''}`}
                    key={asset.id}
                    onClick={() => {
                      const selectedFromScene = viewerRef.current?.selectModel(asset.id) ?? false
                      if (!selectedFromScene) setProjectMessage(`無法選取「${asset.fileName}」：場景中的模型識別碼不存在。`)
                      changeTransformMode('select')
                    }}
                    type="button"
                    title={`${asset.format} · ${asset.fileName}`}
                  >
                    <span className="object-row-icon model-row-icon">{asset.format}</span>
                    <span className="object-row-copy"><strong>{asset.name}</strong><small>{asset.fileName}</small></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-list-message">匯入 GLB／GLTF 後，模型會列在這裡。</div>
            )}
          </section>

          <div className="panel-footer">
            <span className="footer-indicator" />
            <span>本機工作階段</span>
            <span className="privacy-note">IFC 在瀏覽器解析</span>
          </div>
        </aside>

        <section className="viewport-column" aria-label="3D 檢視器">
          <div className="viewport-toolbar">
            <div className="tool-group" role="toolbar" aria-label="物件操作工具">
              {tools.map((tool) => (
                <button
                  aria-label={tool.label}
                  className={`tool-button ${activeTool === tool.id ? 'selected' : ''}`}
                  disabled={tool.id === 'select' ? !model && assets.length === 0 : !selected}
                  key={tool.id}
                  onClick={() => changeTransformMode(tool.id)}
                  title={tool.id === 'select' ? '選取 IFC 元件或新增模型' : `在選取 GLB／GLTF 後使用${tool.label}控制器`}
                  type="button"
                >
                  <span aria-hidden="true">{tool.icon}</span>
                  <span className="tool-label">{tool.label}</span>
                </button>
              ))}
            </div>
            <div className="viewport-actions">
              <button className="icon-button" type="button" disabled={!model && assets.length === 0} onClick={() => viewerRef.current?.resetView()} title="重設視角" aria-label="重設視角">⤾</button>
              <button className="icon-button delete-model-button" type="button" disabled={selected?.kind !== 'model'} onClick={() => viewerRef.current?.deleteSelectedModel()} title="刪除選取的 GLB／GLTF 模型" aria-label="刪除選取模型">⌫</button>
              <button className="icon-button" type="button" disabled title="網格顯示設定將於後續階段加入" aria-label="網格設定">▦</button>
              <span className="toolbar-divider" />
              <button className="icon-button" type="button" disabled title="全螢幕模式將於後續階段加入" aria-label="全螢幕">⛶</button>
            </div>
          </div>

          <div
            className={`viewport-frame ${draggingFile ? 'dragging-file' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDraggingFile(true) }}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingFile(false) }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              setDraggingFile(false)
              const files = Array.from(event.dataTransfer.files)
              if (files.some((file) => /\.(glb|gltf)$/i.test(file.name))) void loadGltfFiles(files)
              else selectFile(files[0])
            }}
          >
            {projectMessage && (
              <div className="project-message" role={projectMessage.includes('失敗') || projectMessage.includes('缺少') || projectMessage.includes('不符') ? 'alert' : 'status'} aria-live="polite">
                <span>{projectMessage}</span>
                {pendingProject && (
                  <div className="project-resource-actions">
                    <button type="button" onClick={() => projectResourcesInputRef.current?.click()}>選取資源檔案</button>
                    <button type="button" onClick={() => projectResourceFolderInputRef.current?.click()}>選取資源資料夾</button>
                  </div>
                )}
              </div>
            )}
            <ViewerCanvas
              onComplete={onComplete}
              onElement={onElement}
              onModelsChange={onModelsChange}
              onError={onError}
              onProgress={onProgress}
              onSelect={onSelect}
              ref={viewerRef}
            />
            {!model && assets.length === 0 && loadState !== 'loading' && gltfStatus.phase !== 'loading' && (
              <div className="viewport-empty-state">
                <div className="empty-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 48 48" fill="none">
                    <path d="m24 5 18 10v18L24 43 6 33V15L24 5Z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="m6.5 15.5 17.5 10 17.5-10M24 26v16M15 10l18 10v8" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </div>
                <h2>{loadState === 'error' ? '模型載入失敗' : '準備好檢視你的模型'}</h2>
                <p>{loadState === 'error' ? error : '拖放 IFC、GLB 或 GLTF 檔案至此，或使用上方匯入按鈕。模型只會在你的瀏覽器中解析。'}</p>
                {loadState === 'error' && <button className="text-button" type="button" onClick={() => fileInputRef.current?.click()}>重新選擇檔案</button>}
                {!error && <div className="supported-formats"><span>.IFC</span><span>.GLB</span><span>.GLTF</span></div>}
              </div>
            )}
            {(loadState === 'loading' || gltfStatus.phase === 'loading') && (
              <div className="loading-card" role="status" aria-live="polite">
                <span className="loading-spinner" />
                <strong>{loadState === 'loading' ? '正在解析 IFC 幾何' : '正在載入 GLB／GLTF 模型'}</strong>
                <span>{loadState === 'loading' ? (progress.total ? `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} 個元件` : '啟動 WebAssembly 解析器…') : gltfStatus.message}</span>
                {loadState === 'loading' && <div className="main-progress"><i style={{ width: `${progress.total ? Math.max(2, (progress.completed / progress.total) * 100) : 2}%` }} /></div>}
              </div>
            )}
            {gltfStatus.phase !== 'idle' && gltfStatus.phase !== 'loading' && (
              <div className={`gltf-status gltf-status-${gltfStatus.phase}`} role={gltfStatus.phase === 'error' ? 'alert' : 'status'} aria-live="polite">{gltfStatus.message}</div>
            )}
            {draggingFile && <div className="drop-overlay">放開以載入 IFC 檔案</div>}
            <div className="viewport-hint"><span className="mouse-symbol">◉</span> 拖曳旋轉 <span>·</span> Shift + 拖曳平移 <span>·</span> 滾輪縮放</div>
            <div className="axis-widget" aria-label="座標軸示意">
              <span className="axis-y">Y</span><span className="axis-x">X</span><span className="axis-z">Z</span>
              <i className="axis-line axis-line-y" /><i className="axis-line axis-line-x" /><i className="axis-line axis-line-z" />
            </div>
          </div>
          <footer className="statusbar">
            <div><span className={`status-dot subtle ${loadState === 'error' || gltfStatus.phase === 'error' ? 'error-dot' : ''}`} />{loadState === 'loading' || gltfStatus.phase === 'loading' ? '正在載入' : loadState === 'error' || gltfStatus.phase === 'error' ? '載入失敗' : loadState === 'ready' || assets.length ? '模型已載入' : '場景就緒'} <span className="status-separator">/</span> {model?.schema ?? (assets.length ? `${assets.length} 個新增模型` : '尚無模型')}</div>
            <div className="statusbar-right"><span>透視視角</span><span className="status-separator">·</span><span>公尺</span></div>
          </footer>
        </section>

        <aside className="right-panel" aria-label="屬性面板">
          <div className="properties-heading">
            <h2>IFC 屬性</h2>
          {selected && <button className="clear-selection" type="button" onClick={() => selected.kind === 'ifc' ? viewerRef.current?.selectIfcElement(-1) : viewerRef.current?.selectModel('')}>取消選取</button>}
          </div>
          {selected?.kind === 'ifc' ? (
            <div className="selected-properties">
              <div className="selected-object-heading">
                <span className="selected-object-icon">◫</span>
                <div><strong>{selected.element.name}</strong><span>{selected.element.ifcType}</span></div>
              </div>
              <div className="property-group">
                <p className="property-group-title">識別資訊</p>
                <div className="property-row"><span>Express ID</span><code>#{selected.element.expressId}</code></div>
                <div className="property-row"><span>Global ID</span><code title={selected.element.guid}>{selected.element.guid}</code></div>
              </div>
              <div className="property-group">
                <p className="property-group-title">IFC 屬性</p>
                {Object.entries(selected.element.attributes).filter(([key]) => key !== 'GlobalId').map(([key, value]) => (
                  <div className="property-row" key={key}><span>{key}</span><code title={value}>{value}</code></div>
                ))}
                {!Object.keys(selected.element.attributes).some((key) => key !== 'GlobalId') && <p className="no-properties">這個元件沒有可顯示的基本屬性。</p>}
              </div>
            </div>
          ) : selected?.kind === 'model' ? (
            <div className="selected-properties">
              <div className="selected-object-heading">
                <span className="selected-object-icon">3D</span>
                <div><strong>{selected.model.name}</strong><span>新增的 {selected.model.format} 模型</span></div>
              </div>
              <div className="property-group">
                <p className="property-group-title">模型資訊</p>
                <div className="property-row"><span>檔案</span><code title={selected.model.fileName}>{selected.model.fileName}</code></div>
                <div className="property-row"><span>格式</span><code>{selected.model.format}</code></div>
                <div className="property-row"><span>識別碼</span><code title={selected.model.id}>{selected.model.id.slice(0, 8)}…</code></div>
              </div>
              <div className="asset-operation-hint">使用工具列移動、旋轉或縮放；按刪除按鈕可移除此新增模型。</div>
            </div>
          ) : (
            <div className="properties-empty">
              <div className="select-target" aria-hidden="true">⌖</div>
              <strong>尚未選取物件</strong>
              <p>在 3D 場景或左側清單選取元件，即可查看 IFC 屬性。</p>
            </div>
          )}
          <div className="help-card">
            <div className="help-card-icon" aria-hidden="true">⌘</div>
            <div><strong>操作小提示</strong><p>左鍵拖曳旋轉；Shift + 左鍵拖曳平移；滾輪縮放。</p></div>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default App
