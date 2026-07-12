"use strict";
/* ============================================================
 * 開源風洞 · D2Q9 Lattice Boltzmann 氣流模擬核心
 * 純 JavaScript、零依賴。晶格單位:dx = dt = 1。
 * 九個離散速度方向:靜止、東西南北、四個對角。
 * ============================================================ */

const FOUR9  = 4 / 9;
const ONE9   = 1 / 9;
const ONE36  = 1 / 36;

class LBM {
  constructor(xdim, ydim) {
    this.u0 = 0.08;          // 進流速度(晶格單位,建議 <= 0.12)
    this.viscosity = 0.02;   // 運動黏滯度(晶格單位)
    this.resize(xdim, ydim);
  }

  resize(xdim, ydim) {
    this.xdim = xdim;
    this.ydim = ydim;
    const n = xdim * ydim;
    // 九方向分布函數
    this.n0  = new Float32Array(n);
    this.nN  = new Float32Array(n);
    this.nS  = new Float32Array(n);
    this.nE  = new Float32Array(n);
    this.nW  = new Float32Array(n);
    this.nNE = new Float32Array(n);
    this.nSE = new Float32Array(n);
    this.nNW = new Float32Array(n);
    this.nSW = new Float32Array(n);
    // 巨觀量
    this.rho = new Float32Array(n);
    this.ux  = new Float32Array(n);
    this.uy  = new Float32Array(n);
    this.curl = new Float32Array(n);
    this.barrier = new Uint8Array(n);
    this.initFluid();
  }

  get omega() { return 1 / (3 * this.viscosity + 0.5); }

  /** 將格點 i 設為速度 (ux,uy)、密度 rho 的平衡分布 */
  setEquilibrium(i, ux, uy, rho) {
    const ux3 = 3 * ux, uy3 = 3 * uy;
    const ux2 = ux * ux, uy2 = uy * uy;
    const uxuy2 = 2 * ux * uy;
    const u215 = 1.5 * (ux2 + uy2);
    this.n0[i]  = FOUR9 * rho * (1 - u215);
    this.nE[i]  = ONE9  * rho * (1 + ux3 + 4.5 * ux2 - u215);
    this.nW[i]  = ONE9  * rho * (1 - ux3 + 4.5 * ux2 - u215);
    this.nN[i]  = ONE9  * rho * (1 + uy3 + 4.5 * uy2 - u215);
    this.nS[i]  = ONE9  * rho * (1 - uy3 + 4.5 * uy2 - u215);
    this.nNE[i] = ONE36 * rho * (1 + ux3 + uy3 + 4.5 * (ux2 + uxuy2 + uy2) - u215);
    this.nSE[i] = ONE36 * rho * (1 + ux3 - uy3 + 4.5 * (ux2 - uxuy2 + uy2) - u215);
    this.nNW[i] = ONE36 * rho * (1 - ux3 + uy3 + 4.5 * (ux2 - uxuy2 + uy2) - u215);
    this.nSW[i] = ONE36 * rho * (1 - ux3 - uy3 + 4.5 * (ux2 + uxuy2 + uy2) - u215);
    this.rho[i] = rho;
    this.ux[i] = ux;
    this.uy[i] = uy;
  }

  /** 全場重置為均勻進流 */
  initFluid() {
    const n = this.xdim * this.ydim;
    for (let i = 0; i < n; i++) this.setEquilibrium(i, this.u0, 0, 1);
  }

  /** 進流(左)、出流(右)、上下邊界 */
  setBoundaries() {
    const { xdim, ydim, u0 } = this;
    for (let x = 0; x < xdim; x++) {
      this.setEquilibrium(x, u0, 0, 1);                       // 下緣
      this.setEquilibrium(x + (ydim - 1) * xdim, u0, 0, 1);   // 上緣
    }
    for (let y = 1; y < ydim - 1; y++) {
      this.setEquilibrium(y * xdim, u0, 0, 1);                // 左緣:固定進流
      // 右緣:零梯度出流(複製內側一格)
      const d = xdim - 1 + y * xdim, s = d - 1;
      this.n0[d] = this.n0[s];  this.nN[d] = this.nN[s];  this.nS[d] = this.nS[s];
      this.nE[d] = this.nE[s];  this.nW[d] = this.nW[s];
      this.nNE[d] = this.nNE[s]; this.nSE[d] = this.nSE[s];
      this.nNW[d] = this.nNW[s]; this.nSW[d] = this.nSW[s];
    }
  }

