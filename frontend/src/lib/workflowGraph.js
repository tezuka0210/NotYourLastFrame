// src/lib/workflowGraph.js
import * as d3 from 'd3'
import * as dagre from 'dagre'
import WaveSurfer from 'wavesurfer.js'

import { workflowParameters } from '@/lib/useWorkflowForm.js';
import { setPrevAgentContext, clearPrevAgentContext } from '@/lib/agentSharedState.js';

// --- link color: light gray for all edges ---
const defaultLinkColor = '#D1D5DB' // gray-300

// --- node category palette (paper-friendly, from CSS variables) ---
const NODE_COLORS = {
  auxBorder:  'var(--media-aux-border)',

  image:      'var(--media-image)',
  video:      'var(--media-video)',
  audio:      'var(--media-audio)',

  imageSoft:  'var(--media-image-soft)',
  videoSoft:  'var(--media-video-soft)',
  audioSoft:  'var(--media-audio-soft)',
}

// 允许在运行时刷新节点颜色（CSS 变量改变后调用）
export function refreshNodeColors() {
  NODE_COLORS.image = getCSSVar('--media-image', NODE_COLORS.image);
  NODE_COLORS.video = getCSSVar('--media-video', NODE_COLORS.video);
  NODE_COLORS.audio = getCSSVar('--media-audio', NODE_COLORS.audio);
  NODE_COLORS.text = getCSSVar('--media-text', NODE_COLORS.text);
  NODE_COLORS.auxBorder = getCSSVar('--media-aux-border', NODE_COLORS.auxBorder);
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
    align: 'UL',
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
function getCSSVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}


// selection shadow color is same as category color, but used in box-shadow
function getNodeCategory(node) {
  const hasIVMedia = !!(node.assets && node.assets.output && node.assets.output.images && node.assets.output.images.length > 0)
  const hasAudioMedia = !!(node.assets && node.assets.output && node.assets.output.audio && node.assets.output.audio.length > 0)
  const hasMedia = hasIVMedia || hasAudioMedia
  const rawIVPath = hasIVMedia ? node.assets.output.images[0] : ''
  const rawAudioPath = hasAudioMedia? node.assets.output.audio[0]:''
  // 从路径推断媒体类型（因为原数据中没有 type 字段）
  const mediaType = rawIVPath.includes('.png') || rawIVPath.includes('.jpg') || rawIVPath.includes('.jpeg') ? 'image' 
    : rawIVPath.includes('.mp4') ? 'video' 
    : rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') ? 'audio' 
    : ''
  //console.log(`getNodeCategory,${mediaType}`)
  // const isAudioMedia =
  //   typeof rawAudioPath === 'string' &&
  //   (rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') || rawAudioPath.includes('subfolder=audio') || mediaType === 'audio')
  const isAudioMedia = (node.module_id=='TextToAudio')

  // const isVideoMedia =
  //   typeof rawIVPath === 'string' &&
  //   (rawIVPath.includes('.mp4') || rawIVPath.includes('subfolder=video') || mediaType === 'video')
  const isVideoMedia = (node.module_id=='TextGenerateVideo')||(node.module_id=='ImageGenerateVideo')||(node.module_id=='FLFrameToVideo')||(node.module_id=='TextToVideo')

  const isImageMedia = hasMedia && !isAudioMedia && !isVideoMedia

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
  if (cat === 'audio') return NODE_COLORS.audio
  if (cat === 'image') return NODE_COLORS.image
  if (cat === 'video') return NODE_COLORS.video
  return NODE_COLORS.auxBorder
}

function getSelectionColor(node) {
  const cat = getNodeCategory(node)
  if (cat === 'audio') return NODE_COLORS.audio
  if (cat === 'image') return NODE_COLORS.image
  if (cat === 'video') return NODE_COLORS.video
  return '#CBD5E1'
}

//重写名称
function getNodeHeaderBaseLabel(node) {
  const mid = (node.module_id || '').toLowerCase()

  // ★ 两个辅助节点用语义化标题
  if (mid === 'addtext') {
    // 原始用户意图 + 初次改写
    return 'Intent Draft'
  }
  if (mid === 'addworkflow') {
    // 在改写基础上整理成可执行工作流
    return 'Workflow Planning'
  }

  // 其他节点维持原有逻辑
  return node.module_id || '(Node)'
}


