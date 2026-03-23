export function initCanvasDrag() {
  const drawingBoard = document.getElementById('drawing-board');
  if (!drawingBoard) return;

  // 关键：让 drawingBoard 自己成为绝对定位子元素的参照物
  drawingBoard.style.position = 'relative';
  drawingBoard.style.overflow = 'hidden';

  if (drawingBoard.parentElement) {
    drawingBoard.parentElement.style.position = 'relative';
  }

  let droppedImages = [];
  let draggingImg = null;
  let dragOffset = { x: 0, y: 0 };
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3;

  let dragStartMouse = { x: 0, y: 0 };
  let dragStartPos = { x: 0, y: 0 };
  let dragRAF = null;
  let pendingDragPos = null;

  const SCREEN_DPR = window.devicePixelRatio || 4;

  // mask 画布分辨率，建议至少 2
  const MASK_DPR = Math.max(2, SCREEN_DPR);

  // 导出最大倍率，防止太大爆内存
  const MAX_EXPORT_SCALE = 8;

  const ENABLE_LIGHT_SR = true;

  // 最多把原图先放大到原始尺寸的多少倍，参数可改
  const SR_MAX_SOURCE_UPSCALE = 2.5;
  // 分步放大倍率，1.4~1.8 比较稳
  const SR_STEP_RATIO = 1.6;
  // 锐化强度，0.25~0.55 比较自然
  const SR_SHARPEN_AMOUNT = 0.42;
  // 低于这个差值的细节不增强，防止噪点
  const SR_EDGE_THRESHOLD = 4;
  // 缓存，避免重复导出反复算
  const srCache = new Map();

function createWorkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function loadImageAsync(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function progressiveUpscale(source, targetW, targetH) {
  const srcW = source.naturalWidth || source.width;
  const srcH = source.naturalHeight || source.height;

  let current = createWorkCanvas(srcW, srcH);
  let ctx = current.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, srcW, srcH);

  while (current.width < targetW || current.height < targetH) {
    const nextW = Math.min(
      targetW,
      Math.max(current.width + 1, Math.round(current.width * SR_STEP_RATIO))
    );
    const nextH = Math.min(
      targetH,
      Math.max(current.height + 1, Math.round(current.height * SR_STEP_RATIO))
    );

    const next = createWorkCanvas(nextW, nextH);
    const nctx = next.getContext('2d', { willReadFrequently: true });
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(current, 0, 0, current.width, current.height, 0, 0, nextW, nextH);
    current = next;
  }

  return current;
}

function applyLumaUnsharp(canvas, amount = SR_SHARPEN_AMOUNT, threshold = SR_EDGE_THRESHOLD) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const size = width * height;
  const luma = new Float32Array(size);
  const blur = new Float32Array(size);

  // 亮度
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    luma[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  // 很轻的 3x3 平滑
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;

      for (let ky = -1; ky <= 1; ky++) {
        const yy = Math.max(0, Math.min(height - 1, y + ky));
        for (let kx = -1; kx <= 1; kx++) {
          const xx = Math.max(0, Math.min(width - 1, x + kx));
          sum += luma[yy * width + xx];
          count++;
        }
      }

      blur[y * width + x] = sum / count;
    }
  }

  // 仅增强亮度边缘，减少彩边
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    const diff = luma[i] - blur[i];
    if (Math.abs(diff) < threshold) continue;

    const boost = diff * amount;
    data[p] = Math.max(0, Math.min(255, data[p] + boost));
    data[p + 1] = Math.max(0, Math.min(255, data[p + 1] + boost));
    data[p + 2] = Math.max(0, Math.min(255, data[p + 2] + boost));
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