  /** BGK 碰撞:所有分布向局部平衡鬆弛 */
  collide() {
    const { xdim, ydim } = this;
    const omega = this.omega;
    const n0 = this.n0, nN = this.nN, nS = this.nS, nE = this.nE, nW = this.nW,
          nNE = this.nNE, nSE = this.nSE, nNW = this.nNW, nSW = this.nSW,
          rho = this.rho, ux = this.ux, uy = this.uy, barrier = this.barrier;
    for (let y = 1; y < ydim - 1; y++) {
      for (let x = 1; x < xdim - 1; x++) {
        const i = x + y * xdim;
        if (barrier[i]) continue;
        const thisrho = n0[i] + nN[i] + nS[i] + nE[i] + nW[i] + nNW[i] + nNE[i] + nSW[i] + nSE[i];
        const thisux = (nE[i] + nNE[i] + nSE[i] - nW[i] - nNW[i] - nSW[i]) / thisrho;
        const thisuy = (nN[i] + nNE[i] + nNW[i] - nS[i] - nSE[i] - nSW[i]) / thisrho;
        rho[i] = thisrho; ux[i] = thisux; uy[i] = thisuy;
        const one9rho = ONE9 * thisrho, one36rho = ONE36 * thisrho;
        const ux3 = 3 * thisux, uy3 = 3 * thisuy;
        const ux2 = thisux * thisux, uy2 = thisuy * thisuy;
        const uxuy2 = 2 * thisux * thisuy;
        const u215 = 1.5 * (ux2 + uy2);
        n0[i]  += omega * (FOUR9 * thisrho * (1 - u215) - n0[i]);
        nE[i]  += omega * (one9rho * (1 + ux3 + 4.5 * ux2 - u215) - nE[i]);
        nW[i]  += omega * (one9rho * (1 - ux3 + 4.5 * ux2 - u215) - nW[i]);
        nN[i]  += omega * (one9rho * (1 + uy3 + 4.5 * uy2 - u215) - nN[i]);
        nS[i]  += omega * (one9rho * (1 - uy3 + 4.5 * uy2 - u215) - nS[i]);
        nNE[i] += omega * (one36rho * (1 + ux3 + uy3 + 4.5 * (ux2 + uxuy2 + uy2) - u215) - nNE[i]);
        nSE[i] += omega * (one36rho * (1 + ux3 - uy3 + 4.5 * (ux2 - uxuy2 + uy2) - u215) - nSE[i]);
        nNW[i] += omega * (one36rho * (1 - ux3 + uy3 + 4.5 * (ux2 - uxuy2 + uy2) - u215) - nNW[i]);
        nSW[i] += omega * (one36rho * (1 - ux3 - uy3 + 4.5 * (ux2 + uxuy2 + uy2) - u215) - nSW[i]);
      }
    }
  }

  /** 平流:分布沿各自方向移動一格(掃描方向避免覆蓋) */
  stream() {
    const { xdim, ydim } = this;
    const nN = this.nN, nS = this.nS, nE = this.nE, nW = this.nW,
          nNE = this.nNE, nSE = this.nSE, nNW = this.nNW, nSW = this.nSW;
    for (let y = ydim - 2; y > 0; y--) {          // 向北移動:由上往下掃
      for (let x = 1; x < xdim - 1; x++) {
        nN[x + y * xdim]  = nN[x + (y - 1) * xdim];
        nNW[x + y * xdim] = nNW[x + 1 + (y - 1) * xdim];
      }
    }
    for (let y = ydim - 2; y > 0; y--) {          // 向東北:由右上往左下
      for (let x = xdim - 2; x > 0; x--) {
        nE[x + y * xdim]  = nE[x - 1 + y * xdim];
        nNE[x + y * xdim] = nNE[x - 1 + (y - 1) * xdim];
      }
    }
    for (let y = 1; y < ydim - 1; y++) {          // 向南
      for (let x = xdim - 2; x > 0; x--) {
        nS[x + y * xdim]  = nS[x + (y + 1) * xdim];
        nSE[x + y * xdim] = nSE[x - 1 + (y + 1) * xdim];
      }
    }
    for (let y = 1; y < ydim - 1; y++) {          // 向西南
      for (let x = 1; x < xdim - 1; x++) {
        nW[x + y * xdim]  = nW[x + 1 + y * xdim];
        nSW[x + y * xdim] = nSW[x + 1 + (y + 1) * xdim];
      }
    }
  }

