// src/lib/workflowGraph.js
import * as d3 from 'd3'
import * as dagre from 'dagre'
import WaveSurfer from 'wavesurfer.js'

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


// selection shadow color is same as category color, but used in box-shadow
function getNodeCategory(node) {
  const hasMedia = !!(node.media && node.media.rawPath)
  const rawPath = hasMedia ? node.media.rawPath : ''
  const mediaType = node.media && node.media.type

  const isAudioMedia =
    typeof rawPath === 'string' &&
    (rawPath.includes('.mp3') || rawPath.includes('.wav') || rawPath.includes('subfolder=audio') || mediaType === 'audio')

  const isVideoMedia =
    typeof rawPath === 'string' &&
    (rawPath.includes('.mp4') || rawPath.includes('subfolder=video') || mediaType === 'video')

  const isImageMedia = hasMedia && !isAudioMedia && !isVideoMedia

  if (isAudioMedia) return 'audio'
  if (isImageMedia) return 'image'
  if (isVideoMedia) return 'video'
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
  return '#CBD5E1' // helper 节点继续用灰色；要极端也可以以后挪到 CSS 变量
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
    if (n.originalParents) {
      n.originalParents.forEach(parentId => {
        const p = nodeMap.get(parentId)
        if (p) p.children.push(n)
      })
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
    if (n.originalParents) {
      n.originalParents.forEach(p => {
        if (visibleIds.has(p)) visibleLinks.push({ source: p, target: n.id })
      })
    }
  })

  return { visibleNodes, visibleLinks }
}

/** 粗略推断当前“卡片类型” */
function inferCardType(node) {
  const hasMedia = !!(node.media && node.media.rawPath)
  const promptText = (node.parameters) ? (node.parameters.positive_prompt || node.parameters.text) : null
  const hasPrompt = typeof promptText === 'string' && promptText.trim() !== ''

  const rawPath = hasMedia ? node.media.rawPath : ''
  const isAudioMedia = typeof rawPath === 'string' &&
    (rawPath.includes('.mp3') || rawPath.includes('.wav') || rawPath.includes('subfolder=audio'))

  if (node.module_id === 'Init') return 'init'
  if (node.module_id === 'AddText') return 'textFull'
  if (node.module_id === 'TextToAudio' || isAudioMedia || (node.media && node.media.type === 'audio')) return 'audio'
  return 'io'
}

/** 仅更新“选中”样式（按类型着色阴影） */
export function updateSelectionStyles(svgElement, selectedIds) {
  d3.select(svgElement).selectAll('.node')
    .each(function (d) {
      if (!d || !d.id) return
      const card = d3.select(this).select('.node-card')
      if (card.empty()) return
      if (selectedIds.includes(d.id)) {
        const selColor = getSelectionColor(d)
        card.style('box-shadow', `0 0 0 2px ${selColor}`)
      } else {
        card.style('box-shadow', 'none')
      }
    })
}

/** 仅更新可见性（折叠/展开），不改变缩放与布局 */
export function updateVisibility(svgElement, allNodes) {
  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodes)
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id))
  const visibleLinkIds = new Set(visibleLinks.map(l => `${l.source}->${l.target}`))

  d3.select(svgElement)
    .selectAll('.node')
    .style('display', d => visibleNodeIds.has(d.id) ? null : 'none')
    .each(function (d) {
      const btn = d3.select(this).select('button.collapse-btn')
      if (btn.size()) {
        btn.text(d._collapsed ? '+' : '-')
          .style('color', d._collapsed ? '#E4080A' : '#9ca3af')
      }
    })

  d3.select(svgElement)
    .selectAll('.link')
    .style('display', d => visibleLinkIds.has(`${d.v}->${d.w}`) ? null : 'none')
}

