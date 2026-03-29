// src/lib/workflowGraph.js
import * as d3 from 'd3'
import * as dagre from 'dagre'
import WaveSurfer from 'wavesurfer.js'

import { workflowParameters } from '@/lib/useWorkflowForm.js';
import { setPrevAgentContext, clearPrevAgentContext } from '@/lib/agentSharedState.js';
import { updateEntityDisplay } from '@/lib/entityCard.js';


// --- link color: light gray for all edges ---
const defaultLinkColor = '#D1D5DB' // gray-300 #D1D5DB

// --- node category palette (paper-friendly, from CSS variables) ---
const NODE_COLORS = {
  auxBorder:  'var(--media-aux-border)',

  image:      'var(--media-image)',
  video:      'var(--media-video)',
  audio:      'var(--media-audio)',
  overlap:    'var(--media-overlap, #7385A9)',

  imageSoft:  'var(--media-image-soft)',
  videoSoft:  'var(--media-video-soft)',
  audioSoft:  'var(--media-audio-soft)',
  overlapSoft:'var(--media-overlap-soft, #dbe2ee)',
}

// 允许在运行时刷新节点颜色（CSS 变量改变后调用）
export function refreshNodeColors() {
  NODE_COLORS.image = getCSSVar('--media-image', NODE_COLORS.image);
  NODE_COLORS.video = getCSSVar('--media-video', NODE_COLORS.video);
  NODE_COLORS.audio = getCSSVar('--media-audio', NODE_COLORS.audio);
  NODE_COLORS.text = getCSSVar('--media-text', NODE_COLORS.text);
  NODE_COLORS.auxBorder = getCSSVar('--media-aux-border', NODE_COLORS.auxBorder);
  NODE_COLORS.overlap = getCSSVar('--media-overlap', NODE_COLORS.overlap);
  NODE_COLORS.overlapSoft = getCSSVar('--media-overlap-soft', NODE_COLORS.overlapSoft);
}

// ---- 可配置的布局参数（默认值与之前一致） ----
let layoutConfig = {
  nodesep: 100,
  ranksep: 120,
};

// 对外暴露：更新 layoutConfig
export function setLayoutConfig(newConfig = {}) {
  if (typeof newConfig.nodesep === 'number') {
    layoutConfig.nodesep = newConfig.nodesep;
  }
  if (typeof newConfig.ranksep === 'number') {
    layoutConfig.ranksep = newConfig.ranksep;
  }
}

/**
 * 创建统一配置的 dagre graph
 */
function createDagreGraph() {
  // Dagre 布局
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR',
    // align: 'UL',
    nodesep: layoutConfig.nodesep,
    ranksep: layoutConfig.ranksep,
    marginx: 40,
    marginy: 40,
  })
  g.setDefaultEdgeLabel(() => ({}));

  return g;
}

/**
 * 读取 CSS 变量的工具函数
 * @param {string} name - 例如 '--media-image'
 */
function getCSSVar(name, fallback = '') {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback
}


// selection shadow color is same as category color, but used in box-shadow
function getNodeCategory(node) {
  // 新增：复合节点特殊处理
  if (node.isComposite) return 'composite';
  
  // const hasIVMedia = !!(node.assets && node.assets.output && node.assets.output.images && node.assets.output.images.length > 0)
  // const hasAudioMedia = !!(node.assets && node.assets.output && node.assets.output.audio && node.assets.output.audio.length > 0)
  // const hasMedia = hasIVMedia || hasAudioMedia
  // const rawIVPath = hasIVMedia ? node.assets.output.images[0] : ''
  // const rawAudioPath = hasAudioMedia? node.assets.output.audio[0]:''
  // // 从路径推断媒体类型（因为原数据中没有 type 字段）
  // const mediaType = rawIVPath.includes('.png') || rawIVPath.includes('.jpg') || rawIVPath.includes('.jpeg') ? 'image' 
  //   : rawIVPath.includes('.mp4') ? 'video' 
  //   : rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') ? 'audio' 
  //   : ''
  //console.log(`getNodeCategory,${mediaType}`)
  // const isAudioMedia =
  //   typeof rawAudioPath === 'string' &&
  //   (rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') || rawAudioPath.includes('subfolder=audio') || mediaType === 'audio')
  const isAudioMedia = (node.module_id=='TextToAudio')

  // const isVideoMedia =
  //   typeof rawIVPath === 'string' &&
  //   (rawIVPath.includes('.mp4') || rawIVPath.includes('subfolder=video') || mediaType === 'video')
  const isVideoMedia = (node.module_id=='TextGenerateVideo')||(node.module_id=='ImageGenerateVideo')||(node.module_id=='FLFrameToVideo')||(node.module_id=='TextToVideo'||(node.module_id=='CameraControl')||(node.module_id=='FrameInterpolation'))

  const isImageMedia = (node.module_id!='AddText')&&(node.module_id!='AddWorkflow')&&!isAudioMedia&&!isVideoMedia;

  if (isAudioMedia) {
    //console.log(`audio`)
    return 'audio'
  }
  if (isImageMedia) {
    //console.log(`image`)
    return 'image'
  }
  if (isVideoMedia) {
    //console.log(`video`)
    return 'video'
  }
  //console.log(`aux`)
  return 'aux'
}

function getNodeBorderColor(node) {
  const cat = getNodeCategory(node)
  if (cat === 'composite') return NODE_COLORS.overlap
  if (cat === 'audio') return NODE_COLORS.audio
  if (cat === 'image') return NODE_COLORS.image
  if (cat === 'video') return NODE_COLORS.video
  return NODE_COLORS.auxBorder
}

function getSelectionColor(node) {
  const cat = getNodeCategory(node)
  if (cat === 'composite') return NODE_COLORS.overlap
  if (cat === 'audio') return NODE_COLORS.audio
  if (cat === 'image') return NODE_COLORS.image
  if (cat === 'video') return NODE_COLORS.video
  return '#CBD5E1'
}

function getNodeHeaderBaseLabel(node) {
  if (node.isComposite) return node.label || `Overlap State (${node.combinedNodes?.length || 0})`

  const mid = (node.module_id || '').toLowerCase()

  if (mid === 'addtext') return 'Note'
  if (mid === 'addworkflow') return 'Plan'

  return node.module_id || 'State'
}

function getNodeMetaTag(node) {
  if (node.isComposite) return 'overlap state'
  const mid = (node.module_id || '').toLowerCase()
  if (mid === 'init') return 'root state'
  if (mid === 'addtext') return 'draft note'
  if (mid === 'addworkflow') return 'plan state'
  const cat = getNodeCategory(node)
  if (cat === 'image') return 'image draft'
  if (cat === 'video') return 'video draft'
  if (cat === 'audio') return 'audio draft'
  return 'draft state'
}

/** 统一控制卡片选中样式 */
function setCardSelected(cardSel, nodeData, isSelected) {
  // 只通过 class 控制选中状态，具体阴影 & 颜色交给 CSS
  cardSel.classed('is-selected', isSelected)
  // 不再在这里写 box-shadow，避免覆盖你在 CSS 里的
}

/** 折叠状态：按钮“颜色反转” */
function applyCollapseBtnStyle(btnSel, isCollapsed) {
  // collapsed: 反转（深底白字）；expanded: 普通（白底灰字）
  if (isCollapsed) {
    btnSel
      .style('background', '#6b7280')   // gray-500
      .style('color', '#ffffff')
      .style('border-color', '#4b5563') // gray-600
  } else {
    btnSel
      .style('background', '#ffffff')
      .style('color', '#9ca3af')        // gray-400
      .style('border-color', '#e5e7eb')
  }
}

function applyCollapseBtnHoverStyle(btnSel, isCollapsed) {
  // hover 不改变语义，只做轻微强调
  if (isCollapsed) {
    // collapsed 状态 hover：稍微更深一点
    btnSel
      .style('background', '#4b5563')   // gray-600
      .style('color', '#ffffff')
      .style('border-color', '#374151') // gray-700
  } else {
    // expanded 状态 hover：轻微灰底提示可点
    btnSel
      .style('background', '#f3f4f6')   // gray-100
      .style('color', '#6b7280')        // gray-500
      .style('border-color', '#d1d5db') // gray-300
  }
}

/** 统一：collapsed 节点强制视为“视觉选中” */
function isVisuallySelected(nodeData, selectedIds = []) {
  return !!(nodeData && (nodeData._collapsed || selectedIds.includes(nodeData.id)))
}


const lineGenerator = d3.line()
  .x(d => d.x)
  .y(d => d.y)
  .curve(d3.curveBasis)

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '--:--'
  const min = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  return `${min}:${sec < 10 ? '0' : ''}${sec}`
}

/** 递归查找子孙（用于收缩控制） */
function findDescendants(nodeId, hierarchy) {
  const node = hierarchy.get(nodeId)
  if (!node || !node.children || node.children.length === 0) return []
  let descendants = []
  node.children.forEach(child => {
    descendants.push(child.id)
    descendants = descendants.concat(findDescendants(child.id, hierarchy))
  })
  return descendants
}

/** 基于 _collapsed 计算可见节点与连线 */

