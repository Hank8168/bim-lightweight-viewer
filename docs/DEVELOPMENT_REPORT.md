# 開發專案描述

## 專案摘要

本專案以 React、TypeScript、Vite、Three.js 與 web-ifc 建立純瀏覽器端 BIM 檢視器。IFC 透過 Worker 與 WASM 解析；Three.js 管理場景、相機、物件選取及變換；GLTFLoader 載入 GLB／GLTF。專案 JSON 保存場景狀態與資源識別，不嵌入 IFC／GLB 二進位幾何

## 功能成果

依使用者親自操作後提供的驗收結果，以下介面行為標記為使用者實測通過：

- IFC物件可在畫布中選取、高亮及取消選取，物件清單與屬性面板同步
- Orbit相機旋轉、平移及縮放
- 物件移動、旋轉及縮放控制器實際操作
- 專案儲存、重新開啟及Ctrl+S
- GLB／GLTF匯入、選取、移動、旋轉、縮放、刪除，以及清單同步更新
- 使用者確認GLB經移動、旋轉、縮放後以 Ctrl+S 儲存，再重新開啟專案並重新選取相同GLB，位置、旋轉角度及縮放比例均正確還原

## 架構與保存方式

- React的`App`管理 UI、檔案選擇、載入狀態與專案流程
- `ViewerCanvas`管理Three.js場景、IFC元件、GLTF模型、選取與控制器
- `ifc.worker.ts`透過web-ifc解析IFC，將幾何及載入進度回傳給主執行緒
- `gltf/resources.ts`處理 GLTF 相依資源路徑
- `project/project.ts`定義JSON欄位、格式驗證與SHA-256資源比對
- 專案重新開啟時需選回原始模型資源；這避免把大型模型二進位重複寫入 JSON，也表示 JSON 本身不能單獨重建模型幾何

場景變換不會寫回原始IFC檔。專案格式目前版本為1；未記錄為長期穩定或跨版本相容格式。

## 測試紀錄

以下為本次交付前驗證的實際結果：

| 指令 | 結果 |
|---|---|
| `npm.cmd ci` | 第二次執行成功，added 169 packages、audited 170 packages、0 vulnerabilities。第一次在一般權限執行時 registry fetch 回報 EACCES，並有 node_modules 清理 EPERM 警告；在允許提升權限後重試成功 |
| `npm.cmd run build` | 通過；Vite 顯示一個 minified bundle 大於 500 kB 的警告 |
| `npm.cmd run lint` | 通過 |
| `npx.cmd tsc -b` | 通過   |
| `npm.cmd test` | 通過：8 個單元測試、IFC smoke（IFC4、12 個元素、12 個幾何片段）及 GLB smoke（1 個 mesh、1 個 node） |
| `node tests/ifc-smoke.mjs` | 單獨通過：IFC4、12 個元素、12 個幾何片段 |
| `node tests/gltf-smoke.mjs` | 單獨通過：1 個 mesh、1 個 node，檔案 13,356,104 bytes   |