async function buildLightSRSource(item, scale) {
  const src = item.originalSrc || item.element.src;

  const displayW = item.element.offsetWidth || parseFloat(item.element.style.width) || 100;
  const displayH = item.element.offsetHeight || (
    item.element.naturalWidth
      ? displayW * item.element.naturalHeight / item.element.naturalWidth
      : 100
  );

  const targetPxW = Math.max(1, Math.round(displayW * scale));
  const targetPxH = Math.max(1, Math.round(displayH * scale));

  const cacheKey = `${src}__${targetPxW}x${targetPxH}`;
  if (srCache.has(cacheKey)) {
    return srCache.get(cacheKey);
  }

  const img = await loadImageAsync(src);

  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;

  // 如果原图已经足够，不做 SR，直接返回原图
  if (targetPxW <= naturalW && targetPxH <= naturalH) {
    srCache.set(cacheKey, img);
    return img;
  }

  // 轻量策略：只先放大到原图的有限倍数
  const srW = Math.min(targetPxW, Math.round(naturalW * SR_MAX_SOURCE_UPSCALE));
  const srH = Math.min(targetPxH, Math.round(naturalH * SR_MAX_SOURCE_UPSCALE));

  let work = progressiveUpscale(img, srW, srH);
  work = applyLumaUnsharp(work);

  srCache.set(cacheKey, work);
  return work;
}

