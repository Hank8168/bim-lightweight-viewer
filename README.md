# BIM Lightweight Viewer

純瀏覽器端的BIM 3D檢視器，使用React、TypeScript、Vite、Three.js與 web-ifc，IFC 由Web Worker/WASM 在瀏覽器解析，GLB／GLTF使用Three.js GLTFLoader載入，專案不需要自建後端

## 功能與驗收狀態

- IFC元件可在畫布中選取及高亮；點空白處可取消選取，物件清單與屬性面板同步更新
- Orbit相機可旋轉、平移及縮放
- 可使用工具操作選取物件的移動、旋轉及縮放
- 專案可儲存及重新開啟，Ctrl+S可執行儲存
- 實測GLB變換後以Ctrl+S儲存，再重新開啟並選取相同GLB；位置、旋轉及縮放比例正確還原
- GLB／GLTF可匯入、選取、移動、旋轉、縮放及刪除，刪除後清單會更新

## 安裝與啟動

**環境需求：** Node.js與npm，本專案開發環境使用Node.js v24.22.0、npm 11.19.1

### 1. 安裝相依套件

在終端機切換至專案根目錄，執行：

```bash
npm ci
```

此指令會依據 `package-lock.json` 安裝專案所需的相依套件。本次開發已成功執行 `npm ci`，完成相依套件安裝

### 2. 啟動開發伺服器

```bash
npm run dev
```

啟動成功後，開啟 Vite 顯示的本機網址，即可在瀏覽器中使用BIM檢視器

**Windows PowerShell 注意事項：** 若執行 `npm` 時出現PowerShell執行原則錯誤，可改用以下指令：

```powershell
npm.cmd ci
npm.cmd run dev
```

### 3. 建置與預覽正式版

建置正式版：

```bash
npm run build
```

預覽建置結果：

```bash
npm run preview
```

若在 Windows PowerShell 遇到相同的執行原則問題，也可以將上述指令中的 `npm` 改為 `npm.cmd`

## 操作方式

- 使用「匯入IFC」選取 `.ifc`
- 使用「匯入GLB／GLTF」選擇模型，`.gltf` 外部 `.bin`／貼圖需一併選取，或使用「GLTF資料夾」保留相對路徑
- 在畫布或清單選取物件，再由工具列選擇移動、旋轉或縮放，Orbit相機操作為拖曳旋轉、Shift+拖曳平移、滾輪縮放
- 「儲存專案」或 Ctrl+S 下載 `.bimproj.json`；「開啟專案」讀取專案，若原始模型檔不在瀏覽器可讀取位置，依提示重新選取模型檔及相依資源
- 刪除操作只作用於新增的GLB／GLTF 模型，不會刪除 IFC 原始元件

## 專案格式與限制

專案JSON保存IFC元件識別資訊與變換，以及GLB／GLTF的識別、來源資訊與變換。JSON不包含模型幾何二進位資料；重新開啟時需要原始資源，來源透過路徑、檔名、大小與SHA-256核對，這是場景狀態保存，不會將編輯寫回 IFC 原始檔。

## 技術選擇

- React + TypeScript：管理檢視器介面、載入狀態、選取與專案資料型別。
- Vite：本機開發伺服器與前端建置
- Three.js：場景、WebGL幾何、OrbitControls、TransformControls 與 GLTFLoader
- web-ifc：瀏覽器端IFC/WASM解析，Worker負責解析與傳遞幾何資料，避免主UI執行緒直接承擔解析工作
- JSON專案檔搭配重新選取原始資源：避免將大型二進位幾何轉成巨大JSON；SHA-256用來確認資源內容

## 檢查指令

```bash
npm run build
npm run lint
npx tsc -b
npm test
```

最近一次記錄的結果為：`npm ci`、build、lint、TypeScript 均通過；`npm test` 的8個單元測試、IFC smoke（12個元素／12個幾何片段）與 GLB smoke（1個mesh／1個node）均通過。這些命令列結果不取代使用者的瀏覽器操作驗收

更多開發與AI協作紀錄見 [docs/DEVELOPMENT_REPORT.md](docs/DEVELOPMENT_REPORT.md) 與 [docs/AI_USAGE.md](docs/AI_USAGE.md)
