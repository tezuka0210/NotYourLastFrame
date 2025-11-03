<template>
  <div id="chart-wrapper" class="bg-white rounded shadow p-3 flex-1 min-h-0" style="position: relative;">
    <svg ref="svgContainer" class="w-full h-full"></svg>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as d3 from 'd3'
import * as dagre from 'dagre'
// 导入我们
import type { AppNode } from '@/composables/useWorkflow'
import { workflowTypes } from '@/composables/useWorkflow'

// --- 1. Props (由 App.vue 传入) ---
const defaultLinkColor = '#9ca3af';

interface DagrePoints {
  x: number;
  y: number;
}

const lineGenerator = d3.line<DagrePoints>()
  .x(d => d.x)
  .y(d => d.y)
  .curve(d3.curveBasis); // <-- (关键) d3.curveBasis 提供了平滑的 B-spline 曲线

const props = defineProps<{
  nodes: AppNode[];       // 所有的节点数据 (平铺数组)
  selectedIds: string[];  // 当前选中的节点ID数组
}>()

// --- 2. Emits (向 App.vue 传出) ---

const emit = defineEmits<{
  (e: 'update:selectedIds', ids: string[]): void; // 用于 v-model
  (e: 'delete-node', nodeId: string): void;
  (e: 'add-clip', node: AppNode, type: 'image' | 'video'): void;
  (e: 'open-preview', url: string, type: 'image' | 'video'): void;
  (e: 'open-generation', node: AppNode): void; 
  (e: 'open-generation', node: AppNode, defaultModuleId: string, workflowType:'preprocess' | 'image' | 'video'): void;
  (e: 'toggle-collapse', nodeId: string): void; 
}>()

// --- 3. 本地 Ref ---

// 创建一个 Vue ref 来引用 <svg> DOM 元素
const svgContainer = ref<SVGSVGElement | null>(null)

// 存储 ResizeObserver 实例，用于响应式缩放
let resizeObserver: ResizeObserver | null = null

// --- 4. 核心：D3 渲染函数 ---

/**
 * 核心渲染函数。它会清空并重绘整个 D3 树状图。
 * @param svgElement D3 绘制的目标 <svg> 元素
 * @param allNodesData 所有的节点数据 (来自 props.nodes)
 * @param selectedIds 选中的节点ID (来自 props.selectedIds)
 */



/** (v60) 递归查找所有子孙节点 ID (用于收缩) */
function findDescendants(
  nodeId: string,
  hierarchy: Map<string, AppNode & { children: AppNode[] }>
): string[] {
  const node = hierarchy.get(nodeId);
  if (!node || !node.children || node.children.length === 0) {
    return [];
  }
  let descendants: string[] = [];
  node.children.forEach(child => {
    descendants.push(child.id);
    descendants = descendants.concat(findDescendants(child.id, hierarchy)); // 递归
  });
  return descendants;
}

/* 计算可见节点和连线 (用于收缩) */
function getVisibleNodesAndLinks(allNodes: AppNode[]): {
  visibleNodes: AppNode[],
  visibleLinks: { source: string, target: string }[] 
} {
  if (!allNodes || allNodes.length === 0) {
    return { visibleNodes: [], visibleLinks: [] };
  }
  // 1. 构建临时的父子层级关系
  const nodeMap = new Map(allNodes.map(n => [n.id, { ...n, children: [] as AppNode[] }]));
  allNodes.forEach(n => {
    if (n.originalParents) { // (v66) 使用 originalParents
      n.originalParents.forEach(parentId => {
        const parent = nodeMap.get(parentId);
        if (parent) {
          parent.children.push(n);
        }
      });
    }
  });

  // 2. 找出所有需要隐藏的节点 ID
  const hiddenNodeIds = new Set<string>();
  allNodes.forEach(node => {
    if (node._collapsed) {
      const descendants = findDescendants(node.id, nodeMap);
      descendants.forEach(id => hiddenNodeIds.add(id));
    }
  });

  // 3. 过滤出可见节点
  const visibleNodes = allNodes.filter(node => !hiddenNodeIds.has(node.id));
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));

  // 4. 构建可见连线
  const visibleLinks: { source: string, target: string }[] = [];
  visibleNodes.forEach(node => { // (v71 修复) 只遍历可见节点
    if (node.originalParents) { // (v66)
      node.originalParents.forEach(parentId => {
        // 源节点也必须可见
        if (visibleNodeIds.has(parentId)) {
          visibleLinks.push({ source: parentId, target: node.id });
        }
      });
    }
  });

  return { visibleNodes, visibleLinks };
}