export function getVisibleNodesAndLinks(allNodes) {
  if (!allNodes || allNodes.length === 0) {
    return { visibleNodes: [], visibleLinks: [] }
  }

  const nodeMap = new Map(allNodes.map(n => [n.id, { ...n, children: [] }]))
  allNodes.forEach(n => {
    if (n.originalParents && n.originalParents.length > 0) { // 新增：判断有父节点
      // 改动1：只取第一个父节点，不再遍历所有parentId
      const parentId = n.originalParents[0]; 
      const p = nodeMap.get(parentId)
      if (p) p.children.push(n)
    }
  })

  const hidden = new Set()
  allNodes.forEach(node => {
    if (node._collapsed) {
      findDescendants(node.id, nodeMap).forEach(id => hidden.add(id))
    }
    // 新增：隐藏被组合的节点
    //if (node.isCombined) hidden.add(node.id);
  })

   const visibleNodes = allNodes.filter(n => !hidden.has(n.id))
  const visibleIds = new Set(visibleNodes.map(n => n.id))
  
  // --- 调试点 2: 检查 ID 存在性 ---
  console.log("当前可见节点 IDs:", Array.from(visibleIds));

  const visibleLinks = []
  visibleNodes.forEach(n => {
    if (n.originalParents) {
      n.originalParents.forEach(pId => {
        const isParentVisible = visibleIds.has(pId);
        // 如果你发现 2 和 3 都明明在上面打印的 ID 列表里，但这里判断为 false，说明 ID 类型不匹配（String vs Number）
        if (isParentVisible) {
          visibleLinks.push({ source: pId, target: n.id });
        } else {
          // --- 调试点 3: 追踪丢失的连线 ---
          console.warn(`节点[${n.id}] 试图连接父节点[${pId}]，但该父节点不可见(被隐藏或已删除)`);
        }
      })
    }
  })
  return { visibleNodes, visibleLinks }
}



/** 粗略推断当前“卡片类型” */
function inferCardType(node) {
  const mid = (node.module_id || '').trim()

  if (mid === 'Init') return 'init'
  if (mid === 'AddText') return 'textFull'
  if (mid === 'TextImage' || mid === 'Upload') return 'TextImage'

  // ⭐ 关键：兼容所有 AddWorkflow* 形态的新旧节点
  if (mid === 'AddWorkflow' || mid.startsWith('AddWorkflow')) return 'AddWorkflow'

  if (mid === 'TextToAudio') return 'audio'
  return 'io'
}


/** 仅更新“选中”样式（按类型着色阴影） */
export function updateSelectionStyles(svgElement, selectedIds) {
  d3.select(svgElement).selectAll('.node')
    .each(function (d) {
      if (!d || !d.id) return
      const card = d3.select(this).select('.node-card')
      if (card.empty()) return

      const isSelected = isVisuallySelected(d, selectedIds)
      setCardSelected(card, d, isSelected)

    })
}

/**
 * 为卡片创建右键菜单（包含 Intent Draft / Workflow Planning）
 * @param {d3.Selection} card - 卡片DOM选择器
 * @param {Object} d - 节点数据
 * @param {Function} emit - 事件发射器
 */
function addRightClickMenu(card, d, emit) {
  card.on('contextmenu', (ev) => {
    // 如果在 phrase 行上右键，不弹节点级菜单
    const target = ev.target;
    if (target && target.closest && target.closest('.phrase-row')) {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();

    const menu = d3.select('body').append('xhtml:div')
      .style('position', 'absolute')
      .style('left', `${ev.pageX}px`)
      .style('top', `${ev.pageY}px`)
      .style('background', 'white')
      .style('border', '1px solid #e5e7eb')
      .style('border-radius', '4px')
      .style('padding', '4px 0')
      .style('box-shadow', '0 2px 8px rgba(0,0,0,0.1)')
      .style('z-index', '1000')
      .style('min-width', '160px');

    const addMenuItem = (label, onClick) => {
      menu.append('xhtml:div')
        .style('padding', '4px 12px')
        .style('cursor', 'pointer')
        .style('font-size', '12px')
        .style('color', '#374151')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('gap', '6px')
        .on('mouseenter', function () { d3.select(this).style('background', '#f3f4f6') })
        .on('mouseleave', function () { d3.select(this).style('background', 'transparent') })
        .text(label)
        .on('click', () => {
          onClick()
          menu.remove()
        })
    }

    addMenuItem('Create Child Draft', () => {
      emit('create-card', d, 'AddText', 'util')
    })

    addMenuItem('Add Re-authoring Plan', () => {
      emit('create-card', d, 'AddWorkflow', 'util')
    })

    const closeMenu = () => {
      menu.remove()
      document.removeEventListener('click', closeMenu)
    }
    setTimeout(() => document.addEventListener('click', closeMenu), 0)
  })
}



/** 折叠/展开后：同时更新可见性 + 重新布局（带过渡） */
export function updateVisibility(svgElement, allNodes) {
  // 1) 先算出当前可见节点/边（保持你原来的折叠语义）
  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodes)
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id))
  const visibleLinkIds = new Set(visibleLinks.map(l => `${l.source}->${l.target}`))

  const svg = d3.select(svgElement)

  // 保留原来的显示/隐藏逻辑
  svg.selectAll('.node')
    .style('display', d => visibleNodeIds.has(d.id) ? null : 'none')
    .each(function (d) {
      const btn = d3.select(this).select('button.collapse-btn')
      if (btn.size()) {
        btn.text(d._collapsed ? '+' : '-')
        applyCollapseBtnStyle(btn, !!d._collapsed)

      }
    })

  svg.selectAll('.link')
    .style('display', d => visibleLinkIds.has(`${d.v}->${d.w}`) ? null : 'none')

  // 2) 基于「可见节点」重新建一个 dagre graph
  if (!visibleNodes.length) return

  const g = createDagreGraph();

  g.setDefaultEdgeLabel(() => ({}))

  visibleNodes.forEach(node => {
    const width = node.calculatedWidth || 260
    const height = node.calculatedHeight || 140
    g.setNode(node.id, { width, height })
  })

  visibleLinks.forEach(l => g.setEdge(l.source, l.target))

  dagre.layout(g)

  const dagreNodes = new Map(g.nodes().map(id => [id, g.node(id)]));
  // 新增：把原始节点数据建一个 map，方便判断是不是 Init
  const nodeDataMap = new Map(visibleNodes.map(n => [n.id, n]));

  const dagreEdges = g.edges().map(e => {
    const edgeData = g.edge(e);
    const src = dagreNodes.get(e.v);
    const tgt = dagreNodes.get(e.w);

    if (!edgeData || !edgeData.points || edgeData.points.length === 0 || !src || !tgt) {
      return { v: e.v, w: e.w, points: [] };
    }

    const pts = edgeData.points.map(p => ({ x: p.x, y: p.y }));
    const first = pts[0];
    const last  = pts[pts.length - 1];

    const srcData = nodeDataMap.get(e.v) || {};
    const tgtData = nodeDataMap.get(e.w) || {};

    const isSrcInit = (srcData.module_id === 'Init') || inferCardType(srcData) === 'init';
    const isTgtInit = (tgtData.module_id === 'Init') || inferCardType(tgtData) === 'init';

    // ===== 起点处理 =====
    if (isSrcInit) {
      // Init：从圆心出发
      first.x = src.x;
      first.y = src.y;
    } else {
      // 普通节点：右侧中点
      first.x = src.x + (src.width || 0) / 2;
      // first.y 用 dagre 原来的，保留转折
    }

    // ===== 终点处理 =====
    if (isTgtInit) {
      // 如果以后有指向 Init 的边，也从圆心结束
      last.x = tgt.x;
      last.y = tgt.y;
    } else {
      // 普通节点：左侧中点
      last.x = tgt.x - (tgt.width || 0) / 2;
      // last.y 保持原样
    }

    return { v: e.v, w: e.w, points: pts };
  });

  // 3) 选中当前 layout 容器里的 nodes / links，做平滑过渡
  const layoutGroup = svg.select('g.zoom-container')
  const nodeSel = layoutGroup.select('g.nodes').selectAll('.node')
  const linkSel = layoutGroup.select('g.links').selectAll('path.link')

  // 节点位置过渡
  nodeSel
    .transition()
    .duration(400)
    .attr('transform', function (d) {
      const n = dagreNodes.get(d.id)
      if (!n) {
        // 找不到（说明被隐藏），保持原 transform
        return d3.select(this).attr('transform')
      }
      return `translate(${n.x},${n.y})`
    })

  // 连线路径过渡
  linkSel
    .transition()
    .duration(400)
    .attr('d', function (d) {
      const match = dagreEdges.find(e => e.v === d.v && e.w === d.w)
      if (!match) {
        return d3.select(this).attr('d')
      }
      return lineGenerator(match.points)
    })
}