  /** 障礙物無滑移邊界:半程反彈 */
  bounce() {
    const { xdim, ydim } = this;
    const nN = this.nN, nS = this.nS, nE = this.nE, nW = this.nW,
          nNE = this.nNE, nSE = this.nSE, nNW = this.nNW, nSW = this.nSW,
          barrier = this.barrier;
    for (let y = 1; y < ydim - 1; y++) {
      for (let x = 1; x < xdim - 1; x++) {
        const i = x + y * xdim;
        if (!barrier[i]) continue;
        nE[x + 1 + y * xdim]        = nW[i];
        nW[x - 1 + y * xdim]        = nE[i];
        nN[x + (y + 1) * xdim]      = nS[i];
        nS[x + (y - 1) * xdim]      = nN[i];
        nNE[x + 1 + (y + 1) * xdim] = nSW[i];
        nNW[x - 1 + (y + 1) * xdim] = nSE[i];
        nSE[x + 1 + (y - 1) * xdim] = nNW[i];
        nSW[x - 1 + (y - 1) * xdim] = nNE[i];
      }
    }
  }

  step() {
    this.setBoundaries();
    this.collide();
    this.stream();
    this.bounce();
  }

  /** 渦度(速度旋度的 z 分量),僅供顯示 */
  computeCurl() {
    const { xdim, ydim, ux, uy, curl } = this;
    for (let y = 1; y < ydim - 1; y++) {
      for (let x = 1; x < xdim - 1; x++) {
        const i = x + y * xdim;
        curl[i] = uy[i + 1] - uy[i - 1] - ux[i + xdim] + ux[i - xdim];
      }
    }
  }

  /** 數值是否發散(抽樣檢查) */
  diverged() {
    const { xdim, ydim, rho } = this;
    const samples = [
      (xdim >> 1) + (ydim >> 1) * xdim,
      (xdim >> 2) + (ydim >> 2) * xdim,
      (xdim - 2) + (ydim - 2) * xdim,
    ];
    for (const i of samples) {
      const r = rho[i];
      if (!isFinite(r) || r <= 0 || r > 10) return true;
    }
    return false;
  }

  /* ---------- 障礙物編輯 ---------- */

  clearBarriers() { this.barrier.fill(0); }

  /** 以 (cx,cy) 為中心、半徑 r 畫/擦圓形筆刷 */
  paint(cx, cy, r, erase) {
    const { xdim, ydim, barrier } = this;
    const r2 = r * r;
    const x0 = Math.max(1, Math.floor(cx - r)), x1 = Math.min(xdim - 2, Math.ceil(cx + r));
    const y0 = Math.max(1, Math.floor(cy - r)), y1 = Math.min(ydim - 2, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = x + y * xdim;
          barrier[i] = erase ? 0 : 1;
          if (erase) this.setEquilibrium(i, this.u0, 0, 1);
        }
      }
    }
  }

  /** 障礙物在 y 方向的跨度(估計特徵長度,算雷諾數用) */
  barrierHeight() {
    const { xdim, ydim, barrier } = this;
    let ymin = ydim, ymax = -1;
    for (let y = 1; y < ydim - 1; y++) {
      for (let x = 1; x < xdim - 1; x++) {
        if (barrier[x + y * xdim]) {
          if (y < ymin) ymin = y;
          if (y > ymax) ymax = y;
          break;
        }
      }
    }
    return ymax < ymin ? 0 : ymax - ymin + 1;
  }
}
