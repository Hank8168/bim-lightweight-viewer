# React + TypeScript + Vite

## 專案儲存與還原

「儲存專案」或 `Ctrl+S` 會下載 `.bimproj.json`，檔名使用目前專案名稱（新場景預設依 IFC／GLTF 名稱）。每次儲存都會產生一個下載檔，使用者可在瀏覽器下載位置選擇覆蓋或保留副本。使用「開啟專案」選取 JSON 後，若清單中的 IFC／GLB／GLTF 資源不在瀏覽器可直接存取的位置，按提示重新選取原始檔與 `.gltf` 相依檔。檔名、大小及 SHA-256 都會核對，避免把錯誤的模型套上舊的變換。

JSON 保存 IFC 元件的 GlobalId／Express ID 與變換，以及新增模型識別、來源檔清單與變換；不包含 IFC、GLB 的幾何二進位內容。它還原的是瀏覽器場景狀態，不會修改或輸出已編輯的 IFC 原始檔。模型檔案已移動時須重新選取；被刪除或內容不同的來源會明確提示。大型來源只在計算 SHA-256 時讀取，不會轉成 Base64 塞進 JSON。

目前可使用工具列對選取的 IFC 元件與 GLB／GLTF 模型套用移動、旋轉及縮放。

## GLB／GLTF 匯入

使用「匯入 GLB／GLTF」選取單一 `.glb`／`.gltf` 模型；`.gltf` 的 `.bin` 與貼圖可在同一檔案選擇器中一併多選，或用「GLTF 資料夾」選取整個資料夾以保留子目錄路徑。缺少或無法唯一辨識的外部資源會顯示錯誤。模型可從左側「新增模型」清單或 3D 畫布選取，再用工具列移動、旋轉、縮放；刪除按鈕只會移除所選新增模型。

主要驗收模型為 `tests/assets/BasePalmTree01.glb`。資產來源及 CC0 登錄資訊見 [tests/assets/ASSET_SOURCES.md](tests/assets/ASSET_SOURCES.md)；二進位測試檔因約 13 MB 而由 `.gitignore` 排除，測試前需先取得該檔案。

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
