/**
 * EntityCard.js
 * 专门负责在 D3 渲染出的节点卡片中填充实体（Entity）缩略图
 * 修复：保存图片功能（兼容跨域图片下载）
 * 新增：支持显示 node.assets.output.images 中的图片
 * 还原：完全保留原有样式（一排3个、统一边框颜色）
 */

export function updateEntityDisplay(nodeId, segmentedAssets, node) {
    // 1. 定位 D3 在 workflowGraph.js 中创建的 foreignObject 内部容器
    const container = document.getElementById(`entities-${nodeId}`);
    
    if (!container) return;

    // 2. 清空现有内容
    container.innerHTML = '';

    // 3. 整合数据：合并 segmentedAssets 和 node.assets.output.images
    let allAssets = [];
    
    // 处理原有实体图片
    if (segmentedAssets && Array.isArray(segmentedAssets) && segmentedAssets.length > 0) {
        allAssets = [...allAssets, ...segmentedAssets.map(asset => ({
            ...asset,
            type: 'entity' // 仅用于逻辑区分，不影响样式
        }))];
    }

    // 处理 node.assets.output.images 图片（核心新增逻辑，样式和实体图片完全一致）
    if (node && node.assets && node.assets.output && node.assets.output.images && Array.isArray(node.assets.output.images)) {
        allAssets = [...allAssets, ...node.assets.output.images.map((image, idx) => ({
            path: image.path || image, // 兼容路径字符串或对象格式
            label: image.label || `output-image-${idx}`,
            type: 'output' // 仅用于逻辑区分，不影响样式
        }))];
    }

    // 数据校验：无图片则返回
    if (allAssets.length === 0) {
        return;
    }

    // 定义后端基础地址
    const BACKEND_URL = 'http://localhost:5005';

    // ========== 保留原有：创建放大预览弹窗（全局唯一） ==========
    let previewModal = document.getElementById('entity-preview-modal');
    if (!previewModal) {
        previewModal = document.createElement('div');
        previewModal.id = 'entity-preview-modal';
        previewModal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            padding: 20px;
            box-sizing: border-box;
        `;

        // 弹窗内容容器
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            position: relative;
            max-width: 90%;
            max-height: 90%;
            display: flex;
            flex-direction: column;
            align-items: center;
        `;

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '×';
        closeBtn.style.cssText = `
            position: absolute;
            top: -40px;
            right: 0;
            background: transparent;
            border: none;
            color: white;
            font-size: 32px;
            cursor: pointer;
            width: 40px;
            height: 40px;
            line-height: 40px;
            text-align: center;
        `;
        closeBtn.onclick = () => {
            previewModal.style.display = 'none';
        };

        // 高清图片容器
        const previewImg = document.createElement('img');
        previewImg.style.cssText = `
            max-width: 100%;
            max-height: 80vh;
            border-radius: 8px;
            margin-bottom: 20px;
        `;

        // 保存按钮
        const saveBtn = document.createElement('button');
        saveBtn.innerText = 'save';
        saveBtn.style.cssText = `
            padding: 10px 24px;
            background: #3B82F6;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            transition: background 0.2s;
        `;
        saveBtn.onmouseenter = () => {
            saveBtn.style.background = '#2563EB';
        };
        saveBtn.onmouseleave = () => {
            saveBtn.style.background = '#3B82F6';
        };

        // 组装弹窗
        modalContent.appendChild(closeBtn);
        modalContent.appendChild(previewImg);
        modalContent.appendChild(saveBtn);
        previewModal.appendChild(modalContent);
        document.body.appendChild(previewModal);

        // 点击弹窗空白处关闭
        previewModal.onclick = (e) => {
            if (e.target === previewModal) {
                previewModal.style.display = 'none';
            }
        };

        // ESC键关闭弹窗
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && previewModal.style.display === 'flex') {
                previewModal.style.display = 'none';
            }
        });
    }

    // 4. 遍历并创建缩略图（完全保留你原有的样式）
    allAssets.forEach((asset, index) => {
        // 创建包裹容器（完全保留你原来的样式，移除所有自定义颜色）
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'entity-item-mini';
        imgWrapper.style.cssText = `
            width: 32px;
            height: 32px;
            border-radius: 4px;
            border: 1px solid #E5E7EB; /* 还原你原本的灰色边框 */
            background-color: #F9FAFB;
            overflow: hidden;
            cursor: pointer;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            position: relative; /* 仅保留删除按钮定位所需 */
            /* 移除margin，恢复你原本一排3个的布局 */
        `;

        const img = document.createElement('img');
        // 路径拼接（保留原有逻辑）
        let fullPath = asset.path;
        if (!fullPath.startsWith('http')) {
            const cleanPath = fullPath.startsWith('/') ? fullPath.substring(1) : fullPath;
            fullPath = `${BACKEND_URL}/${cleanPath}`;
        }

        img.src = fullPath;
        img.style.pointerEvents = 'none';
        // 标题保留原有格式，仅补充output标识（不影响视觉）
        img.title = `${asset.label || `${asset.type === 'entity' ? 'entity' : 'output-image'}-${index}`} (双击放大)`;
        img.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: contain;
        `;

        // ========== 保留原有：删除按钮（样式完全不变） ==========
        const deleteBtn = document.createElement('div');
        deleteBtn.style.cssText = `
            position: absolute;
            top: -6px;
            right: -6px;
            width: 16px;
            height: 16px;
            background-color: #EF4444;
            color: white;
            border-radius: 50%;
            display: none; /* 默认隐藏 */
            justify-content: center;
            align-items: center;
            font-size: 10px;
            font-weight: bold;
            cursor: pointer;
            z-index: 10;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        `;
        deleteBtn.innerText = '×';
        deleteBtn.title = `删除${asset.type === 'output' ? '输出' : '实体'}图片`;

        // 鼠标悬停效果（完全保留你原有逻辑）
        imgWrapper.onmouseenter = () => {
            imgWrapper.style.borderColor = '#3B82F6';
            imgWrapper.style.transform = 'scale(1.05)';
            deleteBtn.style.display = 'flex';
        };

        imgWrapper.onmouseleave = () => {
            imgWrapper.style.borderColor = '#E5E7EB'; // 还原原有边框色
            imgWrapper.style.transform = 'scale(1)';
            deleteBtn.style.display = 'none';
        };

        // 删除按钮点击事件（兼容output图片，逻辑不变）
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            const confirmDelete = window.confirm(`确定要删除${asset.type === 'output' ? '输出' : '实体'}图片 "${asset.label || `${asset.type === 'entity' ? 'entity' : 'output-image'}-${index}`}" 吗？`);
            if (!confirmDelete) return;

            // 根据类型删除对应数组中的元素
            if (asset.type === 'entity' && segmentedAssets) {
                const entityIndex = segmentedAssets.findIndex(item => item.path === asset.path && item.label === asset.label);
                if (entityIndex !== -1) {
                    segmentedAssets.splice(entityIndex, 1);
                }
            } else if (asset.type === 'output' && node && node.assets?.output?.images) {
                const outputIndex = node.assets.output.images.findIndex(item => (item.path || item) === asset.path);
                if (outputIndex !== -1) {
                    node.assets.output.images.splice(outputIndex, 1);
                }
            }

            // 派发删除事件
            window.dispatchEvent(new CustomEvent('delete-entity-asset', {
                detail: { 
                    nodeId: nodeId, 
                    asset: asset,
                    assetType: asset.type,
                    remainingAssets: [...allAssets.filter((_, idx) => idx !== index)]
                }
            }));

            // 更新显示
            updateEntityDisplay(nodeId, segmentedAssets, node);
            
            console.log(`[EntityCard] ${asset.type}图片已删除：${asset.label || `${asset.type === 'entity' ? 'entity' : 'output-image'}-${index}`} in node ${nodeId}`);
        };

        // 5. 单击事件（保留原有逻辑）
        imgWrapper.onclick = (e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('select-entity-asset', {
                detail: { nodeId: nodeId, asset: asset, assetType: asset.type }
            }));
            console.log(`[EntityCard] ${asset.type} image clicked: ${asset.label} in node ${nodeId}`);
        };

        // ========== 保留原有：双击事件（兼容跨域保存） ==========
        imgWrapper.ondblclick = (e) => {
            e.stopPropagation();
            const modal = document.getElementById('entity-preview-modal');
            const previewImg = modal.querySelector('img');
            const saveBtn = modal.querySelector('button:last-child');

            previewImg.src = fullPath;
            previewImg.alt = asset.label || `${asset.type === 'entity' ? 'entity' : 'output-image'}-${index}`;

            saveBtn.onclick = async () => {
                try {
                    const image = new Image();
                    image.crossOrigin = 'anonymous';
                    image.src = fullPath;

                    await new Promise((resolve, reject) => {
                        image.onload = resolve;
                        image.onerror = () => reject(new Error('图片加载失败'));
                    });

                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);

                    const base64Url = canvas.toDataURL('image/png');

                    const a = document.createElement('a');
                    a.href = base64Url;
                    const fileName = `${asset.type}_${asset.label || 'image'}_${Date.now()}.png`;
                    a.download = fileName;
                    a.click();
                    a.remove();
                    canvas.remove();

                    console.log(`[EntityCard] ${asset.type}图片保存成功：${fileName}`);
                } catch (error) {
                    console.error('[EntityCard] 图片保存失败：', error);
                    alert('图片保存失败，请检查图片链接或网络！');
                }
            };

            modal.style.display = 'flex';
            console.log(`[EntityCard] ${asset.type} image double-clicked: ${asset.label} (preview opened)`);
        };

        // 组装元素（保留原有逻辑）
        imgWrapper.appendChild(img);
        imgWrapper.appendChild(deleteBtn);
        container.appendChild(imgWrapper);
    });

    // ========== 保留原有：绘画面板拖拽接收逻辑 ==========
    const initCanvasDrop = () => {
        const drawingBoard = document.getElementById('drawing-board');
        if (!drawingBoard || drawingBoard.dataset.dropInited) return;

        drawingBoard.dataset.dropInited = 'true';

        drawingBoard.style.cssText += `
            min-height: 400px;
            border: 2px dashed #ccc;
            transition: border-color 0.2s, background 0.2s;
            position: relative;
            overflow: hidden;
        `;

        drawingBoard.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            drawingBoard.style.borderColor = '#3B82F6';
            drawingBoard.style.background = 'rgba(59, 130, 246, 0.05)';
        };

        drawingBoard.ondragleave = () => {
            drawingBoard.style.borderColor = '#ccc';
            drawingBoard.style.background = 'transparent';
        };
    };

    initCanvasDrop();
}

// ========== 保留原有：辅助函数 ==========
function makeDraggable(element) {
    let isDragging = false;
    let offsetX, offsetY;

    element.onmousedown = (e) => {
        isDragging = true;
        offsetX = e.clientX - element.getBoundingClientRect().left;
        offsetY = e.clientY - element.getBoundingClientRect().top;
        element.style.zIndex = 20;
        element.style.cursor = 'grabbing';
    };

    document.onmousemove = (e) => {
        if (!isDragging) return;
        const board = document.getElementById('drawing-board');
        const boardRect = board.getBoundingClientRect();
        const x = e.clientX - boardRect.left - offsetX;
        const y = e.clientY - boardRect.top - offsetY;
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
    };

    document.onmouseup = () => {
        if (isDragging) {
            isDragging = false;
            element.style.cursor = 'move';
            element.style.zIndex = 10;
        }
    };
}