/** 完整重绘（重新布局 & 初始缩放） */
export function renderTree(
  svgElement,
  allNodesData,
  selectedIds,
  emit,           // (eventName, ...args) => void
  workflowTypes   // 仍然用于右上角启动按钮的颜色
) {
  const wrapper = d3.select(svgElement)
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

  // Dagre 布局
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 120 })
  g.setDefaultEdgeLabel(() => ({}))

  const BASE_CARD_HEIGHT = 170
  const PROMPT_AREA_HEIGHT = 30

  visibleNodes.forEach(node => {
    const cardType = inferCardType(node)
    const isInit = cardType === 'init'

    const hasMedia = !!(node.media && node.media.rawPath)
    const promptText = (node.parameters) ? (node.parameters.positive_prompt || node.parameters.text) : null
    const hasPrompt = typeof promptText === 'string' && promptText.trim() !== ''

    const rawPath = hasMedia ? node.media.rawPath : ''
    const isAudioMedia = typeof rawPath === 'string' &&
      (rawPath.includes('.mp3') || rawPath.includes('.wav') || rawPath.includes('subfolder=audio'))

    let width, height

    if (isInit) {
      width = 60
      height = 60
    } else if (cardType === 'textFull') {
      width = 260
      height = 140
    } else if (cardType === 'audio' || isAudioMedia) {
      width = 280
      height = hasPrompt ? 150 : 110
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

  const layoutGroup = svg.append('g')
  const linkGroup = layoutGroup.append('g').attr('class', 'links')
  const nodeGroup = layoutGroup.append('g').attr('class', 'nodes')

  const zoom = d3.zoom()
    .scaleExtent([0.1, 2.5])
    .on('zoom', (ev) => layoutGroup.attr('transform', ev.transform))
    .filter((ev) => {
      const target = ev.target
      return !(target && target.closest && target.closest('foreignObject'))
    })
  svg.call(zoom)

  const graphWidth = g.graph().width || width
  const graphHeight = g.graph().height || height
  const s = Math.min(1, Math.min(width / graphWidth, height / graphHeight) * 0.9)
  const tx = (width - graphWidth * s) / 2
  const ty = (height - graphHeight * s) / 2
  svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(s))

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

    // ★ 按节点类型设置 header 背景色（来自 CSS 变量）
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

    const title = header.append('xhtml:div')
  .style('font-size', '10px')
  .style('font-weight', '600')
  .style('color', '#111827')
  .style('overflow', 'hidden')
  .style('text-overflow', 'ellipsis')
  .style('white-space', 'nowrap')
  .style('min-width', '0')
  .style('cursor', 'text')
  .text(d.displayName || d.module_id || '(Node)')

// ★ 双击标题进入编辑模式
title.on('dblclick', (ev) => {
  ev.stopPropagation()
  if (isEditingTitle) return
  isEditingTitle = true

  const currentLabel = d.displayName || d.module_id || '(Node)'

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

      const newText = commit && inputNode
        ? inputNode.value.trim()
        : currentLabel

      const finalLabel = newText || currentLabel
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

    // 折叠（- / +）
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

    // 复制（占位）
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

    // 删除
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
   * 通栏文本节点（原始意图 / 提示词）
   */
  function renderTextFullNode(gEl, d, selectedIds, emit) {
    const promptText = (d.parameters) ? (d.parameters.positive_prompt || d.parameters.text) : ''

    const fo = gEl.append('foreignObject')
      .attr('width', d.calculatedWidth)
      .attr('height', d.calculatedHeight)
      .attr('x', -d.calculatedWidth / 2)
      .attr('y', -d.calculatedHeight / 2)
      .style('overflow', 'visible')

    const card = fo.append('xhtml:div')
      .attr('class', 'node-card')
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

    if (selectedIds.includes(d.id)) {
      const selColor = getSelectionColor(d)
      card.style('box-shadow', `0 0 0 2px ${selColor}`)
    } else {
      card.style('box-shadow', 'none')
    }

    card.on('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('button')) return
      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      const selColor = getSelectionColor(d)
      card.style('box-shadow', on ? 'none' : `0 0 0 2px ${selColor}`)
      emit('update:selectedIds', Array.from(selected))
    })

    card.on('mouseenter', () => card.selectAll('.dots-container').style('opacity', '1'))
      .on('mouseleave', () => card.selectAll('.dots-container').style('opacity', '0'))

    buildHeader(card, d)

    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('flex-direction', 'column')

    const textArea = body.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('padding', '6px')
      .style('font-size', '10px')
      .style('color', '#374151')
      .style('white-space', 'pre-wrap')
      .style('word-break', 'break-all')
      .style('border-bottom', '1px dashed #e5e7eb')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')
      .on('mousedown', ev => ev.stopPropagation())

    textArea.append('xhtml:div')
      .style('opacity', promptText ? '0.7' : '0.4')
      .text(promptText || '(Prompt text placeholder)')

    /*const toolbar = body.append('xhtml:div')
      .style('flex-shrink', '0')
      .style('padding', '4px 6px')
      .style('display', 'flex')
      .style('justify-content', 'flex-end')
      .style('gap', '4px')

    // Collapse button
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
      .style('color', d._collapsed ? '#E4080A' : '#6b7280') // gray-500
      .style('cursor', 'pointer')
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
          .style('color', d._collapsed ? '#E4080A' : '#6b7280')
          .style('border-color', '#e5e7eb')
      })


    // Clone button
    const cloneBtn = toolbar.append('xhtml:button')
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
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', ev => {
        ev.stopPropagation()
        // TODO: clone node logic
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

    // Delete button
    const deleteBtn = toolbar.append('xhtml:button')
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

    addTooltip(gEl, d)*/
  }

  /**
   * 文本 + 音频节点（上下结构）
   */
  function renderAudioNode(gEl, d, selectedIds, emit, workflowTypes) {
    const mediaUrl = d.media.url
    const promptText = (d.parameters) ? (d.parameters.positive_prompt || d.parameters.text) : ''

    const fo = gEl.append('foreignObject')
      .attr('width', d.calculatedWidth)
      .attr('height', d.calculatedHeight)
      .attr('x', -d.calculatedWidth / 2)
      .attr('y', -d.calculatedHeight / 2)
      .style('overflow', 'visible')

    const card = fo.append('xhtml:div')
      .attr('class', 'node-card')
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

    if (selectedIds.includes(d.id)) {
      const selColor = getSelectionColor(d)
      card.style('box-shadow', `0 0 0 2px ${selColor}`)
    } else {
      card.style('box-shadow', 'none')
    }

    card.on('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('button')) return
      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      const selColor = getSelectionColor(d)
      card.style('box-shadow', on ? 'none' : `0 0 0 2px ${selColor}`)
      emit('update:selectedIds', Array.from(selected))
    })

    card.on('mouseenter', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '1'))
      .on('mouseleave', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '0'))

    buildHeader(card, d)

    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('padding', '4px 6px')
      .style('gap', '4px')

    if (promptText && promptText.trim() !== '') {
      body.append('xhtml:div')
        .style('font-size', '10px')
        .style('color', '#374151')
        .style('white-space', 'pre-wrap')
        .style('word-break', 'break-all')
        .style('max-height', '40px')
        .style('overflow', 'hidden')
        .style('user-select', 'none')
        .style('-webkit-user-select', 'none')
        .text(promptText)
        .on('mousedown', ev => ev.stopPropagation())
    }

    const audioRow = body.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('gap', '8px')
      .style('min-height', '0')

    const playBtn = audioRow.append('xhtml:button')
      .style('width', '32px')
      .style('height', '32px')
      .style('border', 'none')
      .style('background-color', NODE_COLORS.audio)
      .style('color', '#ffffff')
      .style('border-radius', '50%')
      .style('font-size', '16px')
      .style('line-height', '32px')
      .style('flex-shrink', '0')
      .style('cursor', 'pointer')
      .style('user-select', 'none')
      .html('▶')
      .on('mousedown', ev => ev.stopPropagation())

    const waveformWrapper = audioRow.append('xhtml:div')
      .style('flex-grow', '1')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('justify-content', 'center')
      .style('min-width', '0')

    const waveformDiv = waveformWrapper.append('xhtml:div')
      .style('width', '100%')
      .style('height', '20px')

    const timeDisplay = waveformWrapper.append('xhtml:div')
      .style('font-size', '10px')
      .style('color', '#6b7280')
      .text('0:00 / --:--')

    const wavesurfer = WaveSurfer.create({
      container: waveformDiv.node(),
      waveColor: '#9ca3af',
      progressColor: NODE_COLORS.audio,
      height: 20,
      barHeight: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      url: mediaUrl,
    })

    wavesurfer.on('ready', (duration) => {
      timeDisplay.text(`0:00 / ${formatTime(duration)}`)
    })

    wavesurfer.on('timeupdate', (currentTime) => {
      timeDisplay.text(`${formatTime(currentTime)} / ${formatTime(wavesurfer.getDuration())}`)
    })

    wavesurfer.on('finish', () => {
      playBtn.html('▶')
    })

    wavesurfer.on('error', (err) => {
      console.error('WaveSurfer error:', err)
      waveformDiv.html(`<span style="color:red; font-size:10px;">Audio error: ${err}</span>`)
    })

    playBtn.on('click', ev => {
      ev.stopPropagation()
      wavesurfer.playPause()
      if (wavesurfer.isPlaying()) {
        playBtn.html('⏸')
      } else {
        playBtn.html('▶')
      }
    })

    fo.on('remove', () => {
      wavesurfer.destroy()
    })

    const dots = card.append('xhtml:div')
      .attr('class', 'dots-container')
      .style('position', 'absolute')
      .style('top', '50px')
      .style('right', '4px')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('opacity', '0')
      .style('transition', 'opacity 0.15s ease-in-out')
      .style('z-index', '10')

    const buttonTypes = ['audio']
    buttonTypes.forEach((key, idx) => {
      const info = workflowTypes[key]
      if (!info) return
      dots.append('xhtml:button')
        .style('background-color', info.color)
        .style('width', '16px')
        .style('height', '16px')
        .style('border-radius', '50%')
        .style('border', 'none')
        .style('padding', '0')
        .style('cursor', 'pointer')
        .style('transition', 'transform 0.15s ease-in-out')
        .style('margin-top', idx > 0 ? '4px' : '0')
        .attr('title', `Start ${info.type} workflow`)
        .on('mouseenter', function () { d3.select(this).style('transform', 'scale(1.25)') })
        .on('mouseleave', function () { d3.select(this).style('transform', 'scale(1)') })
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation()
          emit('open-generation', d, info.defaultModuleId, info.type)
        })
    })

    const footer = card.append('xhtml:div')
      .style('display', 'flex')
      .style('justify-content', 'flex-end')
      .style('padding', '2px')

    footer.append('xhtml:button')
      .attr('class', 'add-clip-btn')
      .html('▶')
      .style('opacity', '0')
      .style('transition', 'opacity 0.15s ease-in-out')
      .style('width', '16px')
      .style('height', '16px')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('color', NODE_COLORS.audio)
      .style('font-size', '1.125rem')
      .style('border', 'none')
      .style('background-color', 'transparent')
      .style('padding', '0')
      .style('cursor', 'pointer')
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', ev => {
        ev.stopPropagation()
        emit('add-clip', d, 'audio')
      })

    addTooltip(gEl, d)
  }

  /**
   * 左右 IO 卡：左输入，右输出（图片 / 视频 / 文本）
   */
  function renderIONode(gEl, d, selectedIds, emit, workflowTypes) {
    const hasMedia = !!(d.media && d.media.rawPath)
    const mediaUrl = hasMedia ? d.media.url : ''
    const rawPath = hasMedia ? d.media.rawPath : ''
    const mediaType = d.media && d.media.type

    const isVideo =
      typeof rawPath === 'string' &&
      (rawPath.includes('.mp4') || rawPath.includes('subfolder=video') || mediaType === 'video')

    const isImage = hasMedia && !isVideo && mediaType !== 'audio'
    const canAddToStitch = hasMedia && (isImage || isVideo)

    const promptText = (d.parameters) ? (d.parameters.positive_prompt || d.parameters.text) : null
    const hasPrompt = typeof promptText === 'string' && promptText.trim() !== ''

    const fo = gEl.append('foreignObject')
      .attr('width', d.calculatedWidth)
      .attr('height', d.calculatedHeight)
      .attr('x', -d.calculatedWidth / 2)
      .attr('y', -d.calculatedHeight / 2)
      .style('overflow', 'visible')

    const card = fo.append('xhtml:div')
      .attr('class', 'node-card')
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

    if (selectedIds.includes(d.id)) {
      const selColor = getSelectionColor(d)
      card.style('box-shadow', `0 0 0 2px ${selColor}`)
    } else {
      card.style('box-shadow', 'none')
    }

    card.on('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('button, img, video')) return
      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      const selColor = getSelectionColor(d)
      card.style('box-shadow', on ? 'none' : `0 0 0 2px ${selColor}`)
      emit('update:selectedIds', Array.from(selected))
    })

    card.on('mouseenter', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '1'))
      .on('mouseleave', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '0'))

    buildHeader(card, d)

    card.append('xhtml:style').text(`
      .thin-scroll {
        overflow-y: overlay; /* 尝试覆盖模式，部分浏览器支持 */
        scrollbar-gutter: stable; /* 现代浏览器：预留空间防止跳动 */
      }
      /* 定义滚动条宽度 */
      .thin-scroll::-webkit-scrollbar {
        width: 3px; /* 极细 */
        height: 3px;
      }
      /* 轨道透明 */
      .thin-scroll::-webkit-scrollbar-track {
        background: transparent;
      }
      /* 滑块默认透明 (不可见) */
      .thin-scroll::-webkit-scrollbar-thumb {
        background: transparent;
        border-radius: 2px;
      }
      /* 只有当鼠标悬停在容器上时，滑块才变色 */
      .thin-scroll:hover::-webkit-scrollbar-thumb {
        background: #d1d5db; /* 浅灰色 */
      }
      .thin-scroll:hover::-webkit-scrollbar-thumb:hover {
        background: #9ca3af; /* 深一点的灰色 */
      }
    `)

    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('padding', '4px 4px')

    // --- 左侧主容器 ---
    const left = body.append('xhtml:div')
      .attr('class', 'thin-scroll nodrag') // 应用上面定义的 class
      .style('flex', '1 1 0')
      .style('min-width', '0')
      .style('padding', '2px 4px')
      .style('border-right', '1px solid #e5e7eb')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '6px')
      // 关键：这里不再通过 JS 切换 overflow，而是交给 CSS 处理
      // 这里的 overflow-y 最好设为 auto，让 CSS 的样式去控制显隐
      .style('overflow-y', 'auto') 

    // 【注意】删除了之前写的 card.on('mouseenter.scroll') ... 代码
    // 因为现在通过 CSS 的 :hover 伪类控制颜色，不再需要 JS 介入布局，从而消除了抖动。

    // 1. 顶部 Header (不变)
    const headerRow = left.append('xhtml:div')
      .style('display', 'flex')
      .style('justify-content', 'space-between')
      .style('align-items', 'center')
      .style('margin-bottom', '0px')

    headerRow.append('xhtml:div')
      .style('font-size', '9px')
      .style('font-weight', '600')
      .style('color', '#6b7280')
      .style('user-select', 'none')
      .text('Input')

    headerRow.append('xhtml:div')
      .style('cursor', 'pointer')
      .style('font-size', '10px')
      .style('color', '#6b7280')
      .style('padding', '0 2px')
      .text('↻')
      .attr('title', 'Apply & Regenerate')
      .on('mouseenter', function() { d3.select(this).style('color', '#2563eb') })
      .on('mouseleave', function() { d3.select(this).style('color', '#6b7280') })
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', (ev) => {
        ev.stopPropagation()
        const currentParams = {}
        left.selectAll('.node-input').each(function() {
            const el = d3.select(this)
            const key = el.attr('data-key')
            let val = el.property('value')
            if (el.attr('type') === 'number') val = Number(val)
            if (key) currentParams[key] = val
        })
        emit('regenerate-node', d, currentParams)
      })

    // --- 核心渲染函数：增加了 fontSize 参数 ---
    // titleSize: 标题字号, inputSize: 内容字号
    const createNestedField = (container, label, key, value, type, isFullWidth = true, titleSize = '7px', inputSize = '8.5px') => {
        const wrapper = container.append('xhtml:div')
            .style('display', 'flex')
            .style('flex-direction', 'column')
            .style('gap', '1px')
            
        if (isFullWidth) {
            wrapper.style('width', '100%')
        } else {
            wrapper
                .style('flex', '1 1 28%') 
                .style('min-width', '0')
        }

        // 标题
        wrapper.append('xhtml:div')
            .style('font-size', titleSize)
            .style('color', '#292f38ff')
            .style('white-space', 'nowrap')
            .style('overflow', 'hidden')
            .style('text-overflow', 'ellipsis')
            .style('line-height', '1.3') 
            .style('margin', '0')
            .style('padding-left','1px')
            .text(label)

        const contentDiv = wrapper.append('xhtml:div')
            .style('width', '100%')
            // 注意：对于 Textarea (Prompt)，不要设 line-height: 0，否则可能切断文字
            // 只有小参数才设为 0 以消除间距
            .style('line-height', isFullWidth ? 'normal' : '0')

        let input;
        if (type === 'textarea') {
            const hasContent = value && String(value).trim().length > 0
            let rowCount = 1
            if (hasContent) {
                rowCount = (key === 'positive_prompt') ? 3 : 2
            }

            input = contentDiv.append('xhtml:textarea')
                .attr('rows', rowCount)
                .style('resize', 'none')
                .text(value)
        } else {
            input = contentDiv.append('xhtml:input')
                .attr('type', type === 'number' ? 'number' : 'text')
                .attr('value', value)
        }

        // 【关键逻辑】差异化上边距
        // 如果是 FullWidth (Prompt)，margin-top 为 0 (保持原样)
        // 如果是其他小参数，margin-top 为 -2px (向上拉紧)
        const marginTopVal = isFullWidth ? '2px' : '1px'
        

        input.attr('class', 'node-input thin-scroll')
             .attr('data-key', key)
             .style('width', '100%')
             .style('display', 'block')
             .style('font-size', inputSize)
             .style('line-height', '1.3')
             .style('color', '#747b88ff')
             .style('background', 'transparent')
             .style('border', '1px solid transparent')
             .style('border-radius', '2px')
             .style('padding', '0px 2px')
             .style('outline', 'none')
             .style('font-family', 'inherit')
             .style('margin-top', marginTopVal) // 应用差异化边距
             .on('mousedown', ev => ev.stopPropagation())
             .on('focus', function() { 
                  d3.select(this).style('background', '#ffffff').style('border-color', '#e5e7eb') 
             })
             .on('blur', function() { 
                  d3.select(this).style('background', 'transparent').style('border-color', 'transparent') 
             })
             .on('mouseenter', function() {
                  if (document.activeElement !== this) d3.select(this).style('background', '#f9fafb')
              })
             .on('mouseleave', function() {
                   if (document.activeElement !== this) d3.select(this).style('background', 'transparent')
              })
    }

    // --- 数据准备 ---
    const params = d.parameters || {}
    const excluded = ['positive_prompt', 'negative_prompt', 'text', 'seed']
    const smallParams = Object.entries(params).filter(([k]) => !excluded.includes(k))

    // 2. Prompt 模块 (保持原来的标准字号: 标题7px, 内容8.5px)
    const posVal = params.positive_prompt || params.text || ''
    createNestedField(left, 'Positive Prompt', 'positive_prompt', posVal, 'textarea', true, '7px', '7px')

    // 3. Negative Prompt 模块 (保持原来的标准字号)
    const negVal = params.negative_prompt || ''
    createNestedField(left, 'Negative Prompt', 'negative_prompt', negVal, 'textarea', true, '7px', '7px')

    // 4. 其他参数的大容器
    if (smallParams.length > 0) {
        const othersContainer = left.append('xhtml:div')
            .attr('class', 'others-params-container')
            .style('display', 'flex')
            .style('flex-wrap', 'wrap')
            .style('gap', '3px') // 稍微调小间距
            .style('padding-top', '6px')
            .style('border-top', '1px dashed #f3f4f6')

        smallParams.forEach(([key, val]) => {
            const isNum = typeof val === 'number'
            const labelName = key.replace(/_/g, ' ')
            
            // 【改动5】在这里传入更小的字号
            // 标题: 6px (极小)
            // 内容: 7.5px (紧凑)
            createNestedField(othersContainer, labelName, key, val, isNum ? 'number' : 'text', false, '6.5px', '6.5px')
        })
    }


    const right = body.append('xhtml:div')
      .style('flex', '1 1 0')
      .style('min-width', '0')
      .style('padding', '2px 4px')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('position', 'relative')
      .style('overflow', 'hidden')

    right.append('xhtml:div')
      .style('position', 'absolute')
      .style('top', '2px')
      .style('left', '4px')
      .style('font-size', '9px')
      .style('font-weight', '600')
      .style('color', '#6b7280')
      .style('user-select', 'none')
      .text('Output')

    if (hasMedia) {
      if (isVideo) {
        const v = right.append('xhtml:video')
          .style('width', '100%')
          .style('height', '80px')
          .style('object-fit', 'contain')
          .attr('muted', true)
          .attr('playsinline', true)
          .attr('preload', 'metadata')
          .on('mousedown', ev => ev.stopPropagation())
          .on('click', ev => {
            ev.stopPropagation()
            emit('open-preview', mediaUrl, d.media.type)
          })
        const el = v.node()
        el.autoplay = true
        el.loop = true
        el.muted = true
        el.playsInline = true
        el.src = mediaUrl
      } else {
        right.append('xhtml:img')
          .style('width', '100%')
          .style('height', '80px')
          .style('object-fit', 'contain')
          .attr('src', mediaUrl)
          .attr('alt', d.module_id || 'thumbnail')
          .on('mousedown', ev => ev.stopPropagation())
          .on('click', ev => {
            ev.stopPropagation()
            emit('open-preview', mediaUrl, d.media.type)
          })
      }
    } else {
      right.append('xhtml:div')
        .style('font-size', '11px')
        .style('color', '#9ca3af')
        .style('user-select', 'none')
        .text('(Output placeholder)')
    }

    const dots = right.append('xhtml:div')
      .attr('class', 'dots-container')
      .style('position', 'absolute')
      .style('top', '4px')
      .style('right', '4px')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('opacity', '0')
      .style('transition', 'opacity 0.15s ease-in-out')
      .style('z-index', '10')

    const buttonTypes = (d.module_id === 'AddText') ? ['red', 'yellow', 'green', 'audio'] : ['red', 'yellow', 'green']
    buttonTypes.forEach((key, idx) => {
      const info = workflowTypes[key]
      if (!info) {
        console.warn(`WorkflowType "${key}" is not defined.`)
        return
      }
      dots.append('xhtml:button')
        .style('background-color', info.color)
        .style('width', '16px')
        .style('height', '16px')
        .style('border-radius', '50%')
        .style('border', 'none')
        .style('padding', '0')
        .style('cursor', 'pointer')
        .style('transition', 'transform 0.15s ease-in-out')
        .style('margin-top', idx > 0 ? '4px' : '0')
        .attr('title', `Start ${info.type} workflow`)
        .on('mouseenter', function () { d3.select(this).style('transform', 'scale(1.25)') })
        .on('mouseleave', function () { d3.select(this).style('transform', 'scale(1)') })
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation()
          emit('open-generation', d, info.defaultModuleId, info.type)
        })
    })

    const footer = card.append('xhtml:div')
      .style('display', 'flex')
      .style('justify-content', 'flex-end')
      .style('padding', '2px')

    if (canAddToStitch) {
      const selColor = isVideo ? NODE_COLORS.video : NODE_COLORS.image
      footer.append('xhtml:button')
        .attr('class', 'add-clip-btn')
        .html('▶')
        .style('opacity', '0')
        .style('transition', 'opacity 0.15s ease-in-out')
        .style('width', '20px')
        .style('height', '20px')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('color', selColor)
        .style('font-size', '1.125rem')
        .style('border', 'none')
        .style('background-color', 'transparent')
        .style('padding', '0')
        .style('cursor', 'pointer')
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation()
          emit('add-clip', d, isVideo ? 'video' : 'image')
        })
    }

    addTooltip(gEl, d)
  }

  // --- 主循环：根据类型分发渲染 ---
  nodeSel.each(function (d) {
    const gEl = d3.select(this)
    const cardType = d._cardType || inferCardType(d)

    // Init 特例
    if (cardType === 'init') {
      gEl.append('circle')
        .attr('r', 30)
        .attr('fill', '#fff')
        .attr('stroke', NODE_COLORS.auxBorder)
        .attr('stroke-width', 2)

      gEl.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', '14px')
        .style('fill', '#6b7280')
        .style('pointer-events', 'none')
        .text('Init')

      gEl.style('cursor', 'pointer')
        .on('click', (ev) => {
          ev.stopPropagation()
          const selected = new Set(selectedIds)
          if (selected.has(d.id)) selected.delete(d.id)
          else if (selected.size < 2) selected.add(d.id)
          emit('update:selectedIds', Array.from(selected))
        })

      const btnFo = gEl.append('foreignObject')
        .attr('width', 20)
        .attr('height', 20)
        .attr('x', 35)
        .attr('y', -15)
        .style('overflow', 'visible')
      btnFo.append('xhtml:button')
        .style('background-color', '#ffffffff')
        .style('border', '1px solid #d1d5db')
        .style('color', '#374151')
        .style('border-radius', '6px')
        .style('width', '100%')
        .style('height', '100%')
        .style('font-size', '12px')
        .style('font-weight', '600')
        .style('cursor', 'pointer')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('user-select', 'none')
        .html('+')
        .on('mousedown', (ev) => ev.stopPropagation())
        .on('click', (ev) => {
          ev.stopPropagation()
          emit('create-card', d, 'AddText', 'util')
        })
      return
    }

    const hasMedia = !!(d.media && d.media.rawPath)
    const rawPath = hasMedia ? d.media.rawPath : ''
    const isAudioMedia = typeof rawPath === 'string' &&
      (rawPath.includes('.mp3') || rawPath.includes('.wav') || rawPath.includes('subfolder=audio'))

    if (cardType === 'textFull') {
      console.log(`renderTree textFull`)
      renderTextFullNode(gEl, d, selectedIds, emit)
    } else if (cardType === 'audio' || isAudioMedia) {
      renderAudioNode(gEl, d, selectedIds, emit, workflowTypes)
    } else {
      renderIONode(gEl, d, selectedIds, emit, workflowTypes)
    }
  })
}