/** 完整重绘（重新布局 & 初始缩放） */
export function renderTree(
  svgElement,
  allNodesData,
  selectedIds,
  emit,
  workflowTypes,
  viewState = null,
  layoutOptions = null   // 新增参数：来自 WorkflowTree.vue 的布局配置
) {
  // ====== 合并布局参数：外部传入的 horizontalGap / verticalGap 优先 ======
  if (layoutOptions) {
    if (typeof layoutOptions.horizontalGap === 'number') {
      layoutConfig.ranksep = layoutOptions.horizontalGap
    }
    if (typeof layoutOptions.verticalGap === 'number') {
      layoutConfig.nodesep = layoutOptions.verticalGap
    }
  }

  const wrapper = d3.select(svgElement)

  // 优先用外部传进来的 viewState；如果没有，就从 d3 的内部 zoom 状态恢复
  let savedView = viewState
  if (!savedView) {
    const prev = wrapper.property('__zoom')      // d3.zoom 内部记录
    if (prev) {
      savedView = { k: prev.k, x: prev.x, y: prev.y }
    }
  }

   // --- 调试点 1: 检查原始数据 ---
  console.log("=== RenderTree Check ===");
  allNodesData.forEach(n => {
    if (n.originalParents && n.originalParents.length > 0) {
      console.log(`Node[${n.id}] 的父节点列表:`, n.originalParents);
    }
  });

  // 清空旧内容，但不要动 wrapper 本身（保留 __zoom 属性）
  wrapper.html('')

  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodesData)
  if (!visibleNodes.length) {
    wrapper.append('text')
      .attr('x', '50%').attr('y', '50%')
      .attr('text-anchor', 'middle')
      .attr('fill', '#ffffffff')//#9ca3af
      .text('No draft states yet. Create a child draft to begin.')
    return
  }


  // Dagre 布局（使用统一配置）
  const g = createDagreGraph();

  const BASE_CARD_HEIGHT = 170
  const PROMPT_AREA_HEIGHT = 30

  visibleNodes.forEach(node => {
    const cardType = inferCardType(node)
    const isInit = cardType === 'init'

    const hasMedia = !!(
      node.assets &&
      node.assets.output &&
      node.assets.output.images &&
      node.assets.output.images.length > 0
    )

    const rawPath = hasMedia ? node.assets.output.images[0] : ''

    const isAudioMedia =
      typeof rawPath === 'string' &&
      (
        rawPath.includes('.mp3') ||
        rawPath.includes('.wav') ||
        rawPath.includes('subfolder=audio')
      )

    const promptText = node.parameters
      ? (node.parameters.positive_prompt || node.parameters.text)
      : null

    const hasPrompt = typeof promptText === 'string' && promptText.trim() !== ''

    let nodeWidth = 260
    let nodeHeight = 120

    if (isInit) {
      nodeWidth = 60
      nodeHeight = 60
    } else if (getNodeCategory(node) === 'composite') {
      const count = node.combinedNodes?.length || node.sourceNodeIds?.length || 0
      nodeWidth = 300
      nodeHeight = count > 4 ? 180 : 156
    } else if (cardType === 'textFull') {
      nodeWidth = 260
      nodeHeight = 150
    } else if (cardType === 'AddWorkflow') {
      nodeWidth = 260
      nodeHeight = 190
    } else if (cardType === 'TextImage') {
      nodeWidth = 260
      nodeHeight = 140
    } else if (cardType === 'audio' || isAudioMedia) {
      nodeWidth = 260
      nodeHeight = hasPrompt ? 175 : 110
    } else {
      nodeWidth = 260
      //if (hasMedia && hasPrompt) {
      nodeHeight = BASE_CARD_HEIGHT + PROMPT_AREA_HEIGHT
      // } else if (hasMedia) {
      //   nodeHeight = BASE_CARD_HEIGHT
      // } else if (hasPrompt) {
      //   nodeHeight = 140
      // } else {
      //   nodeHeight = 120
      // }
    }

    node.calculatedWidth = nodeWidth
    node.calculatedHeight = nodeHeight
    node._cardType = cardType

    g.setNode(node.id, {
      label: node.module_id,
      width: nodeWidth,
      height: nodeHeight
    })
  })

  visibleLinks.forEach(l => {
    console.log(`Dagre Edge: ${l.source} -> ${l.target}`);
    g.setEdge(l.source, l.target);
  })

  dagre.layout(g)

  const dagreNodes = new Map(g.nodes().map(id => [id, g.node(id)]));
  const nodeDataMap = new Map(visibleNodes.map(n => [n.id, n]));

  const dagreEdges = g.edges().map(e => {
    const edgeData = g.edge(e);
    const src = dagreNodes.get(e.v);
    const tgt = dagreNodes.get(e.w);

    if (!edgeData || !edgeData.points || edgeData.points.length === 0 || !src || !tgt) {
      return { v: e.v, w: e.w, points: [] };
    }

    const pts = edgeData.points.map(p => ({ x: p.x, y: p.y }));
    const first = pts[0];
    const last  = pts[pts.length - 1];

    const srcData = nodeDataMap.get(e.v) || {};
    const tgtData = nodeDataMap.get(e.w) || {};

    const isSrcInit = (srcData.module_id === 'Init') || inferCardType(srcData) === 'init';
    const isTgtInit = (tgtData.module_id === 'Init') || inferCardType(tgtData) === 'init';

    if (isSrcInit) {
      first.x = src.x;
      first.y = src.y;
    } else {
      first.x = src.x + (src.width || 0) / 2;
    }

    if (isTgtInit) {
      last.x = tgt.x;
      last.y = tgt.y;
    } else {
      last.x = tgt.x - (tgt.width || 0) / 2;
    }

    return { v: e.v, w: e.w, points: pts };
  });



  // SVG 容器与缩放
  const width = svgElement.clientWidth || 1200
  const height = svgElement.clientHeight || 600
  const svg = wrapper
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')


  const defs = svg.append('defs')
  // 只保留一种灰色箭头
  defs.append('marker')
    .attr('id', 'arrowhead-default')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 10).attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .attr('xoverflow', 'visible')
    .append('path')
    .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
    .style('fill', defaultLinkColor)
    .style('stroke', 'none')

  // 给 layoutGroup 添加 class 方便选择
  const layoutGroup = svg.append('g')
    .attr('class', 'zoom-container'); // 新增 class 用于选择

  const linkGroup = layoutGroup.append('g').attr('class', 'links')
  const nodeGroup = layoutGroup.append('g').attr('class', 'nodes')

  const zoom = d3.zoom()
    .scaleExtent([0.1, 2.5])
    .on('zoom', (ev) => layoutGroup.attr('transform', ev.transform))
    .filter((ev) => {
      const target = ev.target;
      return !(target && target.closest && target.closest('foreignObject'));
    });

  svg.call(zoom);

  // ⭐ 优先恢复旧视图；没有旧视图时才做一次自适应缩放
  if (savedView) {
    svg.call(
      zoom.transform,
      d3.zoomIdentity
        .translate(savedView.x, savedView.y)
        .scale(savedView.k)
    );
  } else {
    const graphWidth = g.graph().width || width;
    const graphHeight = g.graph().height || height;
    const s = Math.min(1, Math.min(width / graphWidth, height / graphHeight) * 0.9);
    const tx = (width - graphWidth * s) / 2;
    const ty = (height - graphHeight * s) / 2;
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(s));
  }

  // 背景点击：取消选择
  const svgDom = svg.node()
  svgDom.addEventListener('click', (ev) => {
    if (ev.target === svgDom) {
      svgElement.querySelectorAll('.node-card').forEach(el => el.classList.remove('selected'))
      emit('update:selectedIds', [])
    }
  })

  // 新增：初始化框选交互
  // initSelectionBox(svg, svgElement, allNodesData, emit);



  function getLinkStyle() {
    return { color: defaultLinkColor, id: 'url(#arrowhead-default)' }
  }

  // Links
  linkGroup.selectAll('path.link')
    .data(dagreEdges)
    .enter().append('path')
    .attr('class', 'link')
    .each(function () {
      const st = getLinkStyle()
      d3.select(this).style('stroke', st.color).attr('marker-end', st.id)
    })
    .attr('d', d => lineGenerator(d.points))

  // Nodes
  const nodeSel = nodeGroup.selectAll('.node')
    .data(visibleNodes, d => d.id)
    .enter().append('g')
    .attr('class', 'node')
    .attr('data-id', d => d.id)
    .attr('transform', d => {
      const n = dagreNodes.get(d.id)
      return `translate(${n.x},${n.y})`
    })

  
  /**
   * 统一构建 header：左标题 + 右侧 [-][+][x]
   * 现在会根据模块类型给辅助节点更友好的标题：
   *   - AddText      -> "Intent Draft"
   *   - AddWorkflow  -> "Workflow Planning"
   */
  function buildHeader(card, d) {
    let isEditingTitle = false

    const header = card.append('xhtml:div')
      .style('display', 'flex')
      .style('justify-content', 'space-between')
      .style('align-items', 'center')
      .style('padding', '4px 8px')
      .style('border-bottom', '1px solid #e5e7eb')
      .style('flex-shrink', '0')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')

    const cat = getNodeCategory(d)
    let headerBg = '#f9fafb'
    if (cat === 'image') headerBg = NODE_COLORS.imageSoft
    else if (cat === 'video') headerBg = NODE_COLORS.videoSoft
    else if (cat === 'audio') headerBg = NODE_COLORS.audioSoft
    else if (cat === 'composite') headerBg = NODE_COLORS.overlapSoft

    header
      .style('background-color', headerBg)
      .attr('data-node-category', cat)

    const titleWrap = header.append('xhtml:div')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('min-width', '0')
      .style('flex', '1 1 auto')

    const initialLabel = getNodeHeaderBaseLabel(d)

    const title = titleWrap.append('xhtml:div')
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('color', '#111827')
      .style('overflow', 'hidden')
      .style('text-overflow', 'ellipsis')
      .style('white-space', 'nowrap')
      .style('min-width', '0')
      .style('cursor', 'text')
      .text(initialLabel)

    title.on('dblclick', (ev) => {
      ev.stopPropagation()
      if (isEditingTitle) return
      isEditingTitle = true
      const currentLabel = getNodeHeaderBaseLabel(d)
      title.text(null)
        .style('border', '1px dashed #9ca3af')
        .style('border-radius', '4px')
        .style('padding', '1px 4px')

      const input = title.append('xhtml:input')
        .attr('type', 'text')
        .attr('value', currentLabel)
        .style('width', '100%')
        .style('font-size', '12px')
        .style('font-weight', '600')
        .style('color', '#111827')
        .style('border', 'none')
        .style('outline', 'none')
        .style('background', 'transparent')
        .on('mousedown', ev2 => ev2.stopPropagation())

      const inputNode = input.node()
      if (inputNode) {
        setTimeout(() => {
          inputNode.focus()
          inputNode.select()
        }, 0)
      }

      function finishEdit(commit) {
        if (!isEditingTitle) return
        isEditingTitle = false
        const fallback = getNodeHeaderBaseLabel({ ...d, displayName: '' })
        const newText = commit && inputNode ? inputNode.value.trim() : (d.displayName || fallback)
        const finalLabel = newText || fallback
        d.displayName = finalLabel
        title.selectAll('*').remove()
        title.style('border', 'none').style('padding', '0').text(finalLabel)
      }

      d3.select(inputNode).on('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          finishEdit(true)
          emit('rename-node', { id: d.id, label: d.displayName })
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finishEdit(false)
        }
      })

      d3.select(inputNode).on('blur', () => {
        finishEdit(true)
        emit('rename-node', { id: d.id, label: d.displayName })
      })
    })

    const toolbar = header.append('xhtml:div')
      .style('display', 'flex')
      .style('gap', '4px')
      .style('align-items', 'center')
      .style('margin-left', '8px')
      .style('flex-shrink', '0')

    const tempMap = new Map(allNodesData.map(n => [n.id, { ...n, children: [] }]))
    allNodesData.forEach(n => {
      if (n.originalParents) {
        n.originalParents.forEach(p => tempMap.get(p)?.children.push(n))
      }
    })
    const hasChildren = !!(tempMap.get(d.id) && tempMap.get(d.id).children.length)

    if (hasChildren) {
      const collapseBtn = toolbar.append('xhtml:button')
        .attr('class', 'collapse-btn')
        .text(d._collapsed ? '+' : '-')
        .style('width', '18px')
        .style('height', '18px')
        .style('border-radius', '999px')
        .style('border', '1px solid #e5e7eb')
        .style('font-size', '12px')
        .style('line-height', '1')
        .style('display', 'inline-flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('cursor', 'pointer')
        .style('user-select', 'none')
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation()
          const nextCollapsed = !d._collapsed
          d._collapsed = nextCollapsed
          collapseBtn.text(nextCollapsed ? '+' : '-')
          applyCollapseBtnStyle(collapseBtn, nextCollapsed)
          emit('toggle-collapse', d.id)
        })

      applyCollapseBtnStyle(collapseBtn, !!d._collapsed)
      collapseBtn
        .on('mouseenter', function () {
          applyCollapseBtnHoverStyle(d3.select(this), !!d._collapsed)
        })
        .on('mouseleave', function () {
          applyCollapseBtnStyle(d3.select(this), !!d._collapsed)
        })
    }

    toolbar.append('xhtml:button')
      .text('×')
      .style('width', '18px')
      .style('height', '18px')
      .style('border-radius', '999px')
      .style('border', '1px solid #fecaca')
      .style('background', '#ffffff')
      .style('font-size', '12px')
      .style('line-height', '1')
      .style('display', 'inline-flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('color', '#dc2626')
      .style('cursor', 'pointer')
      .style('user-select', 'none')
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', ev => {
        ev.stopPropagation()
        emit('delete-node', d.id)
      })
      .on('mouseenter', function () {
        d3.select(this).style('background', '#dc2626').style('color', '#ffffff').style('border-color', '#dc2626')
      })
      .on('mouseleave', function () {
        d3.select(this).style('background', '#ffffff').style('color', '#dc2626').style('border-color', '#fecaca')
      })

    return header
  }



  function buildCollapsibleSection(parent, title, expanded = true, controlsBuilder = null) {
    let isExpanded = !!expanded
    const section = parent.append('xhtml:div')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '4px')
      .style('padding', '2px 0')

    const header = section.append('xhtml:div')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('gap', '6px')
      .style('padding', '0 2px')
      .style('cursor', 'pointer')
      .on('mousedown', ev => ev.stopPropagation())

    const toggle = header.append('xhtml:span')
      .style('font-size', '10px')
      .style('color', '#6b7280')
      .text(isExpanded ? '▾' : '▸')

    header.append('xhtml:span')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('color', '#4b5563')
      .text(title)

    const controls = header.append('xhtml:div')
      .style('margin-left', 'auto')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('gap', '4px')
      .on('click', ev => ev.stopPropagation())
      .on('mousedown', ev => ev.stopPropagation())

    if (controlsBuilder) controlsBuilder(controls)

    section.append('xhtml:div').style('height', '1px').style('background', '#e5e7eb')

    const content = section.append('xhtml:div')
      .style('display', isExpanded ? 'block' : 'none')
      .style('padding', '2px 0 0 0')
      .style('width', '100%')
      .style('box-sizing', 'border-box')
      .style('overflow-x', 'hidden')

    header.on('click', () => {
      isExpanded = !isExpanded
      toggle.text(isExpanded ? '▾' : '▸')
      content.style('display', isExpanded ? 'block' : 'none')
    })

    return { section, header, content, controls }
  }

  function getWorkflowOptionIds(currentId = '') {
    const keys = Object.keys(workflowParameters || {})
    if (currentId && !keys.includes(currentId)) return [currentId, ...keys]
    return keys
  }

  function getDefaultWorkflowParams(workflowId) {
    const defs = workflowParameters?.[workflowId] || []
    return defs.reduce((acc, item) => { acc[item.id] = item.defaultValue; return acc }, {})
  }

  function isVideoUrl(url = '') {
    const v = String(url).toLowerCase()
    return v.includes('.mp4') || v.includes('.mov') || v.includes('.webm') || v.includes('subfolder=video')
  }

  function isAudioUrl(url = '') {
    const v = String(url).toLowerCase()
    return v.includes('.mp3') || v.includes('.wav') || v.includes('.m4a') || v.includes('subfolder=audio')
  }

  function deriveMediaKind(url = '') {
    if (isAudioUrl(url)) return 'audio'
    if (isVideoUrl(url)) return 'video'
    return 'image'
  }

  function getInputMediaUrls(node) {
    const a = node.assets?.input || {}
    return [...(a.images || []), ...(a.videos || []), ...(a.audio || [])].filter(Boolean)
  }

  function getOutputMediaUrls(node) {
    const a = node.assets?.output || {}
    return [...(a.images || []), ...(a.videos || []), ...(a.audio || [])].filter(Boolean)
  }

  function extractPromptState(node) {
    const p = node.parameters || {}
    return {
      note: p.text || p.prompt_note || p.global_context || '',
      positive: p.positive_prompt || '',
      negative: p.negative_prompt || ''
    }
  }

  function syncPromptState(node, next, emit) {
    if (!node.parameters) node.parameters = {}
    node.parameters.text = next.note || ''
    node.parameters.prompt_note = next.note || ''
    node.parameters.positive_prompt = next.positive || ''
    node.parameters.negative_prompt = next.negative || ''
    emit('update-node-parameters', node.id, node.parameters)
  }

  function createHiddenUploader(parent, node, emit, onLocalUrls) {
    const input = parent.append('xhtml:input')
      .attr('type', 'file')
      .attr('accept', 'image/*,video/*,audio/*')
      .attr('multiple', true)
      .style('display', 'none')
      .on('change', function () {
        const files = Array.from(this.files || [])
        if (!files.length) return
        const localUrls = files.map(file => URL.createObjectURL(file))
        onLocalUrls(localUrls)
        emit('upload-media', node.id, files)
        this.value = ''
      })
    return input
  }

  function buildTinyButton(parent, text, title, onClick) {
    return parent.append('xhtml:button')
      .text(text)
      .attr('title', title || '')
      .style('height', '18px')
      .style('min-width', '18px')
      .style('padding', '0 6px')
      .style('border-radius', '999px')
      .style('border', '1px solid #d1d5db')
      .style('background', '#ffffff')
      .style('color', '#4b5563')
      .style('font-size', '10px')
      .style('line-height', '1')
      .style('cursor', 'pointer')
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', function (ev) { ev.stopPropagation(); if (onClick) onClick(ev) })
  }

  function renderThumbRow(parent, urls, options = {}) {
    const { emptyText = 'No media yet', onThumbClick = null, onStageClick = null, makeDroppable = false, onDropMedia = null } = options
    const row = parent.append('xhtml:div')
      .style('display', 'flex')
      .style('flex-wrap', 'wrap')
      .style('align-content', 'flex-start')
      .style('gap', '6px')
      .style('overflow-x', 'hidden')
      .style('padding', '2px 0')
      .style('min-height', '56px')
      .style('width', '100%')
      .style('box-sizing', 'border-box')

    if (makeDroppable) {
      row.style('border', '1px dashed #e5e7eb')
        .style('border-radius', '8px')
        .style('padding', '6px')
        .style('width', '100%')
        .style('box-sizing', 'border-box')
        .on('dragover', ev => { ev.preventDefault(); ev.stopPropagation(); row.style('border-color', '#94a3b8').style('background', '#f8fafc') })
        .on('dragleave', ev => { ev.preventDefault(); ev.stopPropagation(); row.style('border-color', '#e5e7eb').style('background', 'transparent') })
        .on('drop', ev => {
          ev.preventDefault(); ev.stopPropagation();
          row.style('border-color', '#e5e7eb').style('background', 'transparent')
          if (!onDropMedia) return
          const rawJson = ev.dataTransfer.getData('application/json')
          const rawText = ev.dataTransfer.getData('text/plain')
          let dragData = null
          try { dragData = JSON.parse(rawJson || rawText || '{}') } catch (e) { dragData = { url: rawText || '' } }
          const resolvedUrl = dragData?.mediaUrl || dragData?.originalUrl || dragData?.fullUrl || dragData?.imageUrl || dragData?.url || dragData?.thumbnailUrl || dragData?.clip?.mediaUrl || dragData?.clip?.originalUrl || dragData?.clip?.fullUrl || dragData?.clip?.imageUrl || dragData?.clip?.url || dragData?.clip?.thumbnailUrl || ''
          if (resolvedUrl) onDropMedia(resolvedUrl, dragData)
        })
    }

    if (!urls.length) {
      row.append('xhtml:div').style('font-size', '10px').style('color', '#9ca3af').style('display', 'flex').style('align-items', 'center').text(emptyText)
      return row
    }

    urls.forEach(url => {
      const type = deriveMediaKind(url)
      const wrap = row.append('xhtml:div')
        .style('position', 'relative')
        .style('flex', '0 0 auto')
        .style('width', '56px')
        .style('height', '56px')
        .style('border-radius', '8px')
        .style('overflow', 'hidden')
        .style('border', '1px solid #e5e7eb')
        .style('background', '#f9fafb')
        .style('cursor', 'pointer')
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => { ev.stopPropagation(); if (onThumbClick) onThumbClick(url, type) })

      if (type === 'image') {
        wrap.append('xhtml:img').attr('src', url).style('width', '100%').style('height', '100%').style('object-fit', 'cover').style('display', 'block')
      } else if (type === 'video') {
        wrap.append('xhtml:video').attr('src', url).attr('autoplay', true).attr('muted', true).attr('loop', true).attr('playsinline', true).style('width', '100%').style('height', '100%').style('object-fit', 'cover').style('display', 'block')
      } else {
        wrap.append('xhtml:div').style('width', '100%').style('height', '100%').style('display', 'flex').style('align-items', 'center').style('justify-content', 'center').style('font-size', '18px').style('color', '#64748b').text('♪')
      }

      if (onStageClick) {
        buildTinyButton(wrap, '↗', 'Add to staging', () => onStageClick(url, type))
          .style('position', 'absolute').style('top', '4px').style('right', '4px').style('background', 'rgba(255,255,255,0.94)')
      }
    })

    return row
  }

  function buildFunctionSection(parent, node, emit) {
    const sec = buildCollapsibleSection(parent, 'Function', true)
    const row = sec.content.append('xhtml:div').style('display', 'flex').style('gap', '6px').style('align-items', 'center')
    const options = getWorkflowOptionIds(node.module_id)
    const select = row.append('xhtml:select')
      .style('flex', '1 1 auto').style('height', '24px').style('box-sizing', 'border-box').style('box-sizing', 'border-box').style('border', '1px solid #d1d5db').style('border-radius', '6px').style('background', '#ffffff').style('font-size', '10px').style('color', '#374151')
      .on('mousedown', ev => ev.stopPropagation())
    options.forEach(id => {
      const opt = select.append('xhtml:option').attr('value', id).text(id)
      if (id === node.module_id) opt.attr('selected', 'selected')
    })
    select.on('change', function () {
      const workflowId = this.value
      const nextParams = { ...getDefaultWorkflowParams(workflowId), text: node.parameters?.text || node.parameters?.prompt_note || '', prompt_note: node.parameters?.prompt_note || node.parameters?.text || '', positive_prompt: node.parameters?.positive_prompt || '', negative_prompt: node.parameters?.negative_prompt || '' }
      node.parameters = nextParams
      emit('refresh-node', node.id, workflowId, nextParams, workflowId)
    })
    return sec
  }

  function buildPromptSection(parent, node, emit, inputMediaResolver = null) {
    const promptState = extractPromptState(node)

    function parseCueString(prompt) {
      if (!prompt) return []
      const trimmed = String(prompt).trim()
      if (!trimmed) return []
      const noBrackets = trimmed.replace(/[()]/g, '')
      return noBrackets
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
          if (item.includes(':')) {
            const idx = item.lastIndexOf(':')
            const text = item.slice(0, idx).trim()
            const weight = parseFloat(item.slice(idx + 1).trim())
            return { text, weight: Number.isFinite(weight) ? weight : 1.0 }
          }
          return { text: item, weight: 1.0 }
        })
        .filter(p => p.text)
    }

    function serializeCueList(list) {
      return (list || [])
        .filter(item => item && String(item.text || '').trim())
        .map(item => `${String(item.text).trim()}:${Number.isFinite(item.weight) ? item.weight.toFixed(1) : '1.0'}`)
        .join(', ')
    }

    let noteArea
    let positivePhrases = parseCueString(promptState.positive || promptState.note)
    let negativePhrases = parseCueString(promptState.negative)
    let positiveContainer, negativeContainer, positiveCount, negativeCount

    function syncPromptStateFromUI() {
      const next = {
        note: noteArea ? (noteArea.property('value') || '') : '',
        positive: serializeCueList(positivePhrases),
        negative: serializeCueList(negativePhrases)
      }
      syncPromptState(node, next, emit)
      return next
    }

    function buildPhraseEditor(container, listRefGetter, listRefSetter, countSel, kind) {
      container.selectAll('*').remove()
      const list = listRefGetter()
      countSel.text(`(${list.length})`)

      if (!list.length) {
        container.append('xhtml:div')
          .style('font-size', '10px')
          .style('color', '#9ca3af')
          .style('padding', '2px 0')
          .text(`No ${kind} cues yet`)
      }

      list.forEach((phrase, idx) => {
        const row = container.append('xhtml:div')
          .style('display', 'grid')
          .style('grid-template-columns', '1fr 44px 18px 18px')
          .style('gap', '4px')
          .style('align-items', 'center')
          .style('margin-bottom', '4px')

        row.append('xhtml:input')
          .attr('type', 'text')
          .attr('value', phrase.text || '')
          .style('height', '24px')
          .style('border', '1px solid #e5e7eb')
          .style('border-radius', '6px')
          .style('padding', '0 6px')
          .style('font-size', '10px')
          .style('background', '#ffffff')
          .on('mousedown', ev => ev.stopPropagation())
          .on('input', function () {
            const next = [...listRefGetter()]
            next[idx] = { ...next[idx], text: this.value }
            listRefSetter(next)
            syncPromptStateFromUI()
          })

        row.append('xhtml:input')
          .attr('type', 'number')
          .attr('min', '0.0')
          .attr('max', '1.9')
          .attr('step', '0.1')
          .attr('value', Number.isFinite(phrase.weight) ? phrase.weight.toFixed(1) : '1.0')
          .style('height', '24px')
          .style('border', '1px solid #e5e7eb')
          .style('border-radius', '6px')
          .style('padding', '0 4px')
          .style('font-size', '10px')
          .style('background', '#ffffff')
          .on('mousedown', ev => ev.stopPropagation())
          .on('input', function () {
            let v = parseFloat(this.value)
            if (!Number.isFinite(v)) v = 1.0
            v = Math.max(0.0, Math.min(1.9, v))
            const next = [...listRefGetter()]
            next[idx] = { ...next[idx], weight: v }
            listRefSetter(next)
            syncPromptStateFromUI()
          })

        buildTinyButton(row, '+', `Add ${kind} cue below`, () => {
          const next = [...listRefGetter()]
          next.splice(idx + 1, 0, { text: '', weight: 1.0 })
          listRefSetter(next)
          buildPhraseEditor(container, listRefGetter, listRefSetter, countSel, kind)
          syncPromptStateFromUI()
        })
          .style('padding', '0')
          .style('min-width', '18px')

        buildTinyButton(row, '×', `Delete ${kind} cue`, () => {
          const next = [...listRefGetter()]
          next.splice(idx, 1)
          listRefSetter(next)
          buildPhraseEditor(container, listRefGetter, listRefSetter, countSel, kind)
          syncPromptStateFromUI()
        })
          .style('padding', '0')
          .style('min-width', '18px')
      })
    }

    const sec = buildCollapsibleSection(parent, 'Prompts', true, (controls) => {
      buildTinyButton(controls, 'A', 'Agent assist', async () => {
        try {
          clearPrevAgentContext()
          const mediaUrl = inputMediaResolver ? inputMediaResolver() : (getInputMediaUrls(node)[0] || '')
          const payload = {
            user_input: noteArea.property('value') || '',
            node_id: node.id,
            image_url: mediaUrl || '',
            workflow_context: { current_workflow: node.module_id, parent_nodes: node.originalParents || [] }
          }
          const res = await fetch('/api/agents/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
          const data = await res.json()
          setPrevAgentContext({
            global_context: data.global_context || '',
            intent: data.intent || '',
            selected_workflow: data.selected_workflow || '',
            knowledge_context: data.knowledge_context || '',
            image_caption: data.image_caption || '',
            style: data.style || ''
          })
          const note = data.message?.text || noteArea.property('value') || ''
          noteArea.property('value', note)
          positivePhrases = parseCueString(data.message?.positive || '')
          negativePhrases = parseCueString(data.message?.negative || '')
          buildPhraseEditor(positiveContainer, () => positivePhrases, v => { positivePhrases = v }, positiveCount, 'positive')
          buildPhraseEditor(negativeContainer, () => negativePhrases, v => { negativePhrases = v }, negativeCount, 'negative')
          syncPromptStateFromUI()
        } catch (err) {
          console.error('Agent assist failed:', err)
        }
      })

      buildTinyButton(controls, '↻', 'Generate', () => {
        const next = syncPromptStateFromUI()
        const regenerated = { ...(node.parameters || {}) }
        regenerated.text = next.note
        regenerated.prompt_note = next.note
        regenerated.positive_prompt = next.positive
        regenerated.negative_prompt = next.negative
        emit('regenerate-node', node.id, node.module_id, regenerated)
      })
    })

    noteArea = sec.content.append('xhtml:textarea')
      .attr('class', 'thin-scroll')
      .style('width', '100%')
      .style('box-sizing', 'border-box')
      .style('min-height', '54px')
      .style('padding', '6px 8px')
      .style('font-size', '10px')
      .style('border', '1px solid #e5e7eb')
      .style('border-radius', '8px')
      .style('background', '#f9fafb')
      .style('resize', 'none')
      .style('outline', 'none')
      .attr('placeholder', 'Describe the scene, operation, or target effect...')
      .property('value', promptState.note)
      .on('mousedown', ev => ev.stopPropagation())
      .on('blur', () => syncPromptStateFromUI())

    const cuesRow = sec.content.append('xhtml:div')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '8px')
      .style('margin-top', '6px')

    const posWrap = cuesRow.append('xhtml:div').style('display', 'flex').style('flex-direction', 'column').style('gap', '4px')
    const posHead = posWrap.append('xhtml:div').style('display', 'flex').style('align-items', 'center').style('gap', '6px')
    posHead.append('xhtml:div').style('font-size', '10px').style('font-weight', '600').style('color', '#6b7280').text('Positive cues')
    positiveCount = posHead.append('xhtml:span').style('font-size', '10px').style('color', '#9ca3af').text('(0)')
    buildTinyButton(posHead, '+', 'Add positive cue', () => {
      positivePhrases = [...positivePhrases, { text: '', weight: 1.0 }]
      buildPhraseEditor(positiveContainer, () => positivePhrases, v => { positivePhrases = v }, positiveCount, 'positive')
      syncPromptStateFromUI()
    })
    positiveContainer = posWrap.append('xhtml:div')

    const negWrap = cuesRow.append('xhtml:div').style('display', 'flex').style('flex-direction', 'column').style('gap', '4px')
    const negHead = negWrap.append('xhtml:div').style('display', 'flex').style('align-items', 'center').style('gap', '6px')
    negHead.append('xhtml:div').style('font-size', '10px').style('font-weight', '600').style('color', '#6b7280').text('Negative cues')
    negativeCount = negHead.append('xhtml:span').style('font-size', '10px').style('color', '#9ca3af').text('(0)')
    buildTinyButton(negHead, '+', 'Add negative cue', () => {
      negativePhrases = [...negativePhrases, { text: '', weight: 1.0 }]
      buildPhraseEditor(negativeContainer, () => negativePhrases, v => { negativePhrases = v }, negativeCount, 'negative')
      syncPromptStateFromUI()
    })
    negativeContainer = negWrap.append('xhtml:div')

    buildPhraseEditor(positiveContainer, () => positivePhrases, v => { positivePhrases = v }, positiveCount, 'positive')
    buildPhraseEditor(negativeContainer, () => negativePhrases, v => { negativePhrases = v }, negativeCount, 'negative')

    return sec
  }

  
  function buildAssetsSection(parent, node, emit, state) {
    const sec = buildCollapsibleSection(parent, 'Assets', true, (controls) => {
      const uploader = createHiddenUploader(controls, node, emit, (localUrls) => {
        state.inputUrls = [...state.inputUrls, ...localUrls]
        if (!node.assets) node.assets = {}
        if (!node.assets.input) node.assets.input = {}
        node.assets.input.images = [...state.inputUrls]
        renderRow()
      })
      buildTinyButton(controls, '+', 'Upload assets', () => uploader.node().click())
    })

    const contentRoot = sec.content.append('xhtml:div')

    const renderRow = () => {
      contentRoot.selectAll('*').remove()
      renderThumbRow(contentRoot, state.inputUrls, {
        emptyText: 'Upload or drop input assets here',
        makeDroppable: true,
        onDropMedia: (resolvedUrl) => {
          if (!state.inputUrls.includes(resolvedUrl)) {
            state.inputUrls.push(resolvedUrl)
            if (!node.assets) node.assets = {}
            if (!node.assets.input) node.assets.input = {}
            node.assets.input.images = [...state.inputUrls]
            renderRow()
          }
        },
        onThumbClick: (url, type) => emit('open-preview', url, type)
      })
    }
    renderRow()
    return sec
  }

  function buildResultsSection(parent, node, emit, state) {
    const sec = buildCollapsibleSection(parent, 'Results', true)
    const root = sec.content.append('xhtml:div').style('display', 'flex').style('flex-direction', 'column').style('gap', '6px')
    root.append('xhtml:div').style('font-size', '10px').style('font-weight', '600').style('color', '#6b7280').text('Generated')
    renderThumbRow(root, state.outputUrls, { emptyText: 'No generated results yet', onThumbClick: (url, type) => emit('open-preview', url, type), onStageClick: (url, type) => emit('add-clip', node, url, type) })
    if (node.assets && node.assets.segmented) {
      root.append('xhtml:div').style('font-size', '10px').style('font-weight', '600').style('color', '#6b7280').text('Segments')
      root.append('xhtml:div').attr('id', `entities-${node.node_id || node.id}`).style('display', 'flex').style('flex-wrap', 'wrap').style('gap', '6px').style('min-height', '40px')
    }
    return sec
  }

  function buildSettingsSection(parent, node) {
    const sec = buildCollapsibleSection(parent, 'Settings', false)
    const params = node.parameters || {}
    const excluded = new Set(['text', 'prompt_note', 'global_context', 'positive_prompt', 'negative_prompt'])
    const keys = Object.keys(params).filter(k => !excluded.has(k))
    if (!keys.length) {
      sec.content.append('xhtml:div').style('font-size', '10px').style('color', '#9ca3af').text('No adjustable parameters for the current function')
      return sec
    }
    const grid = sec.content.append('xhtml:div').style('display', 'grid').style('grid-template-columns', '1fr').style('gap', '6px').style('width', '100%')
    keys.forEach(key => {
      const val = params[key]
      const field = grid.append('xhtml:div').style('display', 'flex').style('flex-direction', 'column').style('gap', '4px')
      field.append('xhtml:div').style('font-size', '10px').style('font-weight', '600').style('color', '#6b7280').text(key.replace(/_/g, ' '))
      if (key === 'camera_pose') {
        const select = field.append('xhtml:select').attr('class', 'node-input').attr('data-key', key).style('height', '24px').style('box-sizing', 'border-box').style('border', '1px solid #d1d5db').style('border-radius', '6px').style('font-size', '10px').style('background', '#ffffff').on('mousedown', ev => ev.stopPropagation())
        ;['Pan Up','Pan Down','Pan Left','Pan Right','Zoom In','Zoom Out','Anti Clockwise (ACW)','ClockWise (CW)'].forEach(opt => {
          const option = select.append('xhtml:option').attr('value', opt).text(opt)
          if (val === opt) option.attr('selected', 'selected')
        })
      } else {
        field.append('xhtml:input').attr('class', 'node-input').attr('data-key', key).attr('type', typeof val === 'number' ? 'number' : 'text').attr('value', val).style('height', '24px').style('box-sizing', 'border-box').style('border', '1px solid #d1d5db').style('border-radius', '6px').style('font-size', '10px').style('padding', '0 6px').style('background', '#ffffff').on('mousedown', ev => ev.stopPropagation())
      }
    })
    return sec
  }

  function renderUnifiedVisualNode(gEl, d, selectedIds, emit) {
    const state = { inputUrls: [...getInputMediaUrls(d)], outputUrls: [...getOutputMediaUrls(d)] }
    const fo = gEl.append('foreignObject').attr('width', d.calculatedWidth).attr('height', d.calculatedHeight).attr('x', -d.calculatedWidth / 2).attr('y', -d.calculatedHeight / 2).style('overflow', 'visible')
    const card = fo.append('xhtml:div').attr('class', 'node-card').attr('data-node-category', getNodeCategory(d)).style('width', '100%').style('height', '100%').style('display', 'flex').style('flex-direction', 'column').style('border-width', '2px').style('border-color', getNodeBorderColor(d)).style('border-radius', '10px').style('background', '#ffffff').style('position', 'relative').style('cursor', 'pointer').style('user-select', 'none').style('-webkit-user-select', 'none')
    setCardSelected(card, d, isVisuallySelected(d, selectedIds))
    addRightClickMenu(card, d, emit)
    card.on('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('button, img, video, input, textarea, select')) return
      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      setCardSelected(card, d, !on)
      emit('update:selectedIds', Array.from(selected))
    })
    buildHeader(card, d)
    const body = card.append('xhtml:div').style('flex', '1 1 auto').style('min-height', '0').style('display', 'flex').style('flex-direction', 'column').style('gap', '6px').style('padding', '6px').style('overflow-y', 'auto').style('overflow-x', 'hidden').style('width', '100%').style('box-sizing', 'border-box')
    buildFunctionSection(body, d, emit)
    buildAssetsSection(body, d, emit, state)
    buildPromptSection(body, d, emit, () => state.inputUrls[0] || '')
    buildResultsSection(body, d, emit, state)
    buildSettingsSection(body, d)
    addTooltip(gEl, d)
  }

  function renderUnifiedAudioNode(gEl, d, selectedIds, emit) {
    const state = { inputUrls: [...getInputMediaUrls(d)], outputUrls: [...getOutputMediaUrls(d)] }
    const fo = gEl.append('foreignObject').attr('width', d.calculatedWidth).attr('height', d.calculatedHeight).attr('x', -d.calculatedWidth / 2).attr('y', -d.calculatedHeight / 2).style('overflow', 'visible')
    const card = fo.append('xhtml:div').attr('class', 'node-card').attr('data-node-category', getNodeCategory(d)).style('width', '100%').style('height', '100%').style('display', 'flex').style('flex-direction', 'column').style('border-width', '2px').style('border-color', getNodeBorderColor(d)).style('border-radius', '10px').style('background', '#ffffff').style('position', 'relative').style('cursor', 'pointer').style('user-select', 'none').style('-webkit-user-select', 'none')
    setCardSelected(card, d, isVisuallySelected(d, selectedIds))
    addRightClickMenu(card, d, emit)
    card.on('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('button, input, textarea, select')) return
      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      setCardSelected(card, d, !on)
      emit('update:selectedIds', Array.from(selected))
    })
    buildHeader(card, d)
    const body = card.append('xhtml:div').style('flex', '1 1 auto').style('min-height', '0').style('display', 'flex').style('flex-direction', 'column').style('gap', '6px').style('padding', '6px').style('overflow-y', 'auto').style('overflow-x', 'hidden').style('width', '100%').style('box-sizing', 'border-box')
    buildFunctionSection(body, d, emit)
    buildAssetsSection(body, d, emit, state)
    buildPromptSection(body, d, emit, () => state.inputUrls[0] || '')
    buildResultsSection(body, d, emit, state)
    buildSettingsSection(body, d)
    addTooltip(gEl, d)
  }


  /**
   * Tooltip 辅助
   */
  function addTooltip(gEl, d) {
    const titleText =
      (d.module_id || '') +
      (d.created_at ? (' · ' + d.created_at) : '') +
      (d.status ? (' · ' + d.status) : '')
    gEl.attr('title', titleText)
  }

  /**
   * Intent Draft 辅助节点（AddText）：
   * 单栏结构，顶部 "Input Thought" + 右侧小发送按钮，下面是对话框文本框
   */
  function renderTextFullNode(gEl, d, selectedIds, emit) {
    const initialText =
      d.parameters?.global_context ||
      d.parameters?.text ||
      d.parameters?.positive_prompt ||
      ''

    const fo = gEl.append('foreignObject')
      .attr('width', d.calculatedWidth)
      .attr('height', d.calculatedHeight)
      .attr('x', -d.calculatedWidth / 2)
      .attr('y', -d.calculatedHeight / 2)
      .style('overflow', 'visible')

    const card = fo.append('xhtml:div')
      .attr('class', 'node-card')
      .attr('data-node-category', getNodeCategory(d))
      .style('width', '100%')
      .style('height', '100%')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('border-width', '2px')
      .style('border-color', getNodeBorderColor(d))
      .style('border-radius', '12px')
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff')
      .style('box-shadow', '0 2px 8px rgba(15,23,42,0.05)')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')

    // 选中样式（保留原逻辑）
    setCardSelected(card, d, isVisuallySelected(d, selectedIds))

    card.on('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('button')) return
      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      setCardSelected(card, d, !on)
      emit('update:selectedIds', Array.from(selected))
    })

    card.on('mouseenter', () =>
      card.selectAll('.dots-container').style('opacity', '1')
    ).on('mouseleave', () =>
      card.selectAll('.dots-container').style('opacity', '0')
    )

    // 顶部 header（节点标题 + 折叠/复制/删除）
    buildHeader(card, d)
    addRightClickMenu(card, d, emit)

    // ====== 主体：单栏，对话框风格 ======
    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('padding', '5px 5px 4px')

    // 顶部行：Input Thought + 右侧发送按钮（小一号）
    const headerRow = body.append('xhtml:div')
      .attr('class', 'io-header')
      .style('align-items', 'center')

    headerRow.append('xhtml:span')
      .attr('class', 'io-label')
      .text('Draft Note')

    // 发送小按钮：挪到 Input Thought 右侧
    const sendBtn = headerRow.append('xhtml:button')
      .html('➤')
      .attr('title','save')
      .attr('class', 'icon-circle-btn output-clip-btn send-btn-icon')
      .style('box-shadow', '0 1px 2px rgba(0,0,0,0.15)')
      .on('mousedown', ev => ev.stopPropagation())

    // 文本输入区域
    const inputWrapper = body.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('display', 'flex')
      .style('margin-top', '2px')

    const textArea = inputWrapper.append('xhtml:textarea')
      .attr('class', 'thin-scroll')
      .style('flex', '1 1 auto')
      .style('width', '100%')
      .style('padding', '4px 6px')
      .style('font-size', '10px')
      .style('color', '#374151')
      .style('background-color', '#f9fafb')
      .style('border', '1px solid #e5e7eb')
      .style('border-radius', '6px')
      .style('resize', 'none')
      .style('outline', 'none')
      .style('font-family', 'inherit')
      .attr('placeholder', 'Describe the next keyframe state, visual goal, or revision idea...')
      .property('value', initialText)
      .on('mousedown', ev => ev.stopPropagation())

    // blur 时同步参数
    textArea.on('blur', function () {
      const newVal = d3.select(this).property('value') || ''
      if (!d.parameters) d.parameters = {}
      d.parameters.global_context = newVal
      d.parameters.text = newVal
      emit('update-node-parameters', d.id, d.parameters)
    })

    // 点击发送按钮：写回参数 + 通知上层调用大模型
    sendBtn.on('click', ev => {
      ev.stopPropagation()
      const value = textArea.property('value') || ''
      if (!value.trim()) return

      if (!d.parameters) d.parameters = {}
      d.parameters.global_context = value
      d.parameters.text = value
      emit('regenerate-node', d.id,"AddText", d.parameters,"Intent Draft")

      //emit('intent-draft-send', d.id, value)
      //console.log('[IntentDraft] send:', d.id, value)
    })

    addTooltip(gEl, d)
  }


  /**
   * 图文混排节点：左侧大文本，右侧图片/占位符
   */
  function renderTextImageNode(gEl, d, selectedIds, emit) {
    renderUnifiedVisualNode(gEl, d, selectedIds, emit)
  }