// (v33) 快速样式更新函数
// (v-NEW) 快速样式更新函数 (纯 .style() 版本)
function updateSelectionStyles(svgElement: SVGSVGElement, selectedIds: string[]) {
  // 定义选中和未选中的样式
  const selectedStyle = '0 0 0 3px #3b82f6'; // 蓝色辉光
  const defaultStyle = 'none';

  d3.select(svgElement).selectAll<SVGGElement, d3.HierarchyNode<any>>('.node')
    .each(function(d) {
      if (d && d.id) {
        const nodeId = d.id;
        const card = d3.select(this).select<HTMLDivElement>('.node-card');
        if (selectedIds.includes(nodeId)) {
          card.style('box-shadow', selectedStyle);
        } else {
          card.style('box-shadow', defaultStyle);
        }
      }
    });
}



function renderTree(svgElement: SVGSVGElement, allNodesData: AppNode[], selectedIds: string[]) {
  // --- A. 数据准备 ---
  const wrapper = d3.select(svgElement);
  wrapper.html('');

  console.log(
    `%c[Debug 1] 传入 renderTree 的原始数据 (allNodesData):`,
    "color: #FFA500; font-weight: bold;",
    allNodesData // (请展开这个数组)
  );

  // (v60) 1. 过滤出可见节点和连线
  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodesData);

  // VVVV 添加这个日志 VVVV
  console.log(
    `%c[Debug 2] 过滤后的可见连线 (visibleLinks):`,
    "color: #FF69B4; font-weight: bold;",
    visibleLinks // (请展开这个数组)
  );
  // ^^^^ 添加这个日志 ^^^^

  if (visibleNodes.length === 0) {
    wrapper.append('text')
      .attr('x', '50%')
      .attr('y', '50%')
      .attr('text-anchor', 'middle')
      .attr('fill', '#9ca3af')
      .text('暂无数据，请从右侧开始生成...')
    return;
  }

  // --- B. (核心 v71) Dagre 布局计算 ---

  // 1. 创建 Dagre 图
  const g = new dagre.graphlib.Graph();
  // 2. 设置布局为 "LR" (Left-to-Right)
  g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 120 }); // nodesep: 节点Y间距, ranksep: 层X间距
  // 3. 设置默认边样式
  g.setDefaultEdgeLabel(() => ({}));

  // 4. (关键) 告诉 Dagre *所有*可见节点的尺寸
  visibleNodes.forEach(node => {
    // (v71) 我们使用固定的 140x140 尺寸
    g.setNode(node.id, { label: node.module_id, width: 140, height: 140 });
  });

  // 5. (关键) 告诉 Dagre 所有的连线
  visibleLinks.forEach(link => {
    g.setEdge(link.source, link.target);
  });

  // 6. (关键) 运行布局！
  dagre.layout(g);

  console.log(
    `%c[Debug 3] Dagre 实际处理的连线 (g.edges()):`,
    "color: #00BFFF; font-weight: bold;",
    g.edges() // (请展开这个数组)
  );


  // 7. (关键) 从 Dagre 获取 计算好 的节点，并存入 Map 方便查找
  const dagreNodes = new Map(g.nodes().map(nodeId => [nodeId, g.node(nodeId)]));

  const dagreEdges = g.edges().map(edgeObj => {
      const edgeData = g.edge(edgeObj); // { points: [ {x,y}, {x,y}, ... ] }
      return { v: edgeObj.v, w: edgeObj.w, points: edgeData.points };
  });
  // --- C. D3 渲染 (现在只负责“画”) ---
  const width = svgElement.clientWidth || 1200;
  const height = svgElement.clientHeight || 600;
  const svg = wrapper
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');
  // (v45) 箭头定义
   const defs = svg.append('defs');
  // 1. 定义我们所有的颜色
  const colorsToDefine = [
    { id: 'red', color: workflowTypes.red.color },
    { id: 'yellow', color: workflowTypes.yellow.color },
    { id: 'green', color: workflowTypes.green.color },
    { id: 'default', color: defaultLinkColor } // (v65) 灰色
  ];

  // 2. 循环并为每种颜色创建一个 marker
  colorsToDefine.forEach(c => {
    defs.append('marker')
      .attr('id', `arrowhead-${c.id}`) // <-- 唯一 ID (例如 "arrowhead-red")
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 10) // (v77 修复)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('xoverflow', 'visible')
    .append('svg:path')
      .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
      .style('fill', c.color) // <-- (核心 v78) 使用对应的颜色
      .style('stroke', 'none');
  });

  // (v71) 我们需要一个 <g> 来容纳 Dagre 的布局
  const layoutGroup = svg.append('g');

  // (v45) 创建 links 和 nodes 的容器 <g>
  const linkGroup = layoutGroup.append('g').attr('class', 'links');
  const nodeGroup = layoutGroup.append('g').attr('class', 'nodes');

  // (v45/v71) Zoom 逻辑
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 2.5])
    .on('zoom', (event) => {
      layoutGroup.attr('transform', event.transform); // (v71) 缩放 layoutGroup
    })
    // (v-NEW) 关键修复：告诉 D3 Zoom 忽略卡片上的所有事件
    .filter((event) => {
      // 检查事件目标 (event.target) 或其任何父元素
      // 是否在 <foreignObject> (即卡片) 内部
      if (event.target && (event.target as HTMLElement).closest('foreignObject')) {
        // 如果是，返回 false，告诉 zoom "不要处理这个事件"
        return false;
      }
      // 否则 (例如，点击 SVG 背景)，返回 true，"允许缩放/拖拽"
      return true;
    });
  svg.call(zoom);
  // (v71) 尝试计算初始缩放和平移以使图居中
  const graphWidth = g.graph().width || width;
  const graphHeight = g.graph().height || height;
  const initialScale = Math.min(1, Math.min(width / graphWidth, height / graphHeight) * 0.9);
  const initialTranslateX = (width - (graphWidth * initialScale)) / 2;
  const initialTranslateY = (height - (graphHeight * initialScale)) / 2;
  svg.call(zoom.transform as any, d3.zoomIdentity.translate(initialTranslateX, initialTranslateY).scale(initialScale));

  // (v31/v71) 背景点击 (原生)
  const svgDomElement = svg.node()!;
  svgDomElement.addEventListener('click', (event) => {
    if (event.target === svgDomElement) {
        console.log("--- 1. 背景被点击 --- (立即取消全选)");
        svgElement.querySelectorAll('.node-card').forEach(card => {
          card.classList.remove('selected');
        });
        emit('update:selectedIds', [])
    }
  });

  // 1. 渲染 Links (不再用物理模拟)
  function getLinkStyle(d: any) {
    // (d.w 是 dagre 边的目标 ID)
    const targetNode = allNodesData.find(n => n.id === d.w);
    const linkColor = targetNode?.linkColor; // (v60)

    if (linkColor === workflowTypes.red.color) {
      return { color: workflowTypes.red.color, id: 'url(#arrowhead-red)' };
    }
    if (linkColor === workflowTypes.yellow.color) {
      return { color: workflowTypes.yellow.color, id: 'url(#arrowhead-yellow)' };
    }
    if (linkColor === workflowTypes.green.color) {
      return { color: workflowTypes.green.color, id: 'url(#arrowhead-green)' };
    }
    // 默认情况
    return { color: defaultLinkColor, id: 'url(#arrowhead-default)' };
  }

  // 2. 渲染 Links (v78 动态版)
  const linkElements = linkGroup.selectAll('path.link')
    .data(dagreEdges)
    .enter().append('path')
      .attr('class', 'link') // (确保 style.css 有 fill: none)
      // (核心 v78)
      // 使用 .each() 来同时设置 stroke 和 marker-end
      .each(function(d) {
        const style = getLinkStyle(d);
        d3.select(this)
          .style('stroke', style.color)
          .attr('marker-end', style.id);
      })
      .attr('d', (d: any) => lineGenerator(d.points));

  // 2. 渲染 Nodes (不再用物理模拟)
  const nodeElements = nodeGroup.selectAll('.node')
    .data(visibleNodes, (d: any) => d.id)
    .enter().append('g')
      .attr('class', 'node')
      // (核心 v71) 从 Dagre 读取坐标
      .attr('transform', (d: any) => {
        const node = dagreNodes.get(d.id)!;
        return `translate(${node.x},${node.y})`;
      });

  // (v68 修复) node.each(...) 循环
  // 包含 fo, div, divNode, 选中逻辑(v39), 删除(×), 三色圆点(v52), 收缩(+/-)(v60)
  // 媒体(+), 标签, Tooltip
  // (v-NEW) node.each(...) 循环 (纯 .style() 版本，移除所有 Tailwind)
  // (v-FINAL-COMPLETE) node.each(...) 3行布局 + 补全所有功能
  nodeElements.each(function (d: any) {
    const gElement = d3.select(this);

    // --- 1. <foreignObject> (140x140) ---
    const fo = gElement.append('foreignObject')
      .attr('width', 140)
      .attr('height', 200) // (注意: 140px 的高度对于 3 行布局来说非常紧张)
      .attr('x', -70)
      .attr('y', -70)
      .style('overflow', 'visible');

    // --- 2. [根 Div] (node-card, 3行布局) ---
    const div = fo.append('xhtml:div')
      .attr('class', 'node-card')
      .style('width', '100%')
      .style('height', '100%')
      .style('display', 'flex')
      .style('flex-direction', 'column') // (v-NEW) 垂直堆叠 3 行
      .style('border-width', '2px')
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff');
    // (v-NEW) 动态边框 .style()
    if (d.status === 'running') { div.style('border-color', '#3b82f6'); }
    else if (d.status === 'success') { div.style('border-color', '#22c55e'); }
    else if (d.status === 'error') { div.style('border-color', '#ef4444'); }
    else { div.style('border-color', '#d1d5db'); }

    // (v-NEW) 更新选中样式 .style()
    div.style('box-shadow', selectedIds.includes(d.id) ? '0 0 0 3px #3b82f6' : 'none');
    // (v-NEW) D3 事件：卡片背景点击
    div.on('click', (event) => {
      // 关键检查：如果点击的是按钮、图片或视频，就忽略卡片选中
      if ((event.target as HTMLElement).closest('button, img, video, .prompt-div-inner')) {
        console.log(`[DEBUG] 点击的是子元素, 忽略卡片选中。`);
        return;
      }
      console.log(`[DEBUG] 卡片 BACKGROUND Clicked (Node ${d.id}). 选中逻辑...`);
      event.stopPropagation();
      // ... (选中逻辑和 emit) ...
      const nodeId = d.id;
      const currentSelectedIds = [...props.selectedIds];
      const index = currentSelectedIds.indexOf(nodeId);
      const selectedStyle = '0 0 0 3px #3b82f6';
      const defaultStyle = 'none';
      if (index > -1) {
        currentSelectedIds.splice(index, 1);
        (event.currentTarget as HTMLDivElement).style.boxShadow = defaultStyle;
      } else {
        if (currentSelectedIds.length < 2) {
            currentSelectedIds.push(nodeId);
            (event.currentTarget as HTMLDivElement).style.boxShadow = selectedStyle;
        } else {
            console.warn("最多只能选择 2 个父节点。");
        }
      }
      emit('update:selectedIds', currentSelectedIds);
    });

    // (v-NEW) D3 事件：悬停 (控制 "..." 和 "▶")
    div.on('mouseenter', function() {
        console.log(`[DEBUG] 卡片 DIV MouseEnter (Node ${d.id})`);
        d3.select(this).selectAll('.add-clip-btn, .dots-container')
            .style('opacity', '1');
    });
    div.on('mouseleave', function() {
        console.log(`[DEBUG] 卡片 DIV MouseLeave (Node ${d.id})`);
        d3.select(this).selectAll('.add-clip-btn, .dots-container')
            .style('opacity', '0');
    });

    // --- 3. [嵌套 Div 1] (Header Row) ---
    // (包含: 标题; X按钮)
    const headerDiv = div.append('xhtml:div')
      .style('display', 'flex')
      .style('justify-content', 'space-between')
      .style('align-items', 'center')
      .style('padding', '4px')
      .style('border-bottom', '1px solid #e5e7eb')
      .style('flex-shrink', '0'); // (v-NEW) 不收缩
    // 3a. 标题 (这就是你原来的 node-label)
    headerDiv.append('xhtml:h3')
      .style('font-size', '12px')
      .style('font-weight', '700')
      .style('color', '#1f2937')
      .style('overflow', 'hidden')
      .style('text-overflow', 'ellipsis')
      .style('white-space', 'nowrap')
      .text(d.module_id || '(节点)');

    // 3b. 删除按钮 "×"
    if (d.module_id !== 'Init' && d.module_id !== 'ROOT') {
      headerDiv.append('xhtml:button')
        .style('background-color', '#ef4444')
        .style('color', '#ffffff')
        .style('border-radius', '4px')
        .style('width', '16px')
        .style('height', '16px')
        .style('font-size', '12px')
        .style('line-height', '16px')
        .style('text-align', 'center')
        .style('border', 'none')
        .style('cursor', 'pointer')
        .style('flex-shrink', '0') // (v-NEW) 防止被标题挤压
        .text('X')
        .on('mousedown', (event) => {
          console.log(`[DEBUG] 'X' 按钮 MouseDown (Node ${d.id}). 阻止冒泡。`);
          event.stopPropagation();
        })
        .on('click', (event) => {
          console.log(`[DEBUG] 'X' 按钮 Clicked (Node ${d.id})`);
          event.stopPropagation();
          emit('delete-node', d.id);
        });
    }

    // --- (v-NEW) 提取媒体信息 ---
    const hasMedia = d.media && d.media.rawPath;
    const mediaUrl = hasMedia ? d.media.url : '';
    const rawPath = hasMedia ? d.media.rawPath : '';
    const isVideo = (typeof rawPath === 'string') && (rawPath.includes('.mp4') || rawPath.includes('subfolder=video'));
    const canAddToStitch = hasMedia;

    //  console.log(`[Debug Node ${d.id} (${d.module_id})]`, {
    //     d_object: d, // 1. 打印整个 'd' 对象
    //     parameters: d.parameters, // 2. 单独打印 'd.parameters'
    //     positive_prompt: d.parameters ? d.parameters.positive_prompt : 'N/A' // 3. 打印 'positive_prompt'
    // });
    // ^^^^ 添加调试日志结束 ^^^^
    // --- (v-FIX) 修正 Prompt 逻辑 ---
    // 1. promptText 直接就是参数中的字符串
    const promptText = (d.parameters && d.parameters.positive_prompt)
                        ? d.parameters.positive_prompt
                        : null;
    // 2. hasPrompt 直接检查这个字符串
    const hasPrompt = (promptText && typeof promptText === 'string' && promptText.trim() !== '');
    // VVVV 再添加一个日志 VVVV
    // 过滤掉根节点，它们没有 prompt
    if (d.module_id !== 'Init' && d.module_id !== 'ROOT') {
        console.log(`[Debug Node ${d.id}] promptText: '${promptText}', hasPrompt: ${hasPrompt}`);
    }
    // ^^^^ 添加日志结束 ^^^^


    // --- 4. [嵌套 Div 2] (Content Row) ---
    // (包含: 图片/视频; 三色按钮)
    const contentDiv = div.append('xhtml:div')
      .style('flex-grow', hasPrompt ? '0' : '1') // (v-NEW) 如果有 prompt，则不增长
      .style('flex-shrink', hasPrompt ? '0' : '1')
      .style('height', hasPrompt ? '60px' : 'auto') // (v-NEW) 如果有 prompt，则固定 60px 高
      .style('min-height', '0')
      .style('position', 'relative'); // 必须是 relative，为了定位三色按钮

    // 4a. 媒体/占位符
    if (hasMedia) {
      const thumbStyles = {
        'width': '100%',
        'height': '100%',
        'object-fit': 'cover',
        'display': 'block'
      };
      if (isVideo) {
          // --- 视频元素 ---
          const videoEl = contentDiv.append('xhtml:video')
            .style('width', thumbStyles.width)
            .style('height', thumbStyles.height)
            .style('object-fit', thumbStyles['object-fit'])
            .style('display', thumbStyles.display)
            .attr('muted', true)
            .attr('playsinline', true)
            .attr('preload', 'metadata')
            .on('mousedown', (ev) => { ev.stopPropagation(); })
            .on('click', (ev) => {
              console.log(`[DEBUG] 视频 Clicked (Node ${d.id}). 打开预览。`);
              ev.stopPropagation();
              emit('open-preview', mediaUrl, d.media.type);
            });
          (videoEl.node() as HTMLVideoElement).autoplay = true;
          (videoEl.node() as HTMLVideoElement).loop = true;
          (videoEl.node() as HTMLVideoElement).muted = true;
          (videoEl.node() as HTMLVideoElement).playsInline = true;
          (videoEl.node() as HTMLVideoElement).src = mediaUrl;
      } else {
          // --- 图片元素 ---
          contentDiv.append('xhtml:img')
            .style('width', thumbStyles.width)
            .style('height', thumbStyles.height)
            .style('object-fit', thumbStyles['object-fit'])
            .style('display', thumbStyles.display)
            .attr('src', mediaUrl)
            .attr('alt', d.module_id || 'thumb')
            .on('mousedown', (ev) => { ev.stopPropagation(); })
            .on('click', (ev) => {
              console.log(`[DEBUG] 图片 Clicked (Node ${d.id}). 打开预览。`);
              ev.stopPropagation();
              emit('open-preview', mediaUrl, d.media.type);
            });
      }
    } else {
        // (v-NEW) --- “无缩略图”占位符 (我之前遗漏的) ---
        contentDiv.append('xhtml:div')
            .style('width', '100%')
            .style('height', '100%')
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('justify-content', 'center')
            .style('font-size', '12px')
            .style('color', '#6b7280') // (原 text-gray-500)
            .text('无缩略图');
    }

    // 4b. 三色圆点 (定位在 contentDiv 内部)
    const dotsContainer = contentDiv.append('xhtml:div')
      .attr('class', 'dots-container')
      .style('position','absolute')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('opacity', '0') // 默认隐藏
      .style('transition', 'opacity 0.15s ease-in-out')
      .style('z-index', '10')
      .style('top','4px')
      .style('right','4px');
    (['red', 'yellow', 'green'] as const).forEach((colorKey, index) => {
      const workflowInfo = workflowTypes[colorKey];
      dotsContainer.append('xhtml:button')
        .style('background-color', workflowInfo.color)
        .style('width', '16px')
        .style('height', '16px')
        .style('border-radius', '50%')
        .style('border', 'none')
        .style('padding', '0')
        .style('cursor', 'pointer')
        .style('transition', 'transform 0.15s ease-in-out')
        .style('margin-top', index > 0 ? '4px' : '0')
        .attr('title', `Start ${workflowInfo.type} workflow`)
        .on('mouseenter', function() { d3.select(this).style('transform', 'scale(1.25)'); })
        .on('mouseleave', function() { d3.select(this).style('transform', 'scale(1)'); })
        .on('mousedown', (event) => {
          console.log(`[DEBUG] '...' 按钮 MouseDown (Node ${d.id}). 阻止冒泡。`);
          event.stopPropagation();
        })
        .on('click', (event) => {
          console.log(`[DEBUG] '...' 按钮 Clicked (Node ${d.id})`);
          event.stopPropagation();
          emit('open-generation', d, workflowInfo.defaultModuleId, workflowInfo.type as 'preprocess' | 'image' | 'video');
        });
    });

    // --- 5. [嵌套 Div 3] (Prompt Row) ---
    // (v-NEW) 只有在有提示词时才创建这个 Div
    if (hasPrompt) {
      const promptDiv = div.append('xhtml:div')
        .attr('class', 'prompt-div-inner') // (v-NEW) 用于点击检测
        .style('flex-grow', '1') // (v-NEW) 填满剩余空间
        .style('flex-shrink', '1')
        .style('min-height', '0') // (v-NEW) 关键
        .style('overflow-y', 'auto') // (v-NEW) 允许滚动
        .style('padding', '4px')
        .style('border-top', '1px solid #e5e7eb')
        .style('font-size', '10px')
        .style('color', '#374151') // (gray-700)
        .style('white-space', 'pre-wrap') // (v-NEW) 尊重换行
        .style('word-break', 'break-all') // (v-NEW) 自动断词
        .on('mousedown', (event) => { // (v-NEW) 允许在 text-area 内滚动
            event.stopPropagation();
        });

      // (v-NEW) 显示提示词内容
      promptDiv.append('xhtml:div')
        .text(promptText);
    }


    // --- 5. [嵌套 Div 3] (Footer Row) ---
    // (包含: ▶按钮)
    const footerDiv = div.append('xhtml:div')
        .style('display', 'flex')
        .style('justify-content', 'flex-end') // 把按钮推到右边
        .style('padding', '2px');
        // (v-NEW) 关键: 如果没有 "▶" 按钮，这个 div 几乎没有高度 (2px padding)

    // 5a. "▶" 按钮 (移到 footerDiv 内部)
    if (canAddToStitch) {
      footerDiv.append('xhtml:button')
        .attr('class', 'add-clip-btn')
        .html('&#9658;')
        .style('opacity', '0') // 默认隐藏
        .style('transition', 'opacity 0.15s ease-in-out')
        // (v-NEW) 移除 'position: absolute'
        .style('width', '20px')
        .style('height', '20px')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('color', '#3b82f6')
        .style('font-size', '1.125rem')
        .style('border', 'none')
        .style('background-color', 'transparent')
        .style('padding', '0')
        .style('cursor', 'pointer')
        .on('mousedown', (event) => {
          console.log(`[DEBUG] '▶' 按钮 MouseDown (Node ${d.id}). 阻止冒泡。`);
          event.stopPropagation();
        })
        .on('click', (event) => {
            console.log(`[DEBUG] '▶' 按钮 Clicked (Node ${d.id})`);
            event.stopPropagation();
            emit('add-clip', d, isVideo ? 'video' : 'image');
        });
    }

    // --- 6. [绝对定位的按钮] (只剩下 +/-) ---
    // (v60) "+/-" 收缩/展开按钮 (浮动在根 div 上)
    const tempNodeMap = new Map(allNodesData.map(n => [n.id, { ...n, children: [] as AppNode[] }]));
    allNodesData.forEach(n => {
      if (n.originalParents) {
        n.originalParents.forEach((pId: string) => {
          const parent = tempNodeMap.get(pId);
          if (parent) {
            parent.children.push(n);
          }
        });
      }
    });
    const nodeInMap = tempNodeMap.get(d.id);
    const hasChildren = nodeInMap ? nodeInMap.children.length > 0 : false;

    if (hasChildren) {
      div.append('xhtml:button')
        .style('position', 'absolute')
        .style('bottom', '0')
        .style('left', '0')
        .style('background-color', '#9ca3af')
        .style('color', '#ffffff')
        .style('border-radius', '9999px')
        .style('width', '16px')
        .style('height', '16px')
        .style('font-size', '12px')
        .style('line-height', '16px')
        .style('text-align', 'center')
        .style('font-weight', '700')
        .style('z-index', '10')
        .style('border', 'none')
        .style('cursor', 'pointer')
        .style('transition', 'background-color 0.15s ease-in-out')
        .style('transform', 'translate(-25%, 25%)')
        .text(d._collapsed ? '+' : '-')
        .on('mouseenter', function() { d3.select(this).style('background-color', '#4b5563'); })
        .on('mouseleave', function() { d3.select(this).style('background-color', '#9ca3af'); })
        .on('mousedown', (event) => {
          console.log(`[DEBUG] '+/-' 按钮 MouseDown (Node ${d.id}). 阻止冒泡。`);
          event.stopPropagation();
        })
        .on('click', (event) => {
          console.log(`[DEBUG] '+/-' 按钮 Clicked (Node ${d.id})`);
          event.stopPropagation();
          emit('toggle-collapse', d.id);
        });
    }

    // --- 7. Tooltip (你原来的 L539) ---
    const titleText = (d.module_id || '') + (d.created_at ? ' · ' + d.created_at : '') + (d.status ? ' · ' + d.status : '');
    gElement.attr('title', titleText);
  });
}


/**
 * (v-NEW) 仅更新节点和连线的可见性，而不重置缩放或重新布局
 * (用于折叠/展开)
 */
function updateVisibility(svgElement: SVGSVGElement, allNodesData: AppNode[]) {
  // 1. (v60) 重新计算可见节点和连线
  // (这是你文件中已有的函数，我们直接复用它)
  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodesData);
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
  // (v-NEW) dagreEdges (d.v/d.w) 使用原始 ID，所以我们也用
  const visibleLinkIds = new Set(visibleLinks.map(l => `${l.source}->${l.target}`));

  console.log(`[UpdateVisibility] ${visibleNodeIds.size} nodes, ${visibleLinkIds.size} links visible.`);

  // 2. 更新节点 (Node) 的可见性
  // (我们选择所有 .node，并根据 d.id 是否在 new visible set 中来切换 display)
  d3.select(svgElement).selectAll<SVGGElement, AppNode>('.node')
    .style('display', function(d) {
      // d 是我们绑定到 .node 上的 AppNode 数据 (d.id)
      return visibleNodeIds.has(d.id) ? null : 'none'; // null 会移除内联样式
    });

  // 3. 更新连线 (Link) 的可见性
  // (我们选择所有 .link，并根据 d.v 和 d.w (source/target ID) 来切换 display)
  d3.select(svgElement).selectAll<SVGPathElement, any>('.link')
    .style('display', function(d) {
      // d 是 dagreEdges 的数据: { v: sourceId, w: targetId, points: [...] }
      const linkId = `${d.v}->${d.w}`;
      return visibleLinkIds.has(linkId) ? null : 'none';
    });
}


