# 資產管理系統（cgu-coic-asset）

系上固定資產與保管品的管理系統：資產清冊、QR 貼紙、掃碼盤點、借用歸還、盤點資料表列印。

- 網址：<https://cgu-coic-asset.github.io/>
- 資料與照片存放在單位專用 Google 帳號（試算表＋雲端硬碟），**本 repo 不含任何學校資料**。

## 結構

| 資料夾 | 內容 |
| --- | --- |
| `web/` | 前端網頁（GitHub Pages） |
| `shared/` | 前後端共用的純 JavaScript 業務邏輯（有單元測試） |
| `gas/` | Apps Script 後端，以 clasp 推送到專用 Google 帳號 |

推送到 `main` 後，GitHub Actions 會把 `web/` 與 `shared/` 部署到 GitHub Pages。

## 後端（Apps Script）

- 專案屬於單位專用 Google 帳號，`clasp` 需以該帳號登入（`clasp login`）。
- 改完 `gas/` 後執行 `./deploy.sh "說明"`：推送程式並更新同一個部署，`/exec` 網址不變。
- 後端網址記在 `web/config.json`；交接或換帳號時只改這個檔案。

## 交接

本組織至少保持兩位擁有者。程式碼跟著組織走，資料跟著專用 Google 帳號走；交接步驟見管理者 SOP。

存放帳號救不回來、要在新帳號重建時，照 [docs/重建步驟.md](docs/重建步驟.md)。
