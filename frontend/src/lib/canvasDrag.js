/**
 * canvas-drag.js - 简化版，解决Vite解析错误
 */
export function initCanvasDrag() {
  const drawingBoard = document.getElementById('drawing-board');
  if (!drawingBoard) return;

  // 核心变量
  let droppedImages = [];
  let draggingImg = null;
  let scalingImg = null;
  let dragOffset = { x: 0, y: 0 };
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3;

  // 子Canvas相关
  let drawSubCanvasMode = false;
  let subCanvas = null;
  let subCanvasStart = { x: 0, y: 0 };
  let tempDrawRect = null;
  let canvasExportImg = null;

  // 初始化
  initTools();
  bindEvents();

  // 初始化工具按钮
  function initTools() {
    // 画方框按钮（Canvas左上角）
    createDrawButton();
    // 导出按钮
    createExportButton();
    // 拖拽容器
    createDragContainer();
    // 清空按钮
    bindClearButton();
  }

  // 绑定所有事件
  function bindEvents() {
    // 拖拽进入/离开
    drawingBoard.addEventListener('dragover', handleDragOver);
    drawingBoard.addEventListener('dragleave', handleDragLeave);
    // 放下图片
    drawingBoard.addEventListener('drop', handleDrop);
    // 子Canvas绘制事件
    drawingBoard.addEventListener('mousedown', handleCanvasMouseDown);
    drawingBoard.addEventListener('mousemove', handleCanvasMouseMove);
    drawingBoard.addEventListener('mouseup', handleCanvasMouseUp);
    // 全局鼠标事件
    document.addEventListener('mousemove', handleDocMouseMove);
    document.addEventListener('mouseup', handleDocMouseUp);
    drawingBoard.addEventListener('mouseleave', handleDocMouseUp);
  }

  // ========== 工具创建函数 ==========
  function createDrawButton() {
    let btnWrapper = document.getElementById('canvas-tool-btns');
    if (!btnWrapper) {
      btnWrapper = document.createElement('div');
      btnWrapper.id = 'canvas-tool-btns';
      btnWrapper.style.cssText = 'position:absolute;top:10px;left:10px;z-index:1000;display:flex;gap:8px;';
      drawingBoard.parentElement.style.position = 'relative';
      drawingBoard.parentElement.appendChild(btnWrapper);
    }

    if (document.getElementById('draw-subcanvas-btn')) return;

    const drawBtn = document.createElement('button');
    drawBtn.id = 'draw-subcanvas-btn';
    drawBtn.title = '绘制子画布区域';
    drawBtn.style.cssText = 'width:32px;height:32px;border:none;border-radius:4px;background:#ef4444;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all 0.2s;';
    drawBtn.innerHTML = '📏';

    drawBtn.addEventListener('click', () => {
      drawSubCanvasMode = !drawSubCanvasMode;
      if (drawSubCanvasMode) {
        drawBtn.style.backgroundColor = '#dc2626';
        drawBtn.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.5)';
        drawingBoard.style.cursor = 'crosshair';
      } else {
        drawBtn.style.backgroundColor = '#ef4444';
        drawBtn.style.boxShadow = 'none';
        drawingBoard.style.cursor = 'default';
        if (tempDrawRect) {
          drawingBoard.removeChild(tempDrawRect);
          tempDrawRect = null;
        }
      }
    });

    btnWrapper.appendChild(drawBtn);
  }

  function createExportButton() {
    const btnContainer = document.querySelector('.col-right .mt-2.flex');
    if (!btnContainer || document.getElementById('export-canvas-btn')) return;

    const exportBtn = document.createElement('button');
    exportBtn.id = 'export-canvas-btn';
    exportBtn.className = 'text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors';
    exportBtn.innerText = 'output';
    exportBtn.style.marginLeft = '8px';
    exportBtn.addEventListener('click', exportCanvasToImage);
    btnContainer.appendChild(exportBtn);
  }

  function createDragContainer() {
    const container = document.createElement('div');
    container.id = 'canvas-drag-container';
    container.style.cssText = 'margin-top:8px;padding:4px;border:1px dashed #3B82F6;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:grab;background:#f0f9ff;';
    container.innerText = '点击「导出为图片」后，此处显示可拖拽的整体图片';
    const parent = drawingBoard.parentElement;
    parent.insertBefore(container, drawingBoard.nextSibling);

    container.draggable = true;
    container.addEventListener('dragstart', (e) => {
      if (!canvasExportImg) {
        alert('请先点击「导出为图片」生成整体图片！');
        e.preventDefault();
        return;
      }
      const dragData = { url: canvasExportImg, type: 'canvas-export', label: 'Canvas整体图片' };
      e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
      container.style.cursor = 'grabbing';
    });
    container.addEventListener('dragend', () => {
      container.style.cursor = 'grab';
    });
  }

  function bindClearButton() {
    const clearBtn = document.getElementById('clear-canvas-btn');
    if (!clearBtn) return;

    clearBtn.addEventListener('click', () => {
      // 移除子Canvas
      if (subCanvas) {
        drawingBoard.removeChild(subCanvas);
        subCanvas = null;
      }
      // 清空图片
      while (drawingBoard.firstChild) {
        if (drawingBoard.firstChild.classList?.contains('canvas-placeholder')) {
          drawingBoard.removeChild(drawingBoard.firstChild.nextSibling);
        } else {
          drawingBoard.removeChild(drawingBoard.firstChild);
        }
      }
      // 重置占位符
      if (!drawingBoard.querySelector('.canvas-placeholder')) {
        const placeholder = document.createElement('div');
        placeholder.className = 'canvas-placeholder absolute inset-0 flex flex-col items-center justify-center text-xs text-gray-400';
        placeholder.innerHTML = '<span>🖱️ Drag & drop segmented entities here</span>';
        drawingBoard.appendChild(placeholder);
      }
      droppedImages = [];
    });
  }

  // ========== 事件处理函数 ==========
  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    drawingBoard.classList.add('dragover');
  }

  function handleDragLeave(e) {
    if (!drawingBoard.contains(e.relatedTarget)) {
      drawingBoard.classList.remove('dragover');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    drawingBoard.classList.remove('dragover');

    // 解析拖拽数据
    let dragData = null;
    const data = e.dataTransfer.getData('text/plain');
    try {
      dragData = data.startsWith('{') ? JSON.parse(data) : { url: data };
    } catch (err) {
      dragData = { url: data };
    }

    if (!dragData.url || !dragData.url.startsWith('http')) return;

    // 计算初始位置
    const boardRect = drawingBoard.getBoundingClientRect();
    let initX = e.clientX - boardRect.left - 50;
    let initY = e.clientY - boardRect.top - 50;

    // 限制在子Canvas内
    if (subCanvas) {
      const subRect = {
        x: parseFloat(subCanvas.style.left),
        y: parseFloat(subCanvas.style.top),
        width: parseFloat(subCanvas.style.width),
        height: parseFloat(subCanvas.style.height)
      };
      initX = Math.max(subRect.x, Math.min(initX, subRect.x + subRect.width - 100));
      initY = Math.max(subRect.y, Math.min(initY, subRect.y + subRect.height - 100));
    }

    initX = Math.max(0, initX);
    initY = Math.max(0, initY);

    // 创建图片元素
    const img = document.createElement('img');
    img.src = dragData.url;
    img.alt = dragData.label || 'entity';
    img.dataset.scale = '1';
    img.style.cssText = `
      position:absolute;left:${initX}px;top:${initY}px;width:100px;height:auto;
      cursor:move;border:1px solid #3B82F6;border-radius:4px;
      z-index:${droppedImages.length + 10};transition:none;
    `;

    // 存储图片数据
    droppedImages.push({
      element: img,
      url: dragData.url,
      label: dragData.label || 'unknown',
      x: initX,
      y: initY,
      zIndex: droppedImages.length + 10,
      initWidth: 100,
      scale: 1
    });

    drawingBoard.appendChild(img);

    // 绑定图片事件
    img.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      draggingImg = img;
      const imgRect = img.getBoundingClientRect();
      dragOffset.x = e.clientX - imgRect.left;
      dragOffset.y = e.clientY - imgRect.top;
      img.style.zIndex = droppedImages.length + 10;
      img.style.cursor = 'grabbing';
    });

    img.addEventListener('wheel', (e) => {
      e.preventDefault();
      const imgData = droppedImages.find(item => item.element === img);
      if (!imgData) return;

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      let newScale = parseFloat(img.dataset.scale) + delta;
      newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

      img.dataset.scale = newScale;
      imgData.scale = newScale;
      const newWidth = imgData.initWidth * newScale;
      img.style.width = `${newWidth}px`;

      // 位置调整
      const boardRect = drawingBoard.getBoundingClientRect();
      const mouseX = e.clientX - boardRect.left;
      const mouseY = e.clientY - boardRect.top;
      let finalX = mouseX - (newWidth / 2);
      let finalY = mouseY - (img.offsetHeight / 2);

      if (subCanvas) {
        const subRect = {
          x: parseFloat(subCanvas.style.left),
          y: parseFloat(subCanvas.style.top),
          width: parseFloat(subCanvas.style.width),
          height: parseFloat(subCanvas.style.height)
        };
        finalX = Math.max(subRect.x, Math.min(finalX, subRect.x + subRect.width - img.offsetWidth));
        finalY = Math.max(subRect.y, Math.min(finalY, subRect.y + subRect.height - img.offsetHeight));
      } else {
        finalX = Math.max(0, Math.min(finalX, boardRect.width - img.offsetWidth));
        finalY = Math.max(0, Math.min(finalY, boardRect.height - img.offsetHeight));
      }

      img.style.left = `${finalX}px`;
      img.style.top = `${finalY}px`;
    });
  }

  function handleCanvasMouseDown(e) {
    if (!drawSubCanvasMode || e.button !== 0) return;
    e.preventDefault();

    const boardRect = drawingBoard.getBoundingClientRect();
    subCanvasStart.x = e.clientX - boardRect.left;
    subCanvasStart.y = e.clientY - boardRect.top;

    // 创建临时矩形
    tempDrawRect = document.createElement('div');
    tempDrawRect.style.cssText = `
      position:absolute;left:${subCanvasStart.x}px;top:${subCanvasStart.y}px;
      width:0;height:0;border:2px dashed #ef4444;
      background:rgba(239,68,68,0.05);pointer-events:none;z-index:999;
    `;
    drawingBoard.appendChild(tempDrawRect);
  }

  function handleCanvasMouseMove(e) {
    if (!drawSubCanvasMode || !tempDrawRect) return;

    const boardRect = drawingBoard.getBoundingClientRect();
    const currentX = e.clientX - boardRect.left;
    const currentY = e.clientY - boardRect.top;

    const rectX = Math.min(subCanvasStart.x, currentX);
    const rectY = Math.min(subCanvasStart.y, currentY);
    const rectWidth = Math.abs(currentX - subCanvasStart.x);
    const rectHeight = Math.abs(currentY - subCanvasStart.y);

    tempDrawRect.style.left = `${rectX}px`;
    tempDrawRect.style.top = `${rectY}px`;
    tempDrawRect.style.width = `${rectWidth}px`;
    tempDrawRect.style.height = `${rectHeight}px`;
  }

  function handleCanvasMouseUp(e) {
    if (!drawSubCanvasMode || !tempDrawRect) return;

    const boardRect = drawingBoard.getBoundingClientRect();
    const currentX = e.clientX - boardRect.left;
    const currentY = e.clientY - boardRect.top;

    const rectX = Math.min(subCanvasStart.x, currentX);
    const rectY = Math.min(subCanvasStart.y, currentY);
    const rectWidth = Math.abs(currentX - subCanvasStart.x);
    const rectHeight = Math.abs(currentY - subCanvasStart.y);

    // 最小尺寸检查
    if (rectWidth < 50 || rectHeight < 50) {
      drawingBoard.removeChild(tempDrawRect);
      tempDrawRect = null;
      alert('子画布尺寸不能小于50x50像素！');
      return;
    }

    // 移除临时矩形
    drawingBoard.removeChild(tempDrawRect);
    tempDrawRect = null;

    // 移除旧的子Canvas
    if (subCanvas) {
      drawingBoard.removeChild(subCanvas);
    }

    // 创建新的子Canvas
    subCanvas = document.createElement('div');
    subCanvas.id = 'sub-drawing-board';
    subCanvas.style.cssText = `
      position:absolute;left:${rectX}px;top:${rectY}px;width:${rectWidth}px;height:${rectHeight}px;
      border:2px solid #ef4444;background:transparent;z-index:1;pointer-events:none;
    `;
    drawingBoard.appendChild(subCanvas);

    // 退出绘制模式
    drawSubCanvasMode = false;
    const drawBtn = document.getElementById('draw-subcanvas-btn');
    if (drawBtn) {
      drawBtn.style.backgroundColor = '#ef4444';
      drawBtn.style.boxShadow = 'none';
    }
    drawingBoard.style.cursor = 'default';
  }

  function handleDocMouseMove(e) {
    if (!draggingImg) return;

    const boardRect = drawingBoard.getBoundingClientRect();
    let newX = e.clientX - boardRect.left - dragOffset.x;
    let newY = e.clientY - boardRect.top - dragOffset.y;

    // 限制在子Canvas内
    if (subCanvas) {
      const subRect = {
        x: parseFloat(subCanvas.style.left),
        y: parseFloat(subCanvas.style.top),
        width: parseFloat(subCanvas.style.width),
        height: parseFloat(subCanvas.style.height)
      };
      newX = Math.max(subRect.x, Math.min(newX, subRect.x + subRect.width - draggingImg.offsetWidth));
      newY = Math.max(subRect.y, Math.min(newY, subRect.y + subRect.height - draggingImg.offsetHeight));
    } else {
      newX = Math.max(0, Math.min(newX, boardRect.width - draggingImg.offsetWidth));
      newY = Math.max(0, Math.min(newY, boardRect.height - draggingImg.offsetHeight));
    }

    draggingImg.style.left = `${newX}px`;
    draggingImg.style.top = `${newY}px`;
  }

  function handleDocMouseUp() {
    if (draggingImg) {
      draggingImg.style.cursor = 'move';
      draggingImg = null;
    }
    scalingImg = null;
  }

  // ========== 导出函数 ==========
  function exportCanvasToImage() {
    // 确定导出区域
    let exportRect;
    if (subCanvas) {
      exportRect = {
        x: parseFloat(subCanvas.style.left),
        y: parseFloat(subCanvas.style.top),
        width: parseFloat(subCanvas.style.width),
        height: parseFloat(subCanvas.style.height)
      };
    } else {
      const boardRect = drawingBoard.getBoundingClientRect();
      exportRect = { x: 0, y: 0, width: boardRect.width, height: boardRect.height };
    }

    // 创建导出Canvas
    const exportCanvas = document.createElement('canvas');
    const ctx = exportCanvas.getContext('2d');
    exportCanvas.width = exportRect.width;
    exportCanvas.height = exportRect.height;

    // 绘制背景
    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(0, 0, exportRect.width, exportRect.height);

    // 绘制图片
    const sortedImages = [...droppedImages].sort((a, b) => a.zIndex - b.zIndex);
    const imagePromises = sortedImages.map(imgData => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = imgData.url;

        img.onload = () => {
          const imgElement = imgData.element;
          let imgLeft = parseFloat(imgElement.style.left || '0');
          let imgTop = parseFloat(imgElement.style.top || '0');
          const imgWidth = imgElement.offsetWidth;
          const imgHeight = imgElement.offsetHeight;

          // 转换坐标
          if (subCanvas) {
            imgLeft -= exportRect.x;
            imgTop -= exportRect.y;
          }

          // 只绘制可见部分
          if (imgLeft + imgWidth > 0 && imgTop + imgHeight > 0 && imgLeft < exportRect.width && imgTop < exportRect.height) {
            ctx.drawImage(img, imgLeft, imgTop, imgWidth, imgHeight);
          }
          resolve();
        };

        img.onerror = () => {
          console.warn(`图片加载失败：${imgData.url}`);
          resolve();
        };
      });
    });

    // 导出图片
    Promise.all(imagePromises).then(() => {
      canvasExportImg = exportCanvas.toDataURL('image/png', 1.0);
      
      // 更新预览容器
      const dragContainer = document.getElementById('canvas-drag-container');
      dragContainer.innerHTML = '';
      dragContainer.style.border = '1px solid #3B82F6';
      
      const previewImg = document.createElement('img');
      previewImg.src = canvasExportImg;
      previewImg.style.cssText = 'max-width:100%;max-height:100px;border-radius:4px;';
      dragContainer.appendChild(previewImg);
      
      const tip = document.createElement('div');
      tip.style.cssText = 'font-size:10px;color:#3B82F6;margin-top:4px;text-align:center;';
      tip.innerText = '可拖拽此图片到AddWorkflow节点的输入框';
      dragContainer.appendChild(tip);

      // 下载图片
      const downloadLink = document.createElement('a');
      downloadLink.href = canvasExportImg;
      downloadLink.download = `sam-export-${new Date().getTime()}.png`;
      downloadLink.click();
    }).catch(err => {
      console.error('导出失败：', err);
      alert('导出失败，请检查图片是否加载正常！');
    });
  }
}

window.initCanvasDrag = initCanvasDrag;