async function drawExportItem(ctx, item, clip, scale) {
  try {
    const renderable = ENABLE_LIGHT_SR
      ? await buildLightSRSource(item, scale)
      : await loadImageAsync(item.originalSrc || item.element.src);

    const pos = getImagePosition(item.element);
    const x = pos.x - clip.x;
    const y = pos.y - clip.y;
    const w = item.element.offsetWidth;
    const h = item.element.offsetHeight;

    ctx.drawImage(renderable, x, y, w, h);
  } catch (err) {
    console.error('导出图片处理失败:', err);
  }
}

  function setImagePosition(img, x, y) {
    img.dataset.x = String(x);
    img.dataset.y = String(y);
    img.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function getImagePosition(img) {
    return {
      x: parseFloat(img.dataset.x || '0'),
      y: parseFloat(img.dataset.y || '0')
    };
  }

  function getImageRenderSize(img) {
    const w = img.offsetWidth || parseFloat(img.style.width) || 100;
    const h = img.offsetHeight || (
      img.naturalWidth ? (w * img.naturalHeight / img.naturalWidth) : 100
    );
    return { w, h };
  }

  function clampImagePosition(img, x, y) {
    const boardRect = drawingBoard.getBoundingClientRect();
    const { w, h } = getImageRenderSize(img);

    return {
      x: Math.max(0, Math.min(boardRect.width - w, x)),
      y: Math.max(0, Math.min(boardRect.height - h, y))
    };
  }

  let drawSubCanvasMode = false;
  let subCanvas = null;
  let subCanvasStart = { x: 0, y: 0 };
  let tempDrawRect = null;
  let canvasExportImg = null;

  let paintMode = false;
  let isPainting = false;
  let maskCanvas;
  let maskCtx;
  let brushSize = 10;

  let lastDragData = null;

// 如果你的前后端不是同域，把这里改成你的后端地址
const API_BASE = window.API_BASE || '';

function normalizeImageUrl(url) {
  if (!url) return '';
  if (/^(data:|blob:|https?:)/i.test(url)) return url;

  if (API_BASE) {
    if (url.startsWith('/')) return `${API_BASE}${url}`;
    return `${API_BASE}/${url}`;
  }

  return url;
}

function extractDragData(e) {
  const dt = e.dataTransfer;
  if (!dt) return lastDragData;

  const rawJson = dt.getData('application/json');
  const rawPlain = dt.getData('text/plain');
  const rawUri = dt.getData('text/uri-list');

  const raw = rawJson || rawPlain || rawUri;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.url) {
        return {
          ...parsed,
          url: normalizeImageUrl(parsed.url)
        };
      }
    } catch (_) {
      return { url: normalizeImageUrl(raw.trim()) };
    }
  }

  return lastDragData;
}

  initMaskCanvas();
  initTools();
  bindEvents();

  function initMaskCanvas() {
    maskCanvas = document.createElement('canvas');
    maskCanvas.id = 'mask-canvas';
    maskCanvas.style.cssText = `
      position:absolute;
      top:0;
      left:0;
      z-index:999;
      pointer-events:none;
    `;
    drawingBoard.appendChild(maskCanvas);

    resizeMaskCanvas();
    window.addEventListener('resize', resizeMaskCanvas);
  }

  function resizeMaskCanvas() {
    const r = drawingBoard.getBoundingClientRect();

    // 保留旧内容
    const prev = document.createElement('canvas');
    if (maskCanvas.width && maskCanvas.height) {
      prev.width = maskCanvas.width;
      prev.height = maskCanvas.height;
      const prevCtx = prev.getContext('2d');
      prevCtx.drawImage(maskCanvas, 0, 0);
    }

    maskCanvas.width = Math.max(1, Math.round(r.width * MASK_DPR));
    maskCanvas.height = Math.max(1, Math.round(r.height * MASK_DPR));
    maskCanvas.style.width = `${r.width}px`;
    maskCanvas.style.height = `${r.height}px`;

    maskCtx = maskCanvas.getContext('2d');
    maskCtx.setTransform(MASK_DPR, 0, 0, MASK_DPR, 0, 0);
    maskCtx.imageSmoothingEnabled = true;
    maskCtx.imageSmoothingQuality = 'high';

    // 恢复旧内容
    if (prev.width && prev.height) {
      maskCtx.drawImage(
        prev,
        0, 0, prev.width, prev.height,
        0, 0, r.width, r.height
      );
    }
  }

  function initTools() {
    createDrawButton();
    createPaintButton();
    createExportButton();
    createDragContainer();
    bindClearButton();
  }

  function createDrawButton() {
    let wrap = document.getElementById('canvas-tool-btns');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'canvas-tool-btns';
      wrap.style.cssText = 'position:absolute;top:10px;left:10px;z-index:1000;display:flex;gap:8px;';
      drawingBoard.parentElement.style.position = 'relative';
      drawingBoard.parentElement.appendChild(wrap);
    }

    const btn = document.createElement('button');
    btn.innerHTML = '📏';
    btn.style.cssText = 'width:32px;height:32px;border:none;border-radius:4px;background:#ef4444;color:white;cursor:pointer;';
    btn.onclick = () => {
      if (paintMode) {
        paintMode = false;
        const pb = document.querySelector('#canvas-tool-btns button:nth-child(2)');
        if (pb) pb.style.background = '#10b981';
        maskCanvas.style.pointerEvents = 'none';
        droppedImages.forEach(i => i.element.style.pointerEvents = 'auto');
      }
      drawSubCanvasMode = !drawSubCanvasMode;
      drawingBoard.style.cursor = drawSubCanvasMode ? 'crosshair' : 'default';
      btn.style.background = drawSubCanvasMode ? '#dc2626' : '#ef4444';
      if (!drawSubCanvasMode && tempDrawRect) {
        drawingBoard.removeChild(tempDrawRect);
        tempDrawRect = null;
      }
    };
    wrap.appendChild(btn);
  }

  function createPaintButton() {
    const wrap = document.getElementById('canvas-tool-btns');
    const btn = document.createElement('button');
    btn.innerHTML = '🖌️';
    btn.style.cssText = 'width:32px;height:32px;border:none;border-radius:4px;background:#10b981;color:white;cursor:pointer;';
    btn.onclick = () => {
      if (drawSubCanvasMode) {
        drawSubCanvasMode = false;
        const db = document.querySelector('#canvas-tool-btns button:first-child');
        if (db) db.style.background = '#ef4444';
        if (tempDrawRect) {
          drawingBoard.removeChild(tempDrawRect);
          tempDrawRect = null;
        }
      }
      paintMode = !paintMode;
      if (paintMode) {
        maskCanvas.style.pointerEvents = 'auto';
        drawingBoard.style.cursor = 'crosshair';
        btn.style.background = '#059669';
        droppedImages.forEach(i => i.element.style.pointerEvents = 'none');
      } else {
        maskCanvas.style.pointerEvents = 'none';
        drawingBoard.style.cursor = 'default';
        btn.style.background = '#10b981';
        droppedImages.forEach(i => i.element.style.pointerEvents = 'auto');
      }
    };

    const clearBtn = document.createElement('button');
    clearBtn.innerHTML = '🧹';
    clearBtn.style.cssText = 'width:32px;height:32px;border:none;border-radius:4px;background:#f59e0b;color:white;cursor:pointer;';
    clearBtn.onclick = () => {
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    };

    wrap.appendChild(btn);
    wrap.appendChild(clearBtn);
  }

  function createExportButton() {
    const box = document.querySelector('.col-right .mt-2.flex');
    if (!box) return;

    const btn1 = document.createElement('button');
    btn1.className = 'text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600';
    btn1.innerText = '导出合成图';
    btn1.onclick = () => exportCanvasToImage('combined');
    box.appendChild(btn1);

    const btn2 = document.createElement('button');
    btn2.className = 'text-xs px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600';
    btn2.innerText = '导出标准mask';
    btn2.onclick = () => exportCanvasToImage('mask');
    box.appendChild(btn2);

    const btn3 = document.createElement('button');
    btn3.className = 'text-xs px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600';
    btn3.innerText = '导出原图';
    btn3.onclick = () => exportCanvasToImage('origin');
    box.appendChild(btn3);
  }

  function createDragContainer() {
    let el = document.getElementById('canvas-drag-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'canvas-drag-container';
      el.style.cssText = `
        margin-top:8px;
        padding:8px;
        border:1px dashed #3B82F6;
        border-radius:6px;
        text-align:center;
        background:#f0f9ff;
        min-height:80px;
      `;
      drawingBoard.parentElement.appendChild(el);
    }

    el.innerHTML = `
      <div style="font-size:12px;color:#2563eb;">导出后可拖拽</div>
    `;
  }
  function bindClearButton() {
    const btn = document.getElementById('clear-canvas-btn');
    if (!btn) return;
    btn.onclick = () => {
      const mc = document.getElementById('mask-canvas');
      drawingBoard.innerHTML = '';
      if (mc) drawingBoard.appendChild(mc);
      droppedImages = [];
      srCache.clear();
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      subCanvas = null;
      tempDrawRect = null;
      drawSubCanvasMode = false;
      paintMode = false;

      const con = document.getElementById('canvas-drag-container');
      if (con) con.innerText = '导出后可拖拽';
      canvasExportImg = null;
    };
  }

  function bindEvents() {
    drawingBoard.addEventListener('dragover', e => e.preventDefault());
    drawingBoard.addEventListener('dragleave', e => {});

    drawingBoard.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const data = extractDragData(e);

      if (!data || !data.url) {
        console.warn('drop 没拿到有效图片地址', e.dataTransfer?.types);
        return;
      }

      const r = drawingBoard.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width - 100, e.clientX - r.left - 50));
      const y = Math.max(0, Math.min(r.height - 100, e.clientY - r.top - 50));

      const img = new Image();
      img.onload = () => {
      img.style.cssText = `
        position:absolute;
        left:0;
        top:0;
        width:100px;
        height:auto;
        display:block;
        border:1px solid #3bf;
        border-radius:4px;
        cursor:grab;
        z-index:10;
        user-select:none;
        will-change:transform;
        transform:translate3d(0,0,0);
      `;
      img.dataset.scale = '1';
      img.dataset.x = '0';
      img.dataset.y = '0';
      img.draggable = false;

      drawingBoard.appendChild(img);

      const pos = clampImagePosition(img, x, y);
      setImagePosition(img, pos.x, pos.y);

      droppedImages.push({
        element: img,
        originalSrc: normalizeImageUrl(data.url)
      });

      img.addEventListener('mousedown', (ev) => {
        if (paintMode) return;
        ev.preventDefault();

        draggingImg = img;
        dragStartMouse = { x: ev.clientX, y: ev.clientY };
        dragStartPos = getImagePosition(img);

        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';

        img.style.pointerEvents = 'none';
        img.style.cursor = 'grabbing';
      });

      img.addEventListener('wheel', (ev) => {
        if (paintMode) return;
        ev.preventDefault();

        let scale = parseFloat(img.dataset.scale || '1');
        scale += ev.deltaY > 0 ? -0.1 : 0.1;
        scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
        img.dataset.scale = scale;
        img.style.width = 100 * scale + 'px';

        const current = getImagePosition(img);
        const clamped = clampImagePosition(img, current.x, current.y);
        setImagePosition(img, clamped.x, clamped.y);
      });

      console.log('图片已成功添加到画布:', data.url);
    };

      img.onerror = () => {
        console.error('图片加载失败:', data.url);
      };

      img.src = normalizeImageUrl(data.url);
    });

    drawingBoard.addEventListener('mousedown', e => {
      if (!drawSubCanvasMode) return;
      e.preventDefault();
      const r = drawingBoard.getBoundingClientRect();
      subCanvasStart = { x: e.clientX - r.left, y: e.clientY - r.top };
      tempDrawRect = document.createElement('div');
      tempDrawRect.style.cssText = `
        position:absolute;
        left:${subCanvasStart.x}px;top:${subCanvasStart.y}px;
        width:0;height:0;
        border:2px dashed #ef4444;background:rgba(239,68,68,0.05);
        pointer-events:none;z-index:999;
      `;
      drawingBoard.appendChild(tempDrawRect);
    });

    drawingBoard.addEventListener('mousemove', e => {
      if (!tempDrawRect) return;
      const r = drawingBoard.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const l = Math.min(subCanvasStart.x, x);
      const t = Math.min(subCanvasStart.y, y);
      const w = Math.abs(x - subCanvasStart.x);
      const h = Math.abs(y - subCanvasStart.y);
      tempDrawRect.style.left = l + 'px';
      tempDrawRect.style.top = t + 'px';
      tempDrawRect.style.width = w + 'px';
      tempDrawRect.style.height = h + 'px';
    });

    drawingBoard.addEventListener('mouseup', e => {
      if (!tempDrawRect) return;
      const r = drawingBoard.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const l = Math.min(subCanvasStart.x, x);
      const t = Math.min(subCanvasStart.y, y);
      const w = Math.abs(x - subCanvasStart.x);
      const h = Math.abs(y - subCanvasStart.y);

      if (w < 50 || h < 50) {
        drawingBoard.removeChild(tempDrawRect);
        tempDrawRect = null;
        return;
      }
      if (subCanvas) drawingBoard.removeChild(subCanvas);
      subCanvas = document.createElement('div');
      subCanvas.style.cssText = `
        position:absolute;left:${l}px;top:${t}px;
        width:${w}px;height:${h}px;
        border:2px solid #ef4444;
        background:transparent;pointer-events:none;z-index:1;
      `;
      drawingBoard.appendChild(subCanvas);
      drawingBoard.removeChild(tempDrawRect);
      tempDrawRect = null;
      drawSubCanvasMode = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!draggingImg || paintMode) return;

      const dx = e.clientX - dragStartMouse.x;
      const dy = e.clientY - dragStartMouse.y;

      const next = clampImagePosition(
        draggingImg,
        dragStartPos.x + dx,
        dragStartPos.y + dy
      );

      pendingDragPos = next;

      if (dragRAF) return;

      dragRAF = requestAnimationFrame(() => {
        if (draggingImg && pendingDragPos) {
          setImagePosition(draggingImg, pendingDragPos.x, pendingDragPos.y);
        }
        dragRAF = null;
      });
    });

    document.addEventListener('mouseup', () => {
      if (dragRAF) {
        cancelAnimationFrame(dragRAF);
        dragRAF = null;
      }

      if (draggingImg) {
        draggingImg.style.pointerEvents = 'auto';
        draggingImg.style.cursor = 'grab';
      }

      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';

      draggingImg = null;
      pendingDragPos = null;
      isPainting = false;
    });

    maskCanvas.addEventListener('mousedown', e => {
      if (!paintMode) return;
      isPainting = true;
      const r = maskCanvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      maskCtx.beginPath();
      maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      maskCtx.fillStyle = 'white';
      maskCtx.fill();
      maskCtx.beginPath();
      maskCtx.moveTo(x, y);
    });

    maskCanvas.addEventListener('mousemove', e => {
      if (!isPainting) return;
      const r = maskCanvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      maskCtx.lineTo(x, y);
      maskCtx.lineWidth = brushSize;
      maskCtx.lineCap = 'round';
      maskCtx.strokeStyle = 'white';
      maskCtx.stroke();
      maskCtx.beginPath();
      maskCtx.moveTo(x, y);
    });

    maskCanvas.addEventListener('mouseup', () => isPainting = false);
    maskCanvas.addEventListener('mouseleave', () => isPainting = false);
  }

  function getRecommendedExportScale() {
    const base = Math.max(2, SCREEN_DPR);

    const ratios = droppedImages.map(({ element }) => {
      const displayW = element.offsetWidth || parseFloat(element.style.width) || 100;
      const naturalW = element.naturalWidth || displayW;
      return naturalW / displayW;
    }).filter(v => Number.isFinite(v) && v > 0);

    return Math.min(MAX_EXPORT_SCALE, Math.max(base, ...ratios));
  }

  function createExportCanvas(clip, scale = getRecommendedExportScale()) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(clip.w * scale));
    c.height = Math.max(1, Math.round(clip.h * scale));
    c.style.width = `${clip.w}px`;
    c.style.height = `${clip.h}px`;

    const ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    return { c, ctx, scale };
  }

  function exportCanvasToImage(type) {
    const clip = subCanvas
      ? {
          x: parseFloat(subCanvas.style.left) || 0,
          y: parseFloat(subCanvas.style.top) || 0,
          w: parseFloat(subCanvas.style.width) || 0,
          h: parseFloat(subCanvas.style.height) || 0
        }
      : {
          x: 0,
          y: 0,
          w: drawingBoard.offsetWidth,
          h: drawingBoard.offsetHeight
        };

    const { c, ctx, scale } = createExportCanvas(clip);

    const finish = (filename, previewText) => {
      const url = c.toDataURL('image/png');
      console.log(`导出分辨率: ${c.width} x ${c.height}, scale=${scale.toFixed(2)}`);
      download(url, `${filename}_${Date.now()}.png`);
      updatePreview(url, `${previewText} ${c.width}x${c.height}`);
    };

    if (type === 'origin') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, clip.w, clip.h);

      const tasks = droppedImages.map(item => drawExportItem(ctx, item, clip, scale));

      Promise.all(tasks).then(() => {
        finish('原图', '白底原图');
      });
      return;
    }

    if (type === 'mask') {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, clip.w, clip.h);

      ctx.drawImage(
        maskCanvas,
        clip.x * MASK_DPR,
        clip.y * MASK_DPR,
        clip.w * MASK_DPR,
        clip.h * MASK_DPR,
        0,
        0,
        clip.w,
        clip.h
      );

      finish('标准mask', '黑底mask');
      return;
    }

    if (type === 'combined') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, clip.w, clip.h);

      const tasks = droppedImages.map(item => drawExportItem(ctx, item, clip, scale));

      Promise.all(tasks).then(() => {
        ctx.save();
        ctx.globalAlpha = 0.4;

        ctx.drawImage(
          maskCanvas,
          clip.x * MASK_DPR,
          clip.y * MASK_DPR,
          clip.w * MASK_DPR,
          clip.h * MASK_DPR,
          0,
          0,
          clip.w,
          clip.h
        );

        ctx.restore();

        finish('合成图', '原图+mask');
      });
    }
  }
  function download(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function updatePreview(url, text) {
    const box = document.getElementById('canvas-drag-container');
    if (!box) return;

    canvasExportImg = url;

    box.innerHTML = `
      <div id="canvas-drag-preview"
          draggable="true"
          style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:grab;">
        <img src="${url}"
            draggable="false"
            style="max-width:100%;max-height:100px;border-radius:4px;display:block;border:1px solid #cbd5e1;">
        <div style="font-size:10px;color:#3B82F6;">${text} | 拖到画布</div>
      </div>
    `;

    const preview = document.getElementById('canvas-drag-preview');
    preview.addEventListener('dragstart', (e) => {
      if (!canvasExportImg) {
        e.preventDefault();
        return;
      }

      const dragData = {
        url: canvasExportImg,
        type: 'canvas-export',
        label: 'Canvas'
      };

      lastDragData = dragData;

      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/json', JSON.stringify(dragData));
      e.dataTransfer.setData('text/plain', JSON.stringify(dragData));

      const dragImg = preview.querySelector('img') || preview;
      e.dataTransfer.setDragImage(dragImg, 30, 30);
    });
  }
}

window.initCanvasDrag = initCanvasDrag;