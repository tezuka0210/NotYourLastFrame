/**
 * EntityCard.js
 * 专门负责在 D3 渲染出的节点卡片中填充实体（Entity）缩略图
 */

/**
 * EntityCard.js
 * 专门负责在 D3 渲染出的节点卡片中填充实体（Entity）缩略图
 * 修复：保存图片功能（兼容跨域图片下载）
 */

export function updateEntityDisplay(nodeId, segmentedAssets) {
    // 1. 定位 D3 在 workflowGraph.js 中创建的 foreignObject 内部容器
    const container = document.getElementById(`entities-${nodeId}`);
    
    if (!container) return;

    // 2. 清空现有内容
    container.innerHTML = '';

    // 3. 数据校验
    if (!segmentedAssets || !Array.isArray(segmentedAssets) || segmentedAssets.length === 0) {
        return;
    }

    // 定义后端基础地址
    const BACKEND_URL = 'http://localhost:5005';

    // ========== 新增：创建放大预览弹窗（全局唯一） ==========
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

    // 4. 遍历并创建缩略图
    segmentedAssets.forEach((asset, index) => {
        // 创建包裹容器
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'entity-item-mini';
        imgWrapper.style.cssText = `
            width: 32px;
            height: 32px;
            border-radius: 4px;
            border: 1px solid #E5E7EB;
            background-color: #F9FAFB;
            overflow: hidden;
            cursor: pointer;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        `;

        const img = document.createElement('img');
        // 路径拼接
        let fullPath = asset.path;
        if (!fullPath.startsWith('http')) {
            const cleanPath = fullPath.startsWith('/') ? fullPath.substring(1) : fullPath;
            fullPath = `${BACKEND_URL}/${cleanPath}`;
        }

        img.src = fullPath;
        img.style.pointerEvents = 'none';
        img.title = `${asset.label || `entity-${index}`} (双击放大)`;
        img.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: contain;
        `;

        // ========== 新增：删除按钮 ==========
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
        deleteBtn.title = '删除该实体';

        // 鼠标悬停时显示删除按钮
        imgWrapper.onmouseenter = () => {
            imgWrapper.style.borderColor = '#3B82F6';
            imgWrapper.style.transform = 'scale(1.05)';
            deleteBtn.style.display = 'flex'; // 显示删除按钮
        };

        // 鼠标离开时隐藏删除按钮
        imgWrapper.onmouseleave = () => {
            imgWrapper.style.borderColor = '#E5E7EB';
            imgWrapper.style.transform = 'scale(1)';
            deleteBtn.style.display = 'none'; // 隐藏删除按钮
        };

        // 删除按钮点击事件
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); // 阻止事件冒泡到父元素
            // 1. 确认删除（可选：增加确认提示）
            const confirmDelete = window.confirm(`确定要删除实体 "${asset.label || `entity-${index}`}" 吗？`);
            if (!confirmDelete) return;

            // 2. 删除数组中的对应实体
            segmentedAssets.splice(index, 1);
            
            // 3. 派发删除事件（供外部监听处理）
            window.dispatchEvent(new CustomEvent('delete-entity-asset', {
                detail: { 
                    nodeId: nodeId, 
                    asset: asset,
                    remainingAssets: [...segmentedAssets] // 传递剩余实体
                }
            }));

            // 4. 更新显示
            updateEntityDisplay(nodeId, segmentedAssets);
            
            console.log(`[EntityCard] 实体已删除：${asset.label || `entity-${index}`} in node ${nodeId}`);
        };


        // 5. 单击事件（保留原有逻辑）
        imgWrapper.onclick = (e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('select-entity-asset', {
                detail: { nodeId: nodeId, asset: asset }
            }));
            console.log(`[EntityCard] Entity clicked: ${asset.label} in node ${nodeId}`);
        };

        // ========== 修复核心：双击事件（兼容跨域保存） ==========
        imgWrapper.ondblclick = (e) => {
            e.stopPropagation();
            const modal = document.getElementById('entity-preview-modal');
            const previewImg = modal.querySelector('img');
            const saveBtn = modal.querySelector('button:last-child');

            // 设置高清图片地址
            previewImg.src = fullPath;
            previewImg.alt = asset.label || `entity-${index}`;

            // ========== 修复保存逻辑：通过Canvas转换Base64实现下载 ==========
            saveBtn.onclick = async () => {
                try {
                    // 1. 加载图片（解决跨域问题）
                    const image = new Image();
                    // 关键：允许跨域（需后端配合设置CORS头 Access-Control-Allow-Origin: *）
                    image.crossOrigin = 'anonymous';
                    image.src = fullPath;

                    // 等待图片加载完成
                    await new Promise((resolve, reject) => {
                        image.onload = resolve;
                        image.onerror = () => reject(new Error('图片加载失败'));
                    });

                    // 2. 创建Canvas并绘制图片
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);

                    // 3. 转换为Base64（PNG格式）
                    const base64Url = canvas.toDataURL('image/png');

                    // 4. 创建下载链接
                    const a = document.createElement('a');
                    a.href = base64Url;
                    // 自定义文件名
                    const fileName = `${asset.label || 'entity'}_${Date.now()}.png`;
                    a.download = fileName;
                    // 触发下载
                    a.click();
                    // 清理临时元素
                    a.remove();
                    canvas.remove();

                    console.log(`[EntityCard] 图片保存成功：${fileName}`);
                } catch (error) {
                    console.error('[EntityCard] 图片保存失败：', error);
                    alert('图片保存失败，请检查图片链接或网络！');
                }
            };

            // 显示弹窗
            modal.style.display = 'flex';
            console.log(`[EntityCard] Entity double-clicked: ${asset.label} (preview opened)`);
        };

        // 悬停效果
        imgWrapper.onmouseenter = () => {
            imgWrapper.style.borderColor = '#3B82F6';
            imgWrapper.style.transform = 'scale(1.05)';
        };
        imgWrapper.onmouseleave = () => {
            imgWrapper.style.borderColor = '#E5E7EB';
            imgWrapper.style.transform = 'scale(1)';
        };

        imgWrapper.appendChild(img);
        container.appendChild(imgWrapper);
        
    });
    // ========== 3. 绘画面板拖拽接收逻辑（全局注册，只需执行一次） ==========
    const initCanvasDrop = () => {
        // 替换为你的绘画面板ID（比如 <div id="drawing-board"></div>）
        const drawingBoard = document.getElementById('drawing-board');
        if (!drawingBoard || drawingBoard.dataset.dropInited) return;

        // 标记已初始化，避免重复绑定
        drawingBoard.dataset.dropInited = 'true';

        // 样式：拖拽进入时高亮
        drawingBoard.style.cssText += `
            min-height: 400px;
            border: 2px dashed #ccc;
            transition: border-color 0.2s, background 0.2s;
            position: relative;
            overflow: hidden;
        `;

        // 1. 阻止默认行为（否则浏览器会打开图片URL）
        drawingBoard.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy'; // 提示“复制”类型的拖拽
            // 拖拽进入时高亮画板
            drawingBoard.style.borderColor = '#3B82F6';
            drawingBoard.style.background = 'rgba(59, 130, 246, 0.05)';
        };

        // 2. 拖拽离开时恢复样式
        drawingBoard.ondragleave = () => {
            drawingBoard.style.borderColor = '#ccc';
            drawingBoard.style.background = 'transparent';
        };

    };

    // 初始化画板拖拽逻辑
    initCanvasDrop();
}

// ========== 辅助函数：让画板内的图片可拖拽调整位置 ==========
function makeDraggable(element) {
    let isDragging = false;
    let offsetX, offsetY;

    element.onmousedown = (e) => {
        isDragging = true;
        // 计算鼠标相对于元素的偏移
        offsetX = e.clientX - element.getBoundingClientRect().left;
        offsetY = e.clientY - element.getBoundingClientRect().top;
        // 提升层级，避免被遮挡
        element.style.zIndex = 20;
        element.style.cursor = 'grabbing';
    };

    document.onmousemove = (e) => {
        if (!isDragging) return;
        // 获取画板容器
        const board = document.getElementById('drawing-board');
        const boardRect = board.getBoundingClientRect();
        // 计算元素在画板内的位置
        const x = e.clientX - boardRect.left - offsetX;
        const y = e.clientY - boardRect.top - offsetY;
        // 更新位置
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