function renderAudioNode(gEl, d, selectedIds, emit, workflowTypes) {
  renderUnifiedAudioNode(gEl, d, selectedIds, emit)
}


/**
 * 左右 IO 卡：左输入，右输出（图片 / 视频 / 文本）
 */
function renderIONode(gEl, d, selectedIds, emit, workflowTypes) {
  renderUnifiedVisualNode(gEl, d, selectedIds, emit)
}

// Workflow Planning 辅助节点（AddWorkflow）：
// 上：Fine-tune operation 文字细化；下：Input Images 图片参考
function renderAddWorkflowNode(gEl, d, selectedIds, emit) {
  renderUnifiedVisualNode(gEl, d, selectedIds, emit)
}
// --- 新增：渲染复合节点 ---
function renderCompositeNode(gEl, d, selectedIds, emit) {
  const stats = d.summary || {
    image: 0,
    video: 0,
    audio: 0,
    text: 0
  }

  const members = d.combinedNodes || []
  const memberNames = members.map(n => n.module_id || n.label || 'Node')

  const fo = gEl.append('foreignObject')
    .attr('width', d.calculatedWidth)
    .attr('height', d.calculatedHeight)
    .attr('x', -d.calculatedWidth / 2)
    .attr('y', -d.calculatedHeight / 2)
    .style('overflow', 'visible')

  const card = fo.append('xhtml:div')
    .attr('class', 'node-card')
    .attr('data-node-category', 'composite')
    .style('width', '100%')
    .style('height', '100%')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('border', `2px solid ${NODE_COLORS.overlap}`)
    .style('border-radius', '12px')
    .style('background', `linear-gradient(180deg, ${NODE_COLORS.overlapSoft} 0%, #ffffff 100%)`)
    .style('box-sizing', 'border-box')
    .style('overflow', 'hidden')
    .style('cursor', 'pointer')
    .style('user-select', 'none')
    .style('-webkit-user-select', 'none')

  setCardSelected(card, d, isVisuallySelected(d, selectedIds))

  card.on('click', ev => {
    if (ev.target && ev.target.closest && ev.target.closest('button')) return
    ev.stopPropagation()
    const selected = new Set(selectedIds)
    const on = selected.has(d.id)
    if (on) selected.delete(d.id)
    else selected.add(d.id)
    emit('update:selectedIds', Array.from(selected))
  })

  const header = card.append('xhtml:div')
    .style('display', 'flex')
    .style('justify-content', 'space-between')
    .style('align-items', 'center')
    .style('padding', '10px 12px 8px 12px')
    .style('border-bottom', '1px solid #ede9fe')
    .style('background', NODE_COLORS.overlapSoft)

  const left = header.append('xhtml:div')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('gap', '2px')

  left.append('xhtml:div')
    .style('font-size', '12px')
    .style('font-weight', '700')
    .style('color', NODE_COLORS.overlap)
    .text(d.label || `Group · ${members.length}`)

  left.append('xhtml:div')
    .style('font-size', '10px')
    .style('color', '#64748b')
    .text('Locally composed overlap state')

  header.append('xhtml:div')
    .style('font-size', '10px')
    .style('font-weight', '700')
    .style('color', '#6d28d9')
    .style('padding', '3px 8px')
    .style('border-radius', '999px')
    .style('background', '#ffffff')
    .style('border', `1px solid ${NODE_COLORS.overlap}`)
    .text(`${members.length} nodes`)

  const body = card.append('xhtml:div')
    .style('flex', '1 1 auto')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('gap', '10px')
    .style('padding', '10px 12px')

  const chipRow = body.append('xhtml:div')
    .style('display', 'flex')
    .style('flex-wrap', 'wrap')
    .style('gap', '6px')

  const chips = [
    { label: `Image ${stats.image}`, bg: '#eff6ff', color: '#1d4ed8' },
    { label: `Video ${stats.video}`, bg: '#ecfdf5', color: '#047857' },
    { label: `Audio ${stats.audio}`, bg: '#eff6ff', color: '#2563eb' },
    { label: `Text ${stats.text}`, bg: '#f8fafc', color: '#475569' }
  ]

  chips.forEach(chip => {
    chipRow.append('xhtml:span')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('padding', '4px 8px')
      .style('border-radius', '999px')
      .style('background', chip.bg)
      .style('color', chip.color)
      .text(chip.label)
  })

  const memberWrap = body.append('xhtml:div')
    .style('display', 'flex')
    .style('flex-wrap', 'wrap')
    .style('gap', '6px')

  memberNames.slice(0, 5).forEach(name => {
    memberWrap.append('xhtml:span')
      .style('font-size', '10px')
      .style('padding', '4px 8px')
      .style('border-radius', '999px')
      .style('background', '#ffffff')
      .style('border', `1px solid ${NODE_COLORS.overlap}`)
      .style('color', '#475569')
      .style('max-width', '120px')
      .style('overflow', 'hidden')
      .style('text-overflow', 'ellipsis')
      .style('white-space', 'nowrap')
      .text(name)
  })

  if (memberNames.length > 5) {
    memberWrap.append('xhtml:span')
      .style('font-size', '10px')
      .style('padding', '4px 8px')
      .style('border-radius', '999px')
      .style('background', NODE_COLORS.overlapSoft)
      .style('color', '#475569')
      .text(`+${memberNames.length - 5}`)
  }

  const footer = body.append('xhtml:div')
    .style('margin-top', 'auto')
    .style('display', 'flex')
    .style('justify-content', 'space-between')
    .style('align-items', 'center')

  footer.append('xhtml:div')
    .style('font-size', '10px')
    .style('color', '#64748b')
    .text('Local only · no DB write')

  footer.append('xhtml:button')
    .style('padding', '5px 12px')
    .style('border', 'none')
    .style('border-radius', '999px')
    .style('background', NODE_COLORS.overlap)
    .style('color', '#ffffff')
    .style('font-size', '10px')
    .style('font-weight', '700')
    .style('cursor', 'pointer')
    .text('Detach')
    .on('click', ev => {
      ev.stopPropagation()
      emit('ungroup-node', d.id)
    })
}