// --- 5. Vue 生命周期钩子 ---

// (核心) 监听 props 的变化，并在变化时重绘 D3
// (v-NEW 核心) 智能 Watch 钩子
watch(
  () => props.nodes,
  (newNodes, oldNodes) => {
    if (!svgContainer.value) return;

    // 1. 检查结构是否发生变化 (添加/删除节点)
    let structureChanged = false;
    if (!oldNodes || newNodes.length !== oldNodes.length) {
      structureChanged = true;
    } else {
      // (v-NEW) 如果长度相同，我们必须检查 ID 集合是否也相同
      // 这是一个更昂贵但更准确的检查
      const newIds = new Set(newNodes.map(n => n.id));
      for (const node of oldNodes) {
        if (!newIds.has(node.id)) {
          structureChanged = true;
          break;
        }
      }
    }

    if (structureChanged) {
      // --- A. 结构性变化 -> 完整重绘 (会重置缩放) ---
      console.log("%c[Tree] WATCH (Nodes) -> 结构变化，重绘整棵树", "color: red; font-weight: bold;");
      renderTree(svgContainer.value, newNodes, props.selectedIds);
    } else {
      // --- B. 非结构性变化 (e.g. Collapse/Expand) -> 仅更新可见性 ---
      console.log("%c[Tree] WATCH (Nodes) -> 状态变化 (e.g. collapse), 仅更新可见性", "color: blue; font-weight: bold;");
      // (v-NEW) 调用我们的新函数
      // 这个函数 不会 重置缩放
      updateVisibility(svgContainer.value, newNodes);
    }
  },
  { deep: true } 
);