/** 统一控制卡片选中样式 */
function setCardSelected(cardSel, nodeData, isSelected) {
  // 只通过 class 控制选中状态，具体阴影 & 颜色交给 CSS
  cardSel.classed('is-selected', isSelected)
  // 不再在这里写 box-shadow，避免覆盖你在 CSS 里的
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

// /** 基于 _collapsed 计算可见节点与连线 */
// export function getVisibleNodesAndLinks(allNodes) {
//   if (!allNodes || allNodes.length === 0) {
//     return { visibleNodes: [], visibleLinks: [] }
//   }

//   const nodeMap = new Map(allNodes.map(n => [n.id, { ...n, children: [] }]))
//   allNodes.forEach(n => {
//     if (n.originalParents) {
//       n.originalParents.forEach(parentId => {
//         const p = nodeMap.get(parentId)
//         if (p) p.children.push(n)
//       })
//     }
//   })

//   const hidden = new Set()
//   allNodes.forEach(node => {
//     if (node._collapsed) {
//       findDescendants(node.id, nodeMap).forEach(id => hidden.add(id))
//     }
//   })

//   const visibleNodes = allNodes.filter(n => !hidden.has(n.id))
//   const visibleIds = new Set(visibleNodes.map(n => n.id))

//   const visibleLinks = []
//   visibleNodes.forEach(n => {
//     if (n.originalParents) {
//       n.originalParents.forEach(p => {
//         if (visibleIds.has(p)) visibleLinks.push({ source: p, target: n.id })
//       })
//     }
//   })

//   return { visibleNodes, visibleLinks }
// }
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
  })

  const visibleNodes = allNodes.filter(n => !hidden.has(n.id))
  const visibleIds = new Set(visibleNodes.map(n => n.id))

  const visibleLinks = []
  visibleNodes.forEach(n => {
    if (n.originalParents && n.originalParents.length > 0) { // 新增：判断有父节点
      // 改动2：只取第一个父节点生成连线，不再遍历所有p
      const p = (n.originalParents[1])?n.originalParents[1]:n.originalParents[0]; 
      if (visibleIds.has(p)) visibleLinks.push({ source: p, target: n.id })
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

      const isSelected = selectedIds.includes(d.id)
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

    addMenuItem('Add Intent Draft', () => {
      emit('create-card', d, 'AddText', 'util')
    })

    addMenuItem('Add Workflow Planning', () => {
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
        btn
          .text(d._collapsed ? '+' : '-')
          .style('color', d._collapsed ? '#E4080A' : '#9ca3af')
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

  const dagreNodes = new Map(g.nodes().map(id => [id, g.node(id)]))
  const dagreEdges = g.edges().map(e => {
    const edgeData = g.edge(e)
    return { v: e.v, w: e.w, points: edgeData.points }
  })

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
      layoutConfig.nodesep = layoutOptions.horizontalGap
    }
    if (typeof layoutOptions.verticalGap === 'number') {
      layoutConfig.ranksep = layoutOptions.verticalGap
    }
  }

  const wrapper = d3.select(svgElement)

  // ⭐ 优先用外部传进来的 viewState；如果没有，就从 d3 的内部 zoom 状态恢复
  let savedView = viewState
  if (!savedView) {
    const prev = wrapper.property('__zoom')      // d3.zoom 内部记录
    if (prev) {
      savedView = { k: prev.k, x: prev.x, y: prev.y }
    }
  }

  // 清空旧内容，但不要动 wrapper 本身（保留 __zoom 属性）
  wrapper.html('')

  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodesData)
  if (!visibleNodes.length) {
    wrapper.append('text')
      .attr('x', '50%').attr('y', '50%')
      .attr('text-anchor', 'middle')
      .attr('fill', '#9ca3af')
      .text('No workflow yet. Generate nodes to start.')
    return
  }


  // Dagre 布局（使用统一配置）
  const g = createDagreGraph();

  const BASE_CARD_HEIGHT = 170
  const PROMPT_AREA_HEIGHT = 30

  visibleNodes.forEach(node => {
    const cardType = inferCardType(node)
    const isInit = cardType === 'init'

    //console.log('节点完整数据:', node);
    //console.log('assets 数据:', node.assets); // 
    const hasMedia = !!(node.assets && node.assets.output && node.assets.output.images && node.assets.output.images.length > 0)
    const rawPath = hasMedia ? node.assets.output.images[0] : ''
    const isAudioMedia = typeof rawPath === 'string' &&
      (rawPath.includes('.mp3') || rawPath.includes('.wav') || rawPath.includes('subfolder=audio'))
    const promptText = (node.parameters) ? (node.parameters.positive_prompt || node.parameters.text) : null
    const hasPrompt = typeof promptText === 'string' && promptText.trim() !== ''
    //console.log(`hasMedia:${hasMedia}`)
    let width, height

    if (isInit) {
      width = 60
      height = 60
    } else if (cardType === 'textFull') {
      // AddText → Intent Draft，单栏对话框
      width = 260
      height = 150
    } else if (cardType === 'AddWorkflow') {
      // Workflow Planning，需要比 Intent Draft 稍高一点
      width = 260
      height = 190
    } else if (cardType === 'TextImage') {
      width = 260
      height = 140
    } else if (cardType === 'audio' || isAudioMedia) {
      width = 260
      height = hasPrompt ? 175 : 110
    } else { // io
      width = 260
      if (hasMedia && hasPrompt) {
        height = BASE_CARD_HEIGHT + PROMPT_AREA_HEIGHT
      } else if (hasMedia) {
        height = BASE_CARD_HEIGHT
      } else if (hasPrompt) {
        height = 140
      } else {
        height = 120
      }
    }

    node.calculatedWidth = width
    node.calculatedHeight = height
    node._cardType = cardType

    g.setNode(node.id, {
      label: node.module_id,
      width,
      height
    })
  })

  visibleLinks.forEach(l => g.setEdge(l.source, l.target))
  dagre.layout(g)

  const dagreNodes = new Map(g.nodes().map(id => [id, g.node(id)]))
  const dagreEdges = g.edges().map(e => {
    const edgeData = g.edge(e)
    return { v: e.v, w: e.w, points: edgeData.points }
  })

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
      .style('padding', '2px 6px')
      .style('border-bottom', '1px solid #e5e7eb')
      .style('flex-shrink', '0')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')

    // ★ 头部背景颜色，保持不变
    const cat = getNodeCategory(d)
    let headerBg = '#F9FAFB' // 默认灰

    if (cat === 'image') {
      headerBg = NODE_COLORS.imageSoft
    } else if (cat === 'video') {
      headerBg = NODE_COLORS.videoSoft
    } else if (cat === 'audio') {
      headerBg = NODE_COLORS.audioSoft
    }

    header
      .style('background-color', headerBg)
      .attr('data-node-category', cat)

    // ★ 初始标题：优先用 displayName，其次用 getNodeHeaderBaseLabel
    const initialLabel = d.displayName || getNodeHeaderBaseLabel(d)

    const title = header.append('xhtml:div')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('color', '#111827')
      .style('overflow', 'hidden')
      .style('text-overflow', 'ellipsis')
      .style('white-space', 'nowrap')
      .style('min-width', '0')
      .style('cursor', 'text')
      .text(initialLabel)

    // ★ 双击标题进入编辑模式（保留你之前的 rename 行为）
    title.on('dblclick', (ev) => {
      ev.stopPropagation()
      if (isEditingTitle) return
      isEditingTitle = true

      const currentLabel = d.displayName || getNodeHeaderBaseLabel(d)

      // 清空原文字，改成一个 input
      title.text(null)
        .style('border', '1px dashed #9ca3af')
        .style('border-radius', '4px')
        .style('padding', '1px 3px')

      const input = title.append('xhtml:input')
        .attr('type', 'text')
        .attr('value', currentLabel)
        .style('width', '100%')
        .style('font-size', '10px')
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

        const baseLabel = getNodeHeaderBaseLabel(d)
        const newText = commit && inputNode
          ? inputNode.value.trim()
          : (d.displayName || baseLabel)

        const finalLabel = newText || baseLabel
        d.displayName = finalLabel   // 记录在节点对象里

        // 还原标题展示
        title.selectAll('*').remove()
        title
          .style('border', 'none')
          .style('padding', '0')
          .text(finalLabel)
      }

      // 回车确认
      d3.select(inputNode).on('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          finishEdit(true)
          // 通知外部更新（父组件可以监听 'rename-node' 来改 nodes）
          emit('rename-node', { id: d.id, label: d.displayName })
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finishEdit(false)
        }
      })

      // 失焦也视作确认
      d3.select(inputNode).on('blur', () => {
        finishEdit(true)
        emit('rename-node', { id: d.id, label: d.displayName })
      })
    })

    const toolbar = header.append('xhtml:div')
      .style('display', 'flex')
      .style('gap', '4px')
      .style('align-items', 'center')

    // 是否有子节点（决定要不要显示折叠按钮）
    const tempMap = new Map(allNodesData.map(n => [n.id, { ...n, children: [] }]))
    allNodesData.forEach(n => {
      if (n.originalParents) {
        n.originalParents.forEach(p => tempMap.get(p)?.children.push(n))
      }
    })
    const hasChildren = !!(tempMap.get(d.id) && tempMap.get(d.id).children.length)

    // 折叠（- / +）——和其他节点完全一致
    if (hasChildren) {
      const collapseBtn = toolbar.append('xhtml:button')
        .attr('class', 'collapse-btn')
        .text(d._collapsed ? '+' : '-')
        .style('width', '18px')
        .style('height', '18px')
        .style('border-radius', '999px')
        .style('border', '1px solid #e5e7eb')
        .style('background', '#ffffff')
        .style('font-size', '12px')
        .style('line-height', '1')
        .style('display', 'inline-flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('color', d._collapsed ? '#E4080A' : '#9ca3af')
        .style('cursor', 'pointer')
        .style('user-select', 'none')
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation()
          emit('toggle-collapse', d.id)
        })
        .on('mouseenter', function () {
          d3.select(this)
            .style('background', '#6b7280')   // gray-500
            .style('color', '#ffffff')
            .style('border-color', '#4b5563') // gray-600
        })
        .on('mouseleave', function () {
          d3.select(this)
            .style('background', '#ffffff')
            .style('color', d._collapsed ? '#E4080A' : '#9ca3af')
            .style('border-color', '#e5e7eb')
        })
    }

    // 复制（和其他节点一样）
    const cloneHeaderBtn = toolbar.append('xhtml:button')
      .text('+')
      .style('width', '18px')
      .style('height', '18px')
      .style('border-radius', '999px')
      .style('border', '1px solid #e5e7eb')
      .style('background', '#ffffff')
      .style('font-size', '12px')
      .style('line-height', '1')
      .style('display', 'inline-flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('color', '#6b7280')
      .style('cursor', 'pointer')
      .style('user-select', 'none')
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', ev => {
        ev.stopPropagation()
        // TODO: clone node
        console.log('[TODO] clone node', d.id)
      })
      .on('mouseenter', function () {
        d3.select(this)
          .style('background', '#6b7280')
          .style('color', '#ffffff')
          .style('border-color', '#4b5563')
      })
      .on('mouseleave', function () {
        d3.select(this)
          .style('background', '#ffffff')
          .style('color', '#6b7280')
          .style('border-color', '#e5e7eb')
      })

    // 删除（关闭），同样保持一致
    const deleteHeaderBtn = toolbar.append('xhtml:button')
      .text('×')
      .style('width', '18px')
      .style('height', '18px')
      .style('border-radius', '999px')
      .style('border', '1px solid #fecaca')   // red-200
      .style('background', '#ffffff')
      .style('font-size', '12px')
      .style('line-height', '1')
      .style('display', 'inline-flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('color', '#dc2626')              // red-600
      .style('cursor', 'pointer')
      .style('user-select', 'none')
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', ev => {
        ev.stopPropagation()
        emit('delete-node', d.id)
      })
      .on('mouseenter', function () {
        d3.select(this)
          .style('background', '#dc2626')
          .style('color', '#ffffff')
          .style('border-color', '#dc2626')
      })
      .on('mouseleave', function () {
        d3.select(this)
          .style('background', '#ffffff')
          .style('color', '#dc2626')
          .style('border-color', '#fecaca')
      })

    return header
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
      .style('border-radius', '8px')
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')

    // 选中样式（保留原逻辑）
    setCardSelected(card, d, selectedIds.includes(d.id))

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
      .text('Input Thought')

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
      .attr('placeholder', 'Describe your idea, goal, or rough story...')
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
    // 1. 计算布局 (类似 IO 卡)
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
      .style('border-radius', '8px')
      .style('border-color', getNodeBorderColor(d))
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')

    setCardSelected(card, d, selectedIds.includes(d.id))

    card.on('click', ev => {
      if (
        ev.target &&
        ev.target.closest &&
        ev.target.closest('button, img, video, input, textarea')
      ) return

      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      setCardSelected(card, d, !on)
      emit('update:selectedIds', Array.from(selected))
    })

    card.on('mouseenter', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '1'))
      .on('mouseleave', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '0'))

    buildHeader(card, d)
    addRightClickMenu(card, d, emit);
    // --- 核心布局：左右分栏 ---
    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('flex-direction', 'row') // 左右排列

    // === 左侧：纯文本编辑器 ===
    const left = body.append('xhtml:div')
      .style('flex', '1') // 占据 50%
      .style('min-width', '0')
      .style('border-right', '1px solid #e5e7eb')
      .style('display', 'flex')
      .style('flex-direction', 'column')

    // 这里复用你之前改好的 textarea 逻辑
    const promptText = d.parameters?.text || d.parameters?.positive_prompt || ''
    const textArea = left.append('xhtml:textarea')
        .attr('class', 'thin-scroll')
        .style('flex', '1').style('width', '100%').style('padding', '6px')
        .style('font-size', '10px').style('color', '#374151')
        .style('border', 'none').style('resize', 'none').style('outline', 'none')
        .style('background', 'transparent')
        .property('value', promptText)
        .on('mousedown', ev => ev.stopPropagation())
        
        .on('blur', function() {
            const newVal = d3.select(this).property('value')
            if (newVal !== promptText) {
              if (!d.parameters) d.parameters = {}
              d.parameters.text = newVal
              emit('update-node-parameters', d.id, d.parameters)
            }
        })

    // === 右侧：媒体显示区 ===
    const right = body.append('xhtml:div')
      .style('flex', '1 1 0')
      .style('min-width', '0')
      .style('padding', '2px 4px')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('position', 'relative')
      .style('overflow', 'hidden')

    // 判断是否有媒体内容
    const hasMedia = !!(d.assets && d.assets.input && d.assets.input.images && d.assets.input.images.length > 0)
    const mediaUrl = hasMedia ? d.assets.input.images : ''
    console.log(`rendetTextImageNode ${mediaUrl}`)
    
    // 创建上传容器（居中显示）
    const uploadContainer = right.append('xhtml:div')
      .style('width', '80%')
      .style('height', '80%')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('gap', '8px')
      .style('border', hasMedia ? 'none' : '2px dashed #d1d5db')
      .style('border-radius', '4px')
      .style('cursor', 'pointer')
      .style('transition', 'border-color 0.2s')
      .style('position', 'relative')   // ⭐ 关键：让绝对定位 input 只盖住这个 80% 区域
      .on('mouseenter', function() {
        if (!hasMedia) d3.select(this).style('border-color', '#9ca3af')
      })
      .on('mouseleave', function() {
        if (!hasMedia) d3.select(this).style('border-color', '#d1d5db')
      })


    // 如果有媒体，显示媒体内容
    if (hasMedia) {
      mediaUrl.slice(0, 2).forEach(imgUrl => {
      uploadContainer.append('xhtml:img')
        .attr('src', imgUrl)
        .style('max-width', '50%') // 每张图占容器一半宽度
        .style('max-height', '100%')
        .style('object-fit', 'contain')
        .style('border-radius', '4px'); // 可选：添加边框圆角
  });
    } else {
      // 无媒体时显示加号和提示文字
      const uploadContent = uploadContainer.append('xhtml:div')
        .style('text-align', 'center')
        .style('color', '#6b7280')

      // 加号图标（使用大号字体模拟）
      uploadContent.append('xhtml:div')
        .style('font-size', '24px')
        .style('line-height', '1')
        .style('margin-bottom', '4px')
        .text('+')

    }

    // 添加实际的文件上传输入（隐藏但保持功能）
    const fileInput = uploadContainer.append('xhtml:input')
      .attr('type', 'file')
      .attr('accept', 'image/*')
      .attr('multiple', true)
      .style('position', 'absolute')
      .style('top', '0')
      .style('left', '0')
      .style('width', '100%')
      .style('height', '100%')
      .style('opacity', '0')
      .style('cursor', 'pointer')
      .on('mousedown', ev => ev.stopPropagation())  // ⭐ 不让事件继续冒泡到 card
      .on('click', ev => ev.stopPropagation())
      .on('change', function () {
        const file = this.files && this.files.length > 0 ? this.files[0] : null
        if (file) {
          emit('upload-media', d.id, file)
          this.value = ''
        } else {
          console.warn('未选择有效文件')
        }
      })

    const toolbar = card.append('xhtml:div')
      .style('flex-shrink', '0')
      .style('padding', '4px 2px')
      .style('display', 'flex')
      .style('justify-content', 'flex-end')
      .style('gap', '4px')


    // Agent button
    const AgentBtn = toolbar.append('xhtml:button')
      .text('A')
      .attr('class', 'icon-circle-btn')
      .attr('title','agent button')
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', (ev) => {
        ev.stopPropagation();
        //清空agent状态
        clearPrevAgentContext();
        // 收集需要传递的内容（例如节点参数、用户输入等）
        const payload = {
          user_input: d.parameters?.positive_prompt || d.parameters?.text || '', // 节点文本内容
          node_id: d.id, // 当前节点ID
          image_url: mediaUrl || '',
          workflow_context: {
            current_workflow: d.module_id, // 当前使用的工作流
            parent_nodes: d.originalParents || [] // 父节点信息
          }
        };
        //发送请求到后端agent接口
        fetch('/api/agents/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
          console.log('Agent处理结果:', data);
            // 提取需要共享的关键上下文（按需选择，不用全存）
          const agentContext = {
            global_context: data.global_context || '',
            intent: data.intent || '',
            selected_workflow: data.selected_workflow || '',
            knowledge_context: data.knowledge_context || '',
            image_caption: data.image_caption || '',
            style: data.style || ''
          };
          // 存储到共享工具中（关键步骤）
          setPrevAgentContext(agentContext);
          
          // 处理返回结果（例如更新节点、提示用户等）
          const rawWorkflowId = data.selected_workflow || '';
          const workflowId = rawWorkflowId.replace(".json", ''); // 移除末尾的 .json
          const workflow_title = data.workflow_title;
          import('@/lib/useWorkflowForm.js').then(({ workflowParameters }) => {
          if (!workflowParameters) {
            console.error('workflowParameters 未正确导入');
            return;
          }

          // 1. 获取对应工作流的参数定义数组（如 [{id: 'positive_prompt', ...}, ...]）
          const paramDefinitions = workflowParameters[workflowId] || [];
          
          // 2. 将参数定义数组转换为 { id: defaultValue } 格式的对象
          const defaultParams = paramDefinitions.reduce((obj, param) => {
            obj[param.id] = param.defaultValue; // 以参数id为键，默认值为值
            return obj;
          }, {});
          
          // 3. 整合参数（agent返回的prompt覆盖默认值）
          const updatedParams = {
            ...defaultParams, // 基础默认参数
            positive_prompt: data.message.positive || defaultParams.positive_prompt || '', // 优先使用agent返回的positive
            negative_prompt: data.message.negative || defaultParams.negative_prompt || '', // 优先使用agent返回的negative
          };
          console.log('转换后的参数格式:', updatedParams);


          // 4. 更新节点参数并触发刷新
          d.parameters = updatedParams;
          // 5. 调用App.vue的handleRefreshNode刷新节点
          emit('refresh-node', d.id, workflowId, d.parameters,workflow_title);
          });
        })
        
        .catch(err => console.error('调用Agent失败:', err));
      })
      .on('mouseenter', function () {
        d3.select(this)
          .style('background', '#6b7280')
          .style('color', '#ffffff')
          .style('border-color', '#4b5563')
      })
      .on('mouseleave', function () {
        d3.select(this)
          .style('background', '#ffffff')
          .style('color', '#6b7280')
          .style('border-color', '#e5e7eb')
      })
    addTooltip(gEl, d)
  }


  /**
 * 文本 + 音频节点（上下结构，分 Input / Output 两块）
 */