// --- 辅助函数：渲染媒体内容（图片/音频/文本） ---
function renderMediaContent(container, data) {
  // 渲染文本
  if (data.text) {
    container.append('xhtml:div')
      .style('color', '#374151')
      .style('margin-bottom', '4px')
      .style('word-break', 'break-all')
      .text(`Text: ${data.text.slice(0, 30)}${data.text.length > 30 ? '...' : ''}`);
  }

  // 渲染图片
  if (data.images.length > 0) {
    const imgContainer = container.append('xhtml:div')
      .style('display', 'flex')
      .style('gap', '4px')
      .style('margin-bottom', '4px');

    data.images.slice(0, 2).forEach(imgUrl => {
      imgContainer.append('xhtml:img')
        .attr('src', imgUrl)
        .style('width', '40px')
        .style('height', '40px')
        .style('object-fit', 'cover')
        .style('border-radius', '2px');
    });

    if (data.images.length > 2) {
      imgContainer.append('xhtml:div')
        .style('width', '40px')
        .style('height', '40px')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('background', '#e5e7eb')
        .style('border-radius', '2px')
        .style('font-size', '10px')
        .text(`+${data.images.length - 2}`);
    }
  }

  // 渲染音频
  if (data.audio.length > 0) {
    container.append('xhtml:div')
      .style('color', '#4b5563')
      .style('margin-bottom', '4px')
      .text(`Audio: ${data.audio.length} file(s)`);
  }

  // 无内容提示
  if (!data.text && data.images.length === 0 && data.audio.length === 0) {
    container.append('xhtml:div')
      .style('color', '#9ca3af')
      .text('No content');
  }
}


  // --- 主循环：根据类型分发渲染 ---
  nodeSel.each(function (d) {
    const gEl = d3.select(this)
    const cardType = d._cardType || inferCardType(d)

    // Init 特例
        if (cardType === 'init') {
      // 圆形 Init 节点
      gEl.append('circle')
        .attr('r', 30)
        .attr('fill', '#fff')
        .attr('stroke', NODE_COLORS.auxBorder)
        .attr('stroke-width', 2);

      gEl.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', '14px')
        .style('fill', '#6b7280')
        .style('pointer-events', 'none')
        .text('Init');

      // 左键：保持原来的选中逻辑
      gEl.style('cursor', 'pointer')
        .on('click', (ev) => {
          ev.stopPropagation();
          const selected = new Set(selectedIds);
          if (selected.has(d.id)) selected.delete(d.id);
          else if (selected.size < 2) selected.add(d.id);
          emit('update:selectedIds', Array.from(selected));
        });

      // 右键：弹出菜单 → Add Intent Draft
      gEl.on('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const menu = d3.select('body').append('xhtml:div')
          .style('position', 'absolute')
          .style('left', `${ev.pageX}px`)
          .style('top', `${ev.pageY}px`)
          .style('background', '#ffffff')
          .style('border', '1px solid #e5e7eb')
          .style('border-radius', '4px')
          .style('padding', '4px 0')
          .style('box-shadow', '0 2px 8px rgba(0,0,0,0.1)')
          .style('z-index', '1000')
          .style('min-width', '160px');

        const addMenuItem = (label, onClick) => {
          menu.append('xhtml:div')
            .style('padding', '4px 12px')
            .style('cursor', 'pointer')
            .style('font-size', '12px')
            .style('color', '#374151')
            .on('mouseenter', function () { d3.select(this).style('background', '#f3f4f6'); })
            .on('mouseleave', function () { d3.select(this).style('background', 'transparent'); })
            .text(label)
            .on('click', () => {
              onClick();
              menu.remove();
            });
        };

        addMenuItem('Create Child Draft', () => {
          // 和原来小加号的行为保持一致
          emit('create-card', d, 'AddText', 'util');
        });

        const closeMenu = () => {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
      });

      return;
    }


    const hasIVMedia = !!(d.assets && d.assets.output && d.assets.output.images && d.assets.output.images.length > 0)
    const hasAudioMedia = !!(d.assets && d.assets.output && d.assets.output.audio && d.assets.output.audio.length > 0)
    const hasMedia = hasIVMedia || hasAudioMedia
    const rawIVPath = hasIVMedia ? d.assets.output.images[0] : ''
    const rawAudioPath = hasAudioMedia? d.assets.output.audio[0]:''
    // 从路径推断媒体类型（因为原数据中没有 type 字段）
    const mediaType = rawIVPath.includes('.png') || rawIVPath.includes('.jpg') || rawIVPath.includes('.jpeg') ? 'image' 
      : rawIVPath.includes('.mp4') ? 'video' 
      : rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') ? 'audio' 
      : ''
    //console.log(`getNodeCategory,${mediaType}`)
    const isAudioMedia =
      typeof rawAudioPath === 'string' &&
      (rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') || rawAudioPath.includes('subfolder=audio') || mediaType === 'audio')

    // if (d.isComposite) {
    //   // 复合节点：调用专属渲染函数
    //   console.log('渲染复合节点：', d.id); // 验证是否走到这里
    //   renderCompositeNode(gEl, d, selectedIds, emit);
    // } 
    if (cardType === 'textFull') {
      console.log(`renderTree textFull`)
      renderTextFullNode(gEl, d, selectedIds, emit)
    } else if (getNodeCategory(d) === 'composite') {
      console.log('渲染复合节点：', d.id)
      renderCompositeNode(gEl, d, selectedIds, emit)
    } else if (cardType === 'audio' || isAudioMedia) {
      renderAudioNode(gEl, d, selectedIds, emit, workflowTypes)
    } else if (cardType === 'TextImage') {
      console.log(`render TextImage`)
      renderTextImageNode(gEl, d, selectedIds, emit)
    } else if (cardType === 'AddWorkflow') {
      renderAddWorkflowNode(gEl, d, selectedIds, emit)
    } else {
      renderIONode(gEl, d, selectedIds, emit, workflowTypes)
    }
  })

  setTimeout(() => {
        allNodesData.forEach(node => {
          console.log(`检查节点 ${node.node_id} 的实体数据:`, node.assets?.segmented);
            if (node.assets && node.assets.segmented) {
                updateEntityDisplay(node.id, node.assets.segmented,node);
            }
        });
    }, 100);
}