// (v-NEW) 你的第二个 watch 钩子 (用于 selectedIds) 保持不变
watch(
  () => props.selectedIds,
  (newSelectedIds) => {
    // ... (这个钩子保持和你原来的一样) ...
    console.log(
      `%c[Tree]2. WATCH (selectedIds) -> 正在更新样式`,
      "color: #209CEE; font-weight: bold;",
      newSelectedIds
    );
    if (svgContainer.value) {
      updateSelectionStyles(svgContainer.value, newSelectedIds);
    }
  },
  { deep: true }
);

onMounted(() => {
  const container = svgContainer.value
  if (!container) return

  // 1. 初始渲染
  renderTree(container, props.nodes, props.selectedIds)
  // 2. (重要) 设置 ResizeObserver 来实现响应式
  // 我们观察 SVG 的父元素 (#chart-wrapper)
  /*const wrapperEl = container.parentElement
  if (wrapperEl) {
    resizeObserver = new ResizeObserver(() => {
      // 当父元素尺寸变化时，重新渲染
      renderTree(container, props.nodes, props.selectedIds)
    })
    resizeObserver.observe(wrapperEl)
  }*/
})

onUnmounted(() => {
  // 3. (重要) 组件卸载时，停止观察，防止内存泄漏
  /*if (resizeObserver) {
    resizeObserver.disconnect()
  }*/
})
</script>