function renderAudioNode(gEl, d, selectedIds, emit, workflowTypes) {
  // 兼容数组或字符串形式的 audio 资源
  let mediaUrl = '';
  const audioAsset = d.assets?.output?.audio;
  if (Array.isArray(audioAsset)) {
    mediaUrl = audioAsset[0] || '';
  } else if (typeof audioAsset === 'string') {
    mediaUrl = audioAsset;
  }

  const promptText = (d.parameters)
    ? (d.parameters.positive_prompt || d.parameters.text || '')
    : '';
  // console.log(`audio prompt`,promptText)
  // console.log(`d.parameters`,d.parameters)

  const fo = gEl.append('foreignObject')
    .attr('width', d.calculatedWidth)
    .attr('height', d.calculatedHeight)
    .attr('x', -d.calculatedWidth / 2)
    .attr('y', -d.calculatedHeight / 2)
    .style('overflow', 'visible');

  const card = fo.append('xhtml:div')
    .attr('class', 'node-card')
    .attr('data-node-category', getNodeCategory(d))
    .style('width', '100%')
    .style('height', '100%')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('border-width', '2px')
    .style('border-color', getNodeBorderColor(d))
    .style('border-radius', '8px')
    .style('position', 'relative')
    .style('cursor', 'pointer')
    .style('background-color', '#ffffff')
    .style('user-select', 'none')
    .style('-webkit-user-select', 'none');

  setCardSelected(card, d, selectedIds.includes(d.id));

  card.on('click', ev => {
    if (ev.target && ev.target.closest && ev.target.closest('button, input, textarea, video, img')) return;
    ev.stopPropagation();
    const selected = new Set(selectedIds);
    const on = selected.has(d.id);
    if (on) selected.delete(d.id);
    else if (selected.size < 2) selected.add(d.id);
    setCardSelected(card, d, !on);
    emit('update:selectedIds', Array.from(selected));
  });

  card.on('mouseenter', () =>
    card.selectAll('.add-clip-btn, .dots-container').style('opacity', '1')
  ).on('mouseleave', () =>
    card.selectAll('.add-clip-btn, .dots-container').style('opacity', '0')
  );

  // Header：节点标题 + 折叠 / 复制 / 删除
  buildHeader(card, d);
  addRightClickMenu(card, d, emit);

  // ====== 主体：上下两块 Input / Output ======
  const body = card.append('xhtml:div')
    .style('flex', '1 1 auto')
    .style('min-height', '0')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('padding', '4px 4px')
    .style('gap', '4px');

  /* ==================== Input 区 ==================== */
  const inputSection = body.append('xhtml:div')
    .style('flex', '0 0 auto')
    .style('display', 'flex')
    .style('flex-direction', 'column');

  const inputHeader = inputSection.append('xhtml:div')
    .attr('class', 'io-header');

  inputHeader.append('xhtml:span')
    .attr('class', 'io-title')
    .text('Input');

  // ↻：根据当前文本重新生成音频
  inputHeader.append('xhtml:div')
    .attr('class', 'icon-circle-btn output-clip-btn')
    .text('↻')
    .attr('title', 'Apply & Regenerate')
    .on('mouseenter', function () { d3.select(this).style('color', '#2563eb'); })
    .on('mouseleave', function () { d3.select(this).style('color', '#6b7280'); })
    .on('mousedown', ev => ev.stopPropagation())
    .on('click', (ev) => {
      ev.stopPropagation();
      const textVal = textArea.property('value') || '';
      const baseParams = d.parameters || {};
      const currentParams = {
        ...baseParams,
        text: textVal,
        positive_prompt: textVal
      };
      emit('regenerate-node', d.id, d.module_id, currentParams);
    });

  // inputSection.append('xhtml:div')
  //   .attr('class', 'io-divider');

  const textArea = inputSection.append('xhtml:textarea')
    .attr('class', 'thin-scroll')
    .style('flex', '0 0 auto')
    // .style('width', '100%')
    .style('min-height', '48px')
    .style('padding', '4px 6px')
    .style('font-size', '10px')
    .style('color', '#374151')
    .style('background-color', '#f9fafb')
    .style('border', '1px solid #e5e7eb')
    .style('border-radius', '6px')
    .style('resize', 'none')
    .style('outline', 'none')
    .style('font-family', 'inherit')
    .attr('placeholder', 'Describe the narration or sound you want to generate...')
    .property('value', promptText)
    .on('mousedown', ev => ev.stopPropagation());

  // 文本修改同步到参数
  textArea.on('blur', function () {
    const val = d3.select(this).property('value') || '';
    if (!d.parameters) d.parameters = {};
    d.parameters.text = val;
    d.parameters.positive_prompt = val;
    emit('update-node-parameters', d.id, d.parameters);
  });

  inputSection.append('xhtml:div')
    .attr('class', 'io-divider');

  /* ==================== Output 区 ==================== */
  const outputSection = body.append('xhtml:div')
    .style('flex', '1 1 auto')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('min-height', '0');

  const outputHeader = outputSection.append('xhtml:div')
    .attr('class', 'io-header');

  outputHeader.append('xhtml:span')
    .attr('class', 'io-title')
    .text('Output');

  // A：加入到 storyboard buffer（等价原来 footer 里的 add-clip-btn）
  outputHeader.append('xhtml:div')
    .style('margin-left', 'auto')
    .style('cursor', mediaUrl ? 'pointer' : 'not-allowed')
    .attr('class', 'icon-circle-btn output-clip-btn')
    .style('color', mediaUrl ? '#6b7280' : '#d1d5db')
    .text('↗')
    .attr('title', 'Add to storyboard')
    .on('mousedown', ev => ev.stopPropagation())
    .on('click', ev => {
      ev.stopPropagation();
      if (!mediaUrl) return;
      emit('add-clip', d, mediaUrl,'audio');
    })
    .on('mouseenter', function () {
      if (!mediaUrl) return;
      d3.select(this).style('color', '#2563eb');
    })
    .on('mouseleave', function () {
      if (!mediaUrl) return;
      d3.select(this).style('color', '#6b7280');
      
    });

  // outputSection.append('xhtml:div')
  //   .attr('class', 'io-divider');

  // 播放器区域：和其他节点的内外边距保持一致
  const audioRow = outputSection.append('xhtml:div')
    .style('flex', '1 1 auto')
    .style('display', 'flex')
    .style('align-items', 'center')
    .style('gap', '8px')
    .style('padding', '2px 0')
    .style('min-height', '0');

  const playBtn = audioRow.append('xhtml:button')
    .style('width', '32px')
    .style('height', '32px')
    .style('border', 'none')
    .style('background-color', NODE_COLORS.audio)
    .style('color', '#ffffff')
    .style('border-radius', '50%')
    .style('font-size', '16px')
    .style('display', 'flex')
    .style('align-items', 'center')
    .style('justify-content', 'center')
    .style('padding', '0')
    .style('line-height', '1')
    .style('flex-shrink', '0')
    .style('cursor', mediaUrl ? 'pointer' : 'not-allowed')
    .style('user-select', 'none')
    .style('opacity', mediaUrl ? '1' : '0.5')
    .html('▶')
    .on('mousedown', ev => ev.stopPropagation());

  const waveformWrapper = audioRow.append('xhtml:div')
    .style('flex-grow', '1')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('justify-content', 'center')
    .style('min-width', '0');

  const waveformDiv = waveformWrapper.append('xhtml:div')
    .style('width', '100%')
    .style('height', '20px');

  const timeDisplay = waveformWrapper.append('xhtml:div')
    .style('font-size', '10px')
    .style('color', '#6b7280')
    .text(mediaUrl ? '0:00 / --:--' : '');

  // WaveSurfer 逻辑（仅在有音频时初始化）
  let wavesurfer = null;
  if (mediaUrl) {
    wavesurfer = WaveSurfer.create({
      container: waveformDiv.node(),
      waveColor: '#9ca3af',
      progressColor: NODE_COLORS.audio,
      height: 20,
      barHeight: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      url: mediaUrl
    });

    wavesurfer.on('ready', (duration) => {
      timeDisplay.text(`0:00 / ${formatTime(duration)}`);
    });

    wavesurfer.on('timeupdate', (currentTime) => {
      timeDisplay.text(`${formatTime(currentTime)} / ${formatTime(wavesurfer.getDuration())}`);
    });

    wavesurfer.on('finish', () => {
      playBtn.html('▶');
    });

    wavesurfer.on('error', (err) => {
      console.error('WaveSurfer error:', err);
      waveformDiv.html(`<span style="color:red; font-size:10px;">Audio error</span>`);
    });

    playBtn.on('click', ev => {
      ev.stopPropagation();
      wavesurfer.playPause();
      if (wavesurfer.isPlaying()) {
        playBtn.html('⏸');
      } else {
        playBtn.html('▶');
      }
    });
  } else {
    playBtn.on('click', ev => ev.stopPropagation());
  }

  // 节点被移除时销毁 WaveSurfer
  fo.on('remove', () => {
    if (wavesurfer) wavesurfer.destroy();
  });

  addTooltip(gEl, d);
}


