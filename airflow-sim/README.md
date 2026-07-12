# 🌬️ 開源風洞 · 瀏覽器氣流模擬

一個**完全免費、開源、跑在瀏覽器裡**的 2D 即時氣流模擬器。
不需要商業授權、不需要安裝、不需要 GPU 或伺服器 —— 一般筆電 CPU 就能 60fps 即時互動。

## 怎麼用

直接用瀏覽器打開 `index.html`,或啟動任一靜態伺服器:

```bash
cd airflow-sim
python3 -m http.server 8000
# 打開 http://localhost:8000
```

## 功能

- **即時 2D 風洞**:左側進流、右側出流,氣流繞過障礙物
- **手繪障礙物**:滑鼠/觸控直接在畫面上繪製、擦除任意形狀
- **預設場景**:圓柱(卡門渦街)、垂直平板、機翼、建築縫隙風
- **三種視覺化**:渦度、流速、密度(≈壓力),外加煙流粒子
- **可調參數**:風速、黏滯度、解析度、模擬速度、對比
- **即時讀數**:FPS 與估計雷諾數
- 數值發散時自動重置並提示

## 原理

採用 **Lattice Boltzmann 方法(LBM,D2Q9)**:

1. 空間切成均勻格點,每格追蹤 9 個離散方向的粒子分布函數
2. **碰撞**:各分布以 BGK 單鬆弛模型向局部 Maxwell 平衡鬆弛(鬆弛率由黏滯度決定)
3. **平流**:分布沿各自方向移動到鄰格
4. 障礙物用**半程反彈(bounce-back)**實現無滑移邊界

在低馬赫數極限下,LBM 可證明等價於不可壓縮 Navier–Stokes 方程,
而且演算法只有局部運算,非常適合即時互動。

## 定位與限制

這是**教學 / 概念驗證級**工具,適合:直覺理解流體現象、快速試形狀、教學展示。

它是 2D、低雷諾數、晶格單位的模擬,**不能取代工程級 CFD**。
需要工程精度時,建議搭配這些同樣免費開源的工具:

| 工具 | 說明 |
|---|---|
| [OpenFOAM](https://www.openfoam.com/) | 工業級 3D CFD 標準,功能最完整 |
| [SU2](https://su2code.github.io/) | 史丹佛開源,擅長空氣動力學/可壓縮流 |
| [SimFlow](https://sim-flow.com/) / [HELYX-OS](https://engys.com/) | OpenFOAM 的免費圖形介面 |
| [FreeCAD + CfdOF](https://github.com/jaheyns/CfdOF) | 在 FreeCAD 裡建模並直接跑 OpenFOAM |

## 技術

純 HTML / CSS / 原生 JavaScript,零依賴。

```
index.html      介面
css/style.css   樣式
js/sim.js       LBM 模擬核心(D2Q9、BGK 碰撞、反彈邊界)
js/main.js      渲染、控制項、障礙物編輯、煙流粒子
```