/**
 * 左右 IO 卡：左输入，右输出（图片 / 视频 / 文本）
 */
function renderIONode(gEl, d, selectedIds, emit, workflowTypes) {
  const assets = d.assets?.output || {};
  const allMedia = assets.images || [];

  const videoUrls = allMedia.filter(url =>
    url.includes('.mp4') ||
    url.includes('.mov') ||
    url.includes('.webm') ||
    url.includes('subfolder=video')
  );
  const imageUrls = allMedia.filter(url => !videoUrls.includes(url));

  const hasMedia = !!(d.assets && d.assets.output && d.assets.output.images && d.assets.output.images.length > 0);
  const rawIVPath = hasMedia ? d.assets.output.images[0] : '';

  const isVideo = rawIVPath.includes('.mp4') || rawIVPath.includes('subfolder=video');
  const isImage = hasMedia && !isVideo && assets.type !== 'audio';
  const canAddToStitch = hasMedia && (isImage || isVideo);

  const promptText = d.parameters ? (d.parameters.positive_prompt || d.parameters.text) : null;
  const hasPrompt = typeof promptText === 'string' && promptText.trim() !== '';

  // 从 CSS 变量里读模态颜色
  const rootStyle = getComputedStyle(document.documentElement);
  const mediaVideoColor = rootStyle.getPropertyValue('--media-video').trim() || '#5ABF8E';
  const mediaImageColor = rootStyle.getPropertyValue('--media-image').trim() || '#5F96DB';

  // ⭐ 支持多选：用 Set 存所有选中的 mediaUrl
  const selectedMediaUrls = new Set();
  let selectedMediaUrl = null; // 保留最后一次点击的，兼容你其他逻辑


  const fo = gEl.append('foreignObject')
    .attr('width', d.calculatedWidth)
    .attr('height', d.calculatedHeight)
    .attr('x', -d.calculatedWidth / 2)
    .attr('y', -d.calculatedHeight / 2)
    .style('overflow', 'visible');

  const card = fo.append('xhtml:div')
    .attr('class', 'node-card')
    .attr('data-node-category', getNodeCategory(d))
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('height', '100%')
    .style('cursor', 'pointer')
    .style('position', 'relative')
    .style('user-select', 'none')
    .style('-webkit-user-select', 'none')

  // 初始选中状态
  setCardSelected(card, d, selectedIds.includes(d.id))

  addRightClickMenu(card, d, emit);

  card.on('click', ev => {
    if (ev.target && ev.target.closest && ev.target.closest('button, img, video, input, textarea')) return
    ev.stopPropagation()
    const selected = new Set(selectedIds)
    const on = selected.has(d.id)
    if (on) selected.delete(d.id)
    else if (selected.size < 2) selected.add(d.id)
    setCardSelected(card, d, !on)
    emit('update:selectedIds', Array.from(selected))
  })

  /* ---------- 顶部 header ---------- */
  buildHeader(card, d);

  /* ---------- 主体：左右两列 ---------- */
  const body = card.append('xhtml:div')
    .style('flex', '1 1 auto')
    .style('min-height', '0')
    .style('display', 'flex')
    .style('padding', '4px 2px');

  /* ==================== 左侧 Input 列 ==================== */
  const left = body.append('xhtml:div')
    .attr('class', 'thin-scroll nodrag')
    .style('flex', '1 1 0')
    .style('min-width', '0')
    .style('padding', '2px 4px 4px')
    .style('border-right', '1px solid #e5e7eb')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    // .style('gap', '2px')
    .style('font-size', '9px')
    .style('line-height', '1.3');

  // Input + ↻
  const headerRow = left.append('xhtml:div')
    .attr('class', 'io-header'); 

  headerRow.append('xhtml:span')
    .attr('class', 'io-title')
    .text('Input');

  headerRow.append('xhtml:div')
    .attr('class', 'icon-circle-btn')  // 仅加这个类，无其他新增
    .text('↻')
    .attr('title', 'Apply & Regenerate')
    .on('mouseenter', function () { d3.select(this).style('color', '#2563eb'); })
    .on('mouseleave', function () { d3.select(this).style('color', '#6b7280'); })
    .on('mousedown', ev => ev.stopPropagation())
    .on('click', (ev) => {
      ev.stopPropagation();
      const params = d.parameters || {};
      const currentParams = {};

      if (params.positive_prompt) {
        const positivePhrases = parsePrompt(params.positive_prompt);
        const positiveStr = positivePhrases
          .filter(p => p.text.trim())
          .map(p => `(${p.text.trim()}:${p.weight.toFixed(1)})`)
          .join(', ');
        currentParams.positive_prompt = positiveStr;
      }

      if (params.negative_prompt) {
        const negativePhrases = parsePrompt(params.negative_prompt);
        const negativeStr = negativePhrases
          .filter(p => p.text.trim())
          .map(p => `(${p.text.trim()}:${p.weight.toFixed(1)})`)
          .join(', ');
        currentParams.negative_prompt = negativeStr;
      }

      left.selectAll('.node-input').each(function () {
        const el = d3.select(this);
        const key = el.attr('data-key');
        let val = el.property('value');
        if (el.attr('type') === 'number') val = Number(val);
        if (key && key !== 'positive_prompt' && key !== 'negative_prompt') {
          currentParams[key] = val;
        }
      });

      emit('regenerate-node', d.id, d.module_id, currentParams);
    });

  // 标题下方统一虚线
  left.append('xhtml:div')
    .attr('class', 'io-divider');

  const params = d.parameters || {};
  const isVideoNode = /Video/i.test(d.module_id);
  const orderedParamKeys = isVideoNode
    ? ['batch_size', 'fps', 'time', 'height', 'width']
    : ['batch_size', 'guidance', 'steps', 'height', 'width','high_threshold','low_threshold','position'];

  const paramPairs = orderedParamKeys
    .filter(k => params[k] !== undefined)
    .map(k => [k, params[k]]);

  const parsePrompt = (prompt) => {
    if (!prompt) return [];
    const trimmed = prompt.trim();
    if (!trimmed) return [];

    const noBrackets = trimmed.replace(/[()]/g, '');
    return noBrackets
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => {
        if (item.includes(':')) {
          const [text, weightStr] = item.split(':').map(v => v.trim());
          return { text, weight: parseFloat(weightStr) || 1.0 };
        }
        return { text: item, weight: 1.0 };
      })
      .filter(p => p.text.trim());
  };

    /* ---------- Positive Prompt ---------- */
  const positiveSection = left.append('xhtml:div')
    .attr('class', 'input-section input-section--primary');

  // 在闭包里维护当前的 positive phrases 数组
  let positivePhrases = parsePrompt(params.positive_prompt || params.text || '');
  let positiveCollapsed = false;

  const positiveHeader = positiveSection.append('xhtml:div')
    .attr('class', 'prompt-section-header')
    .on('mousedown', ev => ev.stopPropagation())
    .on('click', ev => {
      ev.stopPropagation();
      if (!positivePhrases.length) return;  // 没内容时不能折叠 / 展开

      positiveCollapsed = !positiveCollapsed;
      positivePromptContainer.style('display', positiveCollapsed ? 'none' : 'block');
      positiveToggle.text(positiveCollapsed ? '▸' : '▾');
    })
    // ⭐ 标题右键：只用于“新增一行”
    .on('contextmenu', (ev) => {
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
        .style('min-width', '180px');

      const addMenuItem = (label, onClick) => {
        menu.append('xhtml:div')
          .style('padding', '4px 12px')
          .style('cursor', 'pointer')
          .style('font-size', '12px')
          .style('color', '#374151')
          .on('mouseenter', function () { d3.select(this).style('background', '#f3f4f6') })
          .on('mouseleave', function () { d3.select(this).style('background', 'transparent') })
          .text(label)
          .on('click', () => {
            onClick();
            menu.remove();
          });
      };

      addMenuItem('Add positive phrase', () => {
        // 标题右键新增：在“标题下面”插入一行 => 插到数组最前面
        positivePhrases.unshift({ text: '', weight: 1.0 });
        syncPositiveParamsAndRender();
      });

      const closeMenu = () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      };
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    });

  const positiveToggle = positiveHeader.append('xhtml:span')
    .attr('class', 'prompt-toggle-icon')
    .text('▾');

  positiveHeader.append('xhtml:span')
    .attr('class', 'prompt-section-title')
    .text('Positive Prompt');

  const positiveCountSpan = positiveHeader.append('xhtml:span')
    .attr('class', 'prompt-count')
    .text('(0)');

  const positivePromptContainer = positiveSection.append('xhtml:div')
    .attr('class', 'prompt-section-body');

  const updatePositiveCount = () => {
    positiveCountSpan.text(`(${positivePhrases.length})`);

    if (!positivePhrases.length) {
      positiveCollapsed = true;
      positivePromptContainer.style('display', 'none');
      positiveToggle.text('▸')
        .style('color', '#d1d5db')
        .style('cursor', 'default');
    } else {
      positiveToggle
        .style('color', '#9ca3af')
        .style('cursor', 'pointer');
      positiveCollapsed = false;
      positivePromptContainer.style('display', 'block');
      positiveToggle.text('▾');
    }
  };

    // 只同步参数，但不重绘 DOM（编辑时用）
  const syncPositiveParams = () => {
    const updatedPrompt = positivePhrases
      .filter(p => p.text.trim())
      .map(p => `${p.text.trim()}:${p.weight.toFixed(1)}`)
      .join(', ');

    params.positive_prompt = updatedPrompt;
    emit('update-node-parameters', d.id, { ...params });
  };

  // 结构变化（新增 / 删除）时再重绘
  const syncPositiveParamsAndRender = () => {
    syncPositiveParams();
    updatePositiveCount();
    renderPositivePhraseRows();
  };


  const renderPositivePhraseRows = () => {
    positivePromptContainer.selectAll('*').remove();

    if (!positivePhrases.length) {
      updatePositiveCount();
      return;
    }

    updatePositiveCount();

    positivePhrases.forEach((phrase, idx) => {
      const row = positivePromptContainer.append('xhtml:div')
        .attr('class', 'phrase-row');

      // ⭐ phrase 行右键：新增（当前行下面）+ 删除
      row.on('contextmenu', (ev) => {
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
          .style('min-width', '180px');

        const addMenuItem = (label, onClick) => {
          menu.append('xhtml:div')
            .style('padding', '4px 12px')
            .style('cursor', 'pointer')
            .style('font-size', '12px')
            .style('color', '#374151')
            .on('mouseenter', function () { d3.select(this).style('background', '#f3f4f6') })
            .on('mouseleave', function () { d3.select(this).style('background', 'transparent') })
            .text(label)
            .on('click', () => {
              onClick();
              menu.remove();
            });
        };

        addMenuItem('Add positive phrase below', () => {
          positivePhrases.splice(idx + 1, 0, { text: '', weight: 1.0 });
          syncPositiveParamsAndRender();
        });

        addMenuItem('Delete this positive phrase', () => {
          positivePhrases.splice(idx, 1);   // 可以删到 0 行
          syncPositiveParamsAndRender();
        });

        const closeMenu = () => {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
      });

      row.append('xhtml:input')
        .attr('class', 'phrase-input')
        .attr('type', 'text')
        .attr('value', phrase.text)
        .on('mousedown', ev => ev.stopPropagation())
        .on('input', function () {
          positivePhrases[idx].text = this.value;
          // 仅同步参数，不重渲染，避免光标丢失
          syncPositiveParams();
        });

      row.append('xhtml:input')
        .attr('class', 'weight-input')
        .attr('type', 'number')
        .attr('min', '0.0')
        .attr('max', '1.9')
        .attr('step', '0.1')
        .attr('value', phrase.weight.toFixed(1))
        .on('mousedown', ev => ev.stopPropagation())
        .on('input', function () {
          let val = parseFloat(this.value);
          if (isNaN(val)) val = 1.0;
          val = Math.min(1.9, Math.max(0.0, val));
          this.value = val.toFixed(1);
          positivePhrases[idx].weight = val;
          // 同上，只同步参数
          syncPositiveParams();
        });

    });
  };

  // 初次渲染
  renderPositivePhraseRows();


  /* ---------- Negative Prompt ---------- */
  const negativeSection = left.append('xhtml:div')
    .attr('class', 'input-section');

  let negativePhrases = parsePrompt(params.negative_prompt || '');
  let negativeCollapsed = false;

  const negativeHeader = negativeSection.append('xhtml:div')
    .attr('class', 'prompt-section-header')
    .on('mousedown', ev => ev.stopPropagation())
    .on('click', ev => {
      ev.stopPropagation();
      if (!negativePhrases.length) return;

      negativeCollapsed = !negativeCollapsed;
      negativePromptContainer.style('display', negativeCollapsed ? 'none' : 'block');
      negativeToggle.text(negativeCollapsed ? '▸' : '▾');
    })
    // ⭐ 标题右键：只“新增 negative phrase”
    .on('contextmenu', (ev) => {
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
        .style('min-width', '190px');

      const addMenuItem = (label, onClick) => {
        menu.append('xhtml:div')
          .style('padding', '4px 12px')
          .style('cursor', 'pointer')
          .style('font-size', '12px')
          .style('color', '#374151')
          .on('mouseenter', function () { d3.select(this).style('background', '#f3f4f6') })
          .on('mouseleave', function () { d3.select(this).style('background', 'transparent') })
          .text(label)
          .on('click', () => {
            onClick();
            menu.remove();
          });
      };

      addMenuItem('Add negative phrase', () => {
        negativePhrases.unshift({ text: '', weight: 1.0 });
        syncNegativeParamsAndRender();
      });

      const closeMenu = () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      };
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    });

  const negativeToggle = negativeHeader.append('xhtml:span')
    .attr('class', 'prompt-toggle-icon')
    .text('▾');

  negativeHeader.append('xhtml:span')
    .attr('class', 'prompt-section-title')
    .text('Negative Prompt');

  const negativeCountSpan = negativeHeader.append('xhtml:span')
    .attr('class', 'prompt-count')
    .text('(0)');

  const negativePromptContainer = negativeSection.append('xhtml:div')
    .attr('class', 'prompt-section-body');

  const updateNegativeCount = () => {
    negativeCountSpan.text(`(${negativePhrases.length})`);

    if (!negativePhrases.length) {
      negativeCollapsed = true;
      negativePromptContainer.style('display', 'none');
      negativeToggle.text('▸')
        .style('color', '#d1d5db')
        .style('cursor', 'default');
    } else {
      negativeToggle
        .style('color', '#9ca3af')
        .style('cursor', 'pointer');
      negativeCollapsed = false;
      negativePromptContainer.style('display', 'block');
      negativeToggle.text('▾');
    }
  };

  const syncNegativeParams = () => {
    const updatedPrompt = negativePhrases
      .filter(p => p.text.trim())
      .map(p => `${p.text.trim()}:${p.weight.toFixed(1)}`)
      .join(', ');

    params.negative_prompt = updatedPrompt;
    emit('update-node-parameters', d.id, { ...params });
  };

  const syncNegativeParamsAndRender = () => {
    syncNegativeParams();
    updateNegativeCount();
    renderNegativePhraseRows();
  };


  const renderNegativePhraseRows = () => {
    negativePromptContainer.selectAll('*').remove();

    if (!negativePhrases.length) {
      updateNegativeCount();
      return;
    }

    updateNegativeCount();

    negativePhrases.forEach((phrase, idx) => {
      const row = negativePromptContainer.append('xhtml:div')
        .attr('class', 'phrase-row');

      // ⭐ phrase 行右键：新增 / 删除
      row.on('contextmenu', (ev) => {
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
          .style('min-width', '190px');

        const addMenuItem = (label, onClick) => {
          menu.append('xhtml:div')
            .style('padding', '4px 12px')
            .style('cursor', 'pointer')
            .style('font-size', '12px')
            .style('color', '#374151')
            .on('mouseenter', function () { d3.select(this).style('background', '#f3f4f6') })
            .on('mouseleave', function () { d3.select(this).style('background', 'transparent') })
            .text(label)
            .on('click', () => {
              onClick();
              menu.remove();
            });
        };

        addMenuItem('Add negative phrase below', () => {
          negativePhrases.splice(idx + 1, 0, { text: '', weight: 1.0 });
          syncNegativeParamsAndRender();
        });

        addMenuItem('Delete this negative phrase', () => {
          negativePhrases.splice(idx, 1);
          syncNegativeParamsAndRender();
        });

        const closeMenu = () => {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
      });

      row.append('xhtml:input')
        .attr('class', 'phrase-input')
        .attr('type', 'text')
        .attr('value', phrase.text)
        .on('mousedown', ev => ev.stopPropagation())
        .on('input', function () {
          negativePhrases[idx].text = this.value;
          syncNegativeParams();
        });

      row.append('xhtml:input')
        .attr('class', 'weight-input')
        .attr('type', 'number')
        .attr('min', '0.0')
        .attr('max', '1.9')
        .attr('step', '0.1')
        .attr('value', phrase.weight.toFixed(1))
        .on('mousedown', ev => ev.stopPropagation())
        .on('input', function () {
          let val = parseFloat(this.value);
          if (isNaN(val)) val = 1.0;
          val = Math.min(1.9, Math.max(0.0, val));
          this.value = val.toFixed(1);
          negativePhrases[idx].weight = val;
          syncNegativeParams();
        });
    });
  };

  renderNegativePhraseRows();


  /* ---------- Input Images ---------- */
  const inputImages = (d.assets && d.assets.input && d.assets.input.images) || [];
  const imageSection = left.append('xhtml:div')
    .attr('class', 'input-section');

  const hasImages = inputImages.length > 0;
  let imagesCollapsed = false;
  let grid = null;

  const imageHeader = imageSection.append('xhtml:div')
    .attr('class', 'prompt-section-header')
    .on('mousedown', ev => ev.stopPropagation())
    .on('click', ev => {
      ev.stopPropagation();
      if (!hasImages || !grid) return;
      imagesCollapsed = !imagesCollapsed;
      grid.style('display', imagesCollapsed ? 'none' : 'flex');
      imageToggle.text(imagesCollapsed ? '▸' : '▾');
    });

  const imageToggle = imageHeader.append('xhtml:span')
    .attr('class', 'prompt-toggle-icon')
    .text(hasImages ? '▾' : '▸')
    .style('color', hasImages ? '#4b5563' : '#d1d5db')
    .style('cursor', hasImages ? 'pointer' : 'default');

  imageHeader.append('xhtml:span')
    .attr('class', 'prompt-section-title')
    .text('Images');

  imageHeader.append('xhtml:span')
    .attr('class', 'prompt-count')
    .text(`(${inputImages.length})`);

  if (hasImages) {
    const shownImages = inputImages.slice(0, 2);
    const imgCount = shownImages.length;

    grid = imageSection.append('xhtml:div')
      .attr('class', 'input-images-grid')
      .style('display', 'flex')
      .style('flex-wrap', 'nowrap')
      .style('gap', '4px')
      .style('width', '100%')
      .style('margin-top', '2px');

    shownImages.forEach((url, idx) => {
      const thumbWrapper = grid.append('xhtml:div')
        .attr('class', 'input-image-thumb')
        // ⭐ 单张图：铺满整行；两张图：各占一半
        .style('flex', imgCount === 1 ? '1 1 100%' : '1 1 0')
        .style('min-width', imgCount === 1 ? '0' : '50%')
        .style('height', '56px')       // 高度你可以按需要调，比如 56 / 60
        .style('border-radius', '4px')
        .style('overflow', 'hidden')
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation();
          emit('open-preview', url, 'image');
        });

      thumbWrapper.append('xhtml:img')
        .attr('src', url)
        .attr('alt', 'Input image')
        // ⭐ 关键：让图片填满父容器宽度，保持比例裁剪
        .style('width', '100%')
        .style('height', '100%')
        .style('object-fit', 'cover')
        .style('display', 'block');
    });
  }


  /* ---------- Parameters ---------- */
  if (paramPairs.length) {
    const paramSection = left.append('xhtml:div')
      .attr('class', 'input-section');

    // 折叠头部：小三角 + 标题
    const header = paramSection.append('xhtml:div')
      .attr('class', 'input-params-header');

    const toggleIcon = header.append('xhtml:span')
      .attr('class', 'input-params-toggle-icon')
      .text('▾');  // 初始展开

    header.append('xhtml:span')
      .attr('class', 'input-params-title-text')
      .text('Parameters');

    // 折叠 body
    const body = paramSection.append('xhtml:div')
      .attr('class', 'input-params-body');

    const grid = body.append('xhtml:div')
      .attr('class', 'input-params-grid');

    paramPairs.forEach(([key, val]) => {
      const isNum = typeof val === 'number';
      
      // 1. 新增：参数名简写映射表（核心修改）
      const paramAliasMap = {
        'low_threshold': 'L-Thresh',    // 简写：低阈值
        'high_threshold': 'H-Thresh',  // 简写：高阈值
        'batch_size': 'batch'             // 保留你原有的 batch_size 简写
      };
      
      // 2. 优先用映射表的简写，没有则按原逻辑处理（下划线转空格）
      const labelName = paramAliasMap[key] || key.replace(/_/g, ' ');

      const field = grid.append('xhtml:div')
        .attr('class', 'input-param-field');

      field.append('xhtml:div')
        .attr('class', 'input-param-label')
        .text(labelName);

      const input = field.append('xhtml:input')
        .attr('class', 'input-param-input node-input')
        .attr('data-key', key)  // 核心：保留原始key，不影响参数提交逻辑
        .attr('type', isNum ? 'number' : 'text')
        .attr('value', val);

      // 可选优化：给 threshold 这类小数参数加步长（体验更好）
      if (isNum && (key === 'low_threshold' || key === 'high_threshold'|| key === 'position')) {
        input.attr('step', '0.01')  // 步长0.1，适配0.1/0.8这类值
            .attr('min', '0.0')
            .attr('max', '1.0'); // 阈值通常0-1之间，可按需调整
      }

      input.on('mousedown', ev => ev.stopPropagation());
    });

    // 点击 header 折叠 / 展开
    let paramsCollapsed = false;
    header.on('click', () => {
      paramsCollapsed = !paramsCollapsed;
      body.style('display', paramsCollapsed ? 'none' : 'block');
      toggleIcon.text(paramsCollapsed ? '▸' : '▾');
    });
  }


 /* ==================== 右侧 Output 列 ==================== */
  /* ==================== 右侧 Output 列 ==================== */
  const right = body.append('xhtml:div')
    .attr('class', 'thin-scroll')
    .style('flex', '1 1 0')
    .style('min-width', '0')
    .style('padding', '2px 4px')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('align-items', 'stretch')
    .style('justify-content', 'flex-start')
    .style('position', 'relative')
    .style('overflow-y', 'auto')
    .style('max-height', '100%');

  // Output 头部 + 五角星按钮（样式跟左侧 Input 一致）
  const outputHeader = right.append('xhtml:div')
    .attr('class', 'io-header');

  outputHeader.append('xhtml:span')
    .attr('class', 'io-title')
    .text('Output');

  if (canAddToStitch) {
    outputHeader.append('xhtml:div')
      .attr('class', 'icon-circle-btn')
      .text('↗')
      .attr('title', 'Add to storyboard')
      .on('mousedown', ev => ev.stopPropagation())
            .on('click', ev => {
        ev.stopPropagation();

        // 如果有多选：把所有选中的 media 丢进 buffer
        if (selectedMediaUrls.size > 0) {
          selectedMediaUrls.forEach(url => {
            const isVideoMedia = videoUrls.includes(url);
            const mediaType = isVideoMedia ? 'video' : 'image';
            emit('add-clip', d, url, mediaType);
            console.log('[multi] add clip:', url, mediaType);
          });
          return;
        }

        // 如果没有任何选中，则 fallback：优先视频，否则第一张图片
        const fallbackUrl = isVideo ? (videoUrls[0] || imageUrls[0]) : (imageUrls[0] || videoUrls[0]);
        if (!fallbackUrl) return;

        const fallbackType = videoUrls.includes(fallbackUrl) ? 'video' : 'image';
        emit('add-clip', d, fallbackUrl, fallbackType);
        console.log('[fallback] add clip:', fallbackUrl, fallbackType);
      })

      .on('mouseenter', function () {
        d3.select(this).style('color', '#2563eb');
      })
      .on('mouseleave', function () {
        d3.select(this).style('color', '#6b7280');
      });
  }

  // 标题下方虚线
  right.append('xhtml:div')
    .attr('class', 'io-divider');

  // 视频预览
  if (videoUrls.length > 0) {
    const videoContainer = right.append('xhtml:div')
      .style('width', '100%')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '4px')
      .style('margin-top', '4px');

    videoUrls.forEach((url, index) => {
      const wrapper = videoContainer.append('xhtml:div')
        .attr('class', 'media-wrapper') // 新增类名，提升样式优先级
        .attr('data-url', url)
        .style('position', 'relative')
        .style('width', '100%')
        .style('height', '72px')          
        .style('border-radius', '4px')
        .style('overflow', 'hidden')
        .style('pointer-events', 'auto')
        .style('box-sizing', 'border-box')       // ⭐ 确保边框不改变整体宽度
        .style('border', '2px solid transparent')// ⭐ 初始就预留 2px 边框空间
        .on('click', function (ev) {
          ev.stopPropagation();
          ev.preventDefault();

          // 记录“最后一次点击”的 url（做 fallback 用）
          selectedMediaUrl = url;

          // ⭐ 多选：toggle 这个 URL 是否在 Set 里
          if (selectedMediaUrls.has(url)) {
            selectedMediaUrls.delete(url);
          } else {
            selectedMediaUrls.add(url);
          }

          // 用统一函数，根据 selectedMediaUrls 更新所有 video 缩略图的边框 + 星标
          updateMediaSelectionStyles(videoContainer, mediaVideoColor);

          console.log('当前选中视频集合:', Array.from(selectedMediaUrls));
        })

        .on('dblclick', ev => {
          ev.stopPropagation();
          ev.preventDefault();
          emit('open-preview', url, 'video');
        });


      const v = wrapper.append('xhtml:video')
        .style('width', '100%')
        .style('height', '100%')
        .style('object-fit', 'cover')
        .style('pointer-events', 'none')
        .attr('muted', true)
        .attr('playsinline', true)
        .attr('preload', 'metadata');

      const el = v.node();
      el.autoplay = true;
      el.loop = true;
      el.muted = true;
      el.playsInline = true;
      el.src = url;

      // ⭐ 右上角五角星标记
      wrapper.append('xhtml:div')
        .attr('class', 'media-select-badge')
        .text('★')
        .style('position', 'absolute')
        .style('top', '4px')
        .style('right', '4px')
        .style('font-size', '11px')
        .style('line-height', '1')
        .style('padding', '2px 4px')
        .style('border-radius', '999px')
        .style('background', 'rgba(17,24,39,0.55)')
        .style('color', '#e5e7eb')
        .style('opacity', '0.25')   // 默认比较淡
        .style('pointer-events', 'none'); // 避免挡住点击

      // if (index === 0) {
      //   selectedMediaUrl = url;
      // }
    });
  }

  // 图片预览
  if (imageUrls.length > 0) {
    const imgContainer = right.append('xhtml:div')
      .style('width', '100%')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '4px')
      .style('margin-top', videoUrls.length ? '4px' : '4px');

    imageUrls.forEach((url, index) => {
      const wrapper = imgContainer.append('xhtml:div')
        .attr('class', 'media-wrapper') // 新增类名
        .attr('data-url', url)
        .style('position', 'relative') 
        .style('width', '100%')
        .style('height', '72px')          
        .style('border-radius', '4px')
        .style('overflow', 'hidden')
        .style('pointer-events', 'auto')
        .style('box-sizing', 'border-box')            // ⭐
        .style('border', '2px solid transparent')     // ⭐
        .on('click', function (ev) {
          ev.stopPropagation();
          ev.preventDefault();

          selectedMediaUrl = url;

          if (selectedMediaUrls.has(url)) {
            selectedMediaUrls.delete(url);
          } else {
            selectedMediaUrls.add(url);
          }

          updateMediaSelectionStyles(imgContainer, mediaImageColor);

          console.log('当前选中图片集合:', Array.from(selectedMediaUrls));
        })

        .on('dblclick', ev => {
          ev.stopPropagation();
          ev.preventDefault();
          emit('open-preview', url, 'image');
        });

      wrapper.append('xhtml:img')
        .attr('src', url)
        .attr('alt', `Output image ${index + 1}`)
        .style('width', '100%')
        .style('height', '100%')
        .style('object-fit', 'cover')
        .style('display', 'block')
        .style('pointer-events', 'none');

      // ⭐ 右上角五角星
      wrapper.append('xhtml:div')
        .attr('class', 'media-select-badge')
        .text('★')
        .style('position', 'absolute')
        .style('top', '4px')
        .style('right', '4px')
        .style('font-size', '11px')
        .style('line-height', '1')
        .style('padding', '2px 4px')
        .style('border-radius', '999px')
        .style('background', 'rgba(17,24,39,0.55)')
        .style('color', '#e5e7eb')
        .style('opacity', '0.25')
        .style('pointer-events', 'none');
    });
  }

    function updateMediaSelectionStyles(container, color) {
    container.selectAll('.media-wrapper').each(function () {
      const wrapper = d3.select(this);
      const url = wrapper.attr('data-url');
      const badge = wrapper.select('.media-select-badge');

      if (!url) return;

      if (selectedMediaUrls.has(url)) {
        // ✅ 选中：边框 + 星星用对应模态颜色
        wrapper
          .classed('media-selected', true)
          .style('border-color', color);

        badge
          .style('opacity', '1')
          .style('background', color)
          .style('color', '#ffffff');
      } else {
        // 未选中：恢复默认
        wrapper
          .classed('media-selected', false)
          .style('border-color', 'transparent');

        badge
          .style('opacity', '0.25')
          .style('background', 'rgba(17,24,39,0.55)')
          .style('color', '#e5e7eb');
      }
    });
  }


  /* ==================== 右下角拖拽：只改变节点高度 ==================== */
  const resizeHandle = card.append('xhtml:div')
    .attr('class', 'node-resize-handle')
    .on('mousedown', (event) => {
      event.stopPropagation();
      event.preventDefault();

      const startY = event.clientY;
      const startHeight = d.calculatedHeight || parseFloat(fo.attr('height')) || 180;

      d3.select('body').classed('node-card-resizing', true);

      d3.select(window)
        .on('mousemove.node-resize', (ev) => {
          const dy = ev.clientY - startY;
          const minHeight = 140;      // 给一个最小高度，防止太扁
          const maxHeight = 480;      // 可以自行调大/调小
          const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + dy));

          d.calculatedHeight = newHeight;

          // 更新 foreignObject 高度 & 垂直居中
          fo
            .attr('height', newHeight)
            .attr('y', -newHeight / 2);

          // 通知外层（如果你想把高度持久化）
          if (emit) {
            emit('resize-node-height', d.id, newHeight);
          }
        })
        .on('mouseup.node-resize', () => {
          d3.select(window).on('.node-resize', null);
          d3.select('body').classed('node-card-resizing', false);
        });
    });

  addTooltip(gEl, d);
}

// Workflow Planning 辅助节点（AddWorkflow）：
// 上：Fine-tune operation 文字细化；下：Input Images 图片参考
function renderAddWorkflowNode(gEl, d, selectedIds, emit) {
  const fo = gEl.append('foreignObject')
    .attr('width', d.calculatedWidth)
    .attr('height', d.calculatedHeight)
    .attr('x', -d.calculatedWidth / 2)
    .attr('y', -d.calculatedHeight / 2)
    .style('overflow', 'visible')

  const card = fo.append('xhtml:div')
    .attr('class', 'node-card node-card-resizable')
    .attr('data-node-category', getNodeCategory(d))
    .style('width', '100%')
    .style('height', '100%')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('border-width', '2px')
    .style('border-radius', '8px')
    .style('border-color', getNodeBorderColor(d))
    .style('position', 'relative')
    .style('cursor', 'pointer')
    .style('background-color', '#ffffff')
    .style('user-select', 'none')
    .style('-webkit-user-select', 'none')

  setCardSelected(card, d, selectedIds.includes(d.id))

  card.on('click', ev => {
    if (ev.target && ev.target.closest && ev.target.closest('button, img, video')) return
    ev.stopPropagation()
    const selected = new Set(selectedIds)
    const on = selected.has(d.id)
    if (on) selected.delete(d.id)
    else if (selected.size < 2) selected.add(d.id)
    setCardSelected(card, d, !on)
    emit('update:selectedIds', Array.from(selected))
  })

  card.on('mouseenter', () =>
    card.selectAll('.add-clip-btn, .dots-container').style('opacity', '1')
  ).on('mouseleave', () =>
    card.selectAll('.add-clip-btn, .dots-container').style('opacity', '0')
  )

  // 顶部标题（节点名 + 折叠/复制/删除）
  buildHeader(card, d)
  addRightClickMenu(card, d, emit)

  const body = card.append('xhtml:div')
    .style('flex', '1 1 auto')
    .style('min-height', '0')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('padding', '4px 6px')
    .style('gap', '4px')

  // ========= 上半部分：Fine-tune operation =========
  const opSection = body.append('xhtml:div')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('gap', '2px')

  const opHeader = opSection.append('xhtml:div')
    .attr('class', 'io-header')
    .style('align-items', 'center')

  opHeader.append('xhtml:span')
    .attr('class', 'io-label')
    .text('Fine-tune operation')

  // 右侧小 A 按钮：调用 Agent 选择工作流
  const opAgentBtn = opHeader.append('xhtml:button')
    .text('A')
    .attr('class', 'icon-circle-btn')
    .attr('title','agent button')
    .on('mousedown', ev => ev.stopPropagation())
    .on('mouseenter', function () {
      d3.select(this)
        .style('background', '#6b7280')
        .style('color', '#ffffff')
        .style('border-color', '#4b5563')
    })
    .on('mouseleave', function () {
      d3.select(this)
        .style('background', '#ffffff')
        .style('color', '#6b7280')
        .style('border-color', '#e5e7eb')
    })

  const opText = d.parameters?.text ||
    d.parameters?.positive_prompt ||
    d.parameters?.global_context ||
    ''
  const hasMedia = !!(d.assets && d.assets.input && d.assets.input.images && d.assets.input.images.length > 0)
  const mediaUrl = hasMedia ? d.assets.input.images : ''
  const opTextArea = opSection.append('xhtml:textarea')
    .attr('class', 'thin-scroll')
    .style('flex', '1 1 auto')
    // .style('width', '100%')
    .style('min-height', '48px')
    .style('padding', '4px 6px')
    .style('font-size', '10px')
    .style('color', '#374151')
    .style('background-color', '#f9fafb')
    .style('border', '1px solid #e5e7eb')
    .style('border-radius', '6px')
    .style('resize', 'none')
    .style('outline', 'none')
    .style('font-family', 'inherit')
    .attr('placeholder', 'Refine the operation details for this workflow...')
    .property('value', opText)
    .on('mousedown', ev => ev.stopPropagation())

  opTextArea.on('blur', function () {
    const val = d3.select(this).property('value') || ''
    if (!d.parameters) d.parameters = {}
    d.parameters.text = val
    d.parameters.positive_prompt = val
    emit('update-node-parameters', d.id, d.parameters)
  })

  // Agent 按钮点击：调用后端 /api/agents/process
  opAgentBtn.on('click', ev => {
    ev.stopPropagation()
    clearPrevAgentContext();
    const payload = {
      user_input: opTextArea.property('value') || '',
      node_id: d.id,
      image_url: mediaUrl || '',
      workflow_context: {
        current_workflow: d.module_id,
        parent_nodes: d.originalParents || []
      }
    }

    fetch('/api/agents/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        console.log('Agent处理结果 (Workflow Planning):', data)
        const agentContext = {
            global_context: data.global_context || '',
            intent: data.intent || '',
            selected_workflow: data.selected_workflow || '',
            knowledge_context: data.knowledge_context || '',
            image_caption: data.image_caption || '',
            style: data.style || ''
          };
          // 存储到共享工具中（关键步骤）
          setPrevAgentContext(agentContext);

        const rawWorkflowId = data.selected_workflow || ''
        const workflowId = rawWorkflowId.replace('.json', '')
        const workflow_title = data.workflow_title

        import('@/lib/useWorkflowForm.js').then(({ workflowParameters }) => {
          if (!workflowParameters) {
            console.error('workflowParameters 未正确导入')
            return
          }

          const paramDefinitions = workflowParameters[workflowId] || []
          console.log(`paramDefinitions`,paramDefinitions)
          const defaultParams = paramDefinitions.reduce((obj, param) => {
            obj[param.id] = param.defaultValue
            return obj
          }, {})

          const updatedParams = {
            ...defaultParams,
            positive_prompt: data.message?.positive || defaultParams.positive_prompt || '',
            negative_prompt: data.message?.negative || defaultParams.negative_prompt || '',
            text:data.message?.text || ''
          }

          d.parameters = updatedParams
          console.log(`add workflow agent`,d.parameters)
          emit('refresh-node', d.id, workflowId, d.parameters, workflow_title)
        })
      })
      .catch(err => console.error('调用Agent失败:', err))
  })

  // ========= 下半部分：Input Images =========
  const imgSection = body.append('xhtml:div')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('gap', '2px')

  const imgHeader = imgSection.append('xhtml:div')
    .attr('class', 'io-header')
    .style('align-items', 'center')

  imgHeader.append('xhtml:span')
    .attr('class', 'io-label')
    .text('Input Images')

  // 右侧黄色小圆点 + 号按钮
  const addImgBtn = imgHeader.append('xhtml:button')
    .text('+')
    .attr('class', 'icon-circle-btn')
    .attr('title','add image')
    .on('mousedown', ev => ev.stopPropagation())

  // 预览区域：固定高度，水平滚动
  const previewRow = imgSection.append('xhtml:div')
    .style('flex', '0 0 auto')
    .style('height', '54px')
    .style('border-radius', '6px')
    .style('background', '#f9fafb')
    .style('border', '1px dashed #e5e7eb')
    .style('padding', '4px')
    .style('display', 'flex')
    .style('align-items', 'center')
    .style('gap', '4px')
    .style('overflow-x', 'auto')

  let previewImages = (d.assets && d.assets.input && d.assets.input.images)
    ? [...d.assets.input.images]
    : []

  const renderPreview = () => {
    previewRow.selectAll('*').remove()

    if (!previewImages.length) {
      previewRow.append('xhtml:div')
        .style('font-size', '10px')
        .style('color', '#9ca3af')
        .text('Click + to upload reference images for this plan.')
      return
    }

    previewImages.forEach(url => {
      const wrapper = previewRow.append('xhtml:div')
        .style('flex', '0 0 auto')
        .style('height', '100%')
        .style('border-radius', '4px')
        .style('overflow', 'hidden')
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation()
          emit('open-preview', url, 'image')
        })

      wrapper.append('xhtml:img')
        .attr('src', url)
        .attr('alt', 'Input image')
        .style('height', '100%')
        .style('width', 'auto')
        .style('object-fit', 'cover')
        .style('display', 'block')
    })
  }

  renderPreview()

  // 隐藏的 file input
  const hiddenInput = imgSection.append('xhtml:input')
    .attr('type', 'file')
    .attr('accept', 'image/*')
    .attr('multiple', true)
    .style('display', 'none')
    .on('change', function () {
      const files = Array.from(this.files || [])
      if (!files.length) return

      files.forEach(file => {
        const url = URL.createObjectURL(file)
        previewImages.push(url)
      })
      console.log(`file:`,files,d.id)

      emit('upload-media', d.id, files)
      renderPreview()

      this.value = ''
    })

  addImgBtn.on('click', ev => {
    ev.stopPropagation()
    const inp = hiddenInput.node()
    if (inp) inp.click()
  })

  addTooltip(gEl, d)
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

        addMenuItem('Add Intent Draft', () => {
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

    if (cardType === 'textFull') {
      console.log(`renderTree textFull`)
      renderTextFullNode(gEl, d, selectedIds, emit)
    } else if (cardType === 'audio' || isAudioMedia) {
      renderAudioNode(gEl, d, selectedIds, emit, workflowTypes)
    } else if (cardType == 'TextImage'){
      console.log(`render TextImage`)
      renderTextImageNode(gEl, d, selectedIds, emit)
    } else if (cardType == 'AddWorkflow'){
      renderAddWorkflowNode(gEl, d, selectedIds, emit)
    }else {
      renderIONode(gEl, d, selectedIds, emit, workflowTypes)
    }
  })
}
