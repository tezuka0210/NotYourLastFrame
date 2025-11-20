// src/lib/lib/workflowGraph.js
import * as d3 from 'd3'
import * as dagre from 'dagre'
import WaveSurfer from 'wavesurfer.js'

const defaultLinkColor = '#9ca3af'

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

/** 仅更新“选中”样式 */
export function updateSelectionStyles(svgElement, selectedIds) {
  const selectedStyle = '0 0 0 3px #3b82f6'
  const defaultStyle = 'none'
  d3.select(svgElement).selectAll('.node')
    .each(function (d) {
      if (!d || !d.id) return
      const card = d3.select(this).select('.node-card')
      card.style('box-shadow', selectedIds.includes(d.id) ? selectedStyle : defaultStyle)
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

/** 根据 node 粗略推断当前“卡片类型” */
function inferCardType(node) {
  const hasMedia = !!(node.media && node.media.rawPath)
  const promptText = (node.parameters) ? (node.parameters.positive_prompt || node.parameters.text) : null
  const hasPrompt = typeof promptText === 'string' && promptText.trim() !== ''

  const rawPath = hasMedia ? node.media.rawPath : ''
  const isAudioMedia = typeof rawPath === 'string' &&
    (rawPath.includes('.mp3') || rawPath.includes('.wav') || rawPath.includes('subfolder=audio'))

  if (node.module_id === 'Init') return 'init'
  if (!hasMedia && hasPrompt && node.module_id === 'AddText') return 'textFull'
  if (node.module_id === 'TextToAudio' || isAudioMedia || (node.media && node.media.type === 'audio')) return 'audio'
  return 'io'
}

/** 完整重绘（重新布局 & 初始缩放） */
export function renderTree(
  svgElement,
  allNodesData,
  selectedIds,
  emit,           // (eventName, ...args) => void
  workflowTypes   // { red:{color,type,defaultModuleId}, yellow:{...}, green:{...}, audio?:{...} }
) {
  const wrapper = d3.select(svgElement)
  wrapper.html('')

  // 禁止在整棵树上选择文字
  wrapper
    .style('user-select', 'none')
    .style('-webkit-user-select', 'none')
    .style('-moz-user-select', 'none')
    .style('-ms-user-select', 'none')

  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodesData)
  if (!visibleNodes.length) {
    wrapper.append('text')
      .attr('x', '50%').attr('y', '50%')
      .attr('text-anchor', 'middle')
      .attr('fill', '#9ca3af')
      .text('No data yet. Please start generation from the right side.')
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
  const audioColor = (workflowTypes.audio && workflowTypes.audio.color) || '#3b82f6'
  ;[
    { id: 'red', color: workflowTypes.red.color },
    { id: 'yellow', color: workflowTypes.yellow.color },
    { id: 'green', color: workflowTypes.green.color },
    { id: 'audio', color: audioColor },
    { id: 'default', color: defaultLinkColor },
  ].forEach(c => {
    defs.append('marker')
      .attr('id', `arrowhead-${c.id}`)
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 10).attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('xoverflow', 'visible')
      .append('path')
      .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
      .style('fill', c.color)
      .style('stroke', 'none')
  })

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

  function getLinkStyle(d) {
    const target = allNodesData.find(n => n.id === d.w)
    const linkColor = target && target.linkColor

    if (linkColor === workflowTypes.red.color) {
      return { color: workflowTypes.red.color, id: 'url(#arrowhead-red)' }
    }
    if (linkColor === workflowTypes.yellow.color) {
      return { color: workflowTypes.yellow.color, id: 'url(#arrowhead-yellow)' }
    }
    if (linkColor === workflowTypes.green.color) {
      return { color: workflowTypes.green.color, id: 'url(#arrowhead-green)' }
    }
    if (linkColor === audioColor) {
      return { color: audioColor, id: 'url(#arrowhead-audio)' }
    }
    return { color: defaultLinkColor, id: 'url(#arrowhead-default)' }
  }

  // Links
  linkGroup.selectAll('path.link')
    .data(dagreEdges)
    .enter().append('path')
    .attr('class', 'link')
    .each(function (d) {
      const st = getLinkStyle(d)
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
    const header = card.append('xhtml:div')
      .style('display', 'flex')
      .style('justify-content', 'space-between')
      .style('align-items', 'center')
      .style('padding', '2px 6px')
      .style('border-bottom', '1px solid #e5e7eb')
      .style('flex-shrink', '0')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')
      .style('-moz-user-select', 'none')
      .style('-ms-user-select', 'none')

    const title = header.append('xhtml:div')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('color', '#111827')
      .style('overflow', 'hidden')
      .style('text-overflow', 'ellipsis')
      .style('white-space', 'nowrap')
      .style('min-width', '0')

    title.text(d.module_id || '(Node)')

    const toolbar = header.append('xhtml:div')
      .style('display', 'flex')
      .style('gap', '4px')
      .style('align-items', 'center')

    // helper to create round icon buttons with hover
    function makeIconButton(text, options = {}) {
      const {
        border = '1px solid #e5e7eb',
        bg = '#ffffff',
        color = '#6b7280',
        hoverBg = '#f9fafb',
        hoverBorder = border,
        hoverColor = color,
        className = ''
      } = options

      const btn = toolbar.append('xhtml:button')
        .text(text)
        .attr('class', className)
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('padding', '0')
        .style('width', '18px')
        .style('height', '18px')
        .style('border-radius', '999px')
        .style('border', border)
        .style('background', bg)
        .style('font-size', '11px')
        .style('line-height', '1')
        .style('color', color)
        .style('cursor', 'pointer')
        .on('mousedown', ev => ev.stopPropagation())
        .on('mouseenter', function () {
          d3.select(this)
            .style('background', hoverBg)
            .style('border', hoverBorder)
            .style('color', hoverColor)
        })
        .on('mouseleave', function () {
          d3.select(this)
            .style('background', bg)
            .style('border', border)
            .style('color', color)
        })

      return btn
    }

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
      const isCollapsed = !!d._collapsed
      const collapseBtn = makeIconButton(
        isCollapsed ? '+' : '-',
        {
          border: '1px solid #e5e7eb',
          bg: '#ffffff',
          color: isCollapsed ? '#E4080A' : '#9ca3af',
          hoverBg: '#f3f4f6',
          hoverBorder: '1px solid #d1d5db',
          hoverColor: isCollapsed ? '#b91c1c' : '#4b5563',
          className: 'collapse-btn'
        }
      )
      collapseBtn.on('click', ev => {
        ev.stopPropagation()
        emit('toggle-collapse', d.id)
      })
    }

    // 复制（占位）
    const cloneBtn = makeIconButton('+', {
      border: '1px solid #e5e7eb',
      bg: '#ffffff',
      color: '#6b7280',
      hoverBg: '#f3f4f6',
      hoverBorder: '1px solid #d1d5db',
      hoverColor: '#111827'
    })
    cloneBtn.on('click', ev => {
      ev.stopPropagation()
      console.log('[TODO] clone node', d.id)
    })

    // 删除
    const deleteBtn = makeIconButton('×', {
      border: '1px solid #fecaca',
      bg: '#ffffff',
      color: '#E4080A',
      hoverBg: '#fee2e2',
      hoverBorder: '1px solid #fecaca',
      hoverColor: '#b91c1c'
    })
    deleteBtn.on('click', ev => {
      ev.stopPropagation()
      emit('delete-node', d.id)
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
      .style('border-color', '#d1d5db')
      .style('border-radius', '8px')
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')
      .style('-moz-user-select', 'none')
      .style('-ms-user-select', 'none')

    // 选中
    card.style('box-shadow', selectedIds.includes(d.id) ? '0 0 0 3px #3b82f6' : 'none')
    card.on('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('button')) return
      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      card.style('box-shadow', on ? 'none' : '0 0 0 3px #3b82f6')
      emit('update:selectedIds', Array.from(selected))
    })

    card.on('mouseenter', () => card.selectAll('.dots-container').style('opacity', '1'))
      .on('mouseleave', () => card.selectAll('.dots-container').style('opacity', '0'))

    // header
    buildHeader(card, d)

    // 主体：通栏文本 + 预留按钮区域
    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')
      .style('-moz-user-select', 'none')
      .style('-ms-user-select', 'none')

    const textArea = body.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('padding', '6px')
      .style('font-size', '10px')
      .style('color', '#374151')
      .style('white-space', 'pre-wrap')
      .style('word-break', 'break-all')
      .style('border-bottom', '1px dashed #e5e7eb')
      .on('mousedown', ev => ev.stopPropagation())

    textArea.append('xhtml:div')
      .style('opacity', promptText ? '0.7' : '0.4')
      .text(promptText || '(Original input / prompt)')

    const toolbar = body.append('xhtml:div')
      .style('flex-shrink', '0')
      .style('padding', '4px 6px')
      .style('display', 'flex')
      .style('justify-content', 'flex-end')
      .style('gap', '4px')

    // 预留控制按钮（占位）
    ;['Cut', 'Refine', 'Flow'].forEach(label => {
      toolbar.append('xhtml:button')
        .text(label)
        .style('width', '32px')
        .style('height', '18px')
        .style('border-radius', '999px')
        .style('border', '1px solid #e5e7eb')
        .style('background', '#f9fafb')
        .style('font-size', '10px')
        .style('cursor', 'pointer')
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation()
          console.log('[TODO] text toolbar click', label, d.id)
        })
    })

    addTooltip(gEl, d)
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
      .style('border-color', '#d1d5db')
      .style('border-radius', '8px')
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')
      .style('-moz-user-select', 'none')
      .style('-ms-user-select', 'none')

    card.style('box-shadow', selectedIds.includes(d.id) ? '0 0 0 3px #3b82f6' : 'none')
    card.on('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('button')) return
      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      card.style('box-shadow', on ? 'none' : '0 0 0 3px #3b82f6')
      emit('update:selectedIds', Array.from(selected))
    })

    card.on('mouseenter', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '1'))
      .on('mouseleave', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '0'))

    // header：统一 [+ - x]
    buildHeader(card, d)

    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('padding', '4px 6px')
      .style('gap', '4px')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')
      .style('-moz-user-select', 'none')
      .style('-ms-user-select', 'none')

    if (promptText && promptText.trim() !== '') {
      body.append('xhtml:div')
        .style('font-size', '10px')
        .style('color', '#374151')
        .style('white-space', 'pre-wrap')
        .style('word-break', 'break-all')
        .style('max-height', '40px')
        .style('overflow', 'hidden')
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
      .style('background-color', '#3b82f6')
      .style('color', 'white')
      .style('border-radius', '50%')
      .style('font-size', '16px')
      .style('line-height', '32px')
      .style('flex-shrink', '0')
      .style('cursor', 'pointer')
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
      progressColor: '#3b82f6',
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
      waveformDiv.html('<span style="color:red; font-size:10px;">Audio loading error (CORS or network).</span>')
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

    // 右侧类型按钮（audio workflow）
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
      .style('color', '#3b82f6')
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
    const isVideo = typeof rawPath === 'string' && (rawPath.includes('.mp4') || rawPath.includes('subfolder=video'))
    const isImage = hasMedia && !isVideo
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
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')
      .style('-moz-user-select', 'none')
      .style('-ms-user-select', 'none')

    const border =
      d.status === 'running' ? '#3b82f6' :
      d.status === 'success' ? '#22c55e' :
      d.status === 'error'   ? '#ef4444' : '#d1d5db'
    card.style('border-color', border)
    card.style('box-shadow', selectedIds.includes(d.id) ? '0 0 0 3px #3b82f6' : 'none')

    card.on('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('button, img, video')) return
      ev.stopPropagation()
      const selected = new Set(selectedIds)
      const on = selected.has(d.id)
      if (on) selected.delete(d.id)
      else if (selected.size < 2) selected.add(d.id)
      card.style('box-shadow', on ? 'none' : '0 0 0 3px #3b82f6')
      emit('update:selectedIds', Array.from(selected))
    })

    card.on('mouseenter', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '1'))
      .on('mouseleave', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '0'))

    // header
    buildHeader(card, d)

    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('padding', '4px 4px')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')
      .style('-moz-user-select', 'none')
      .style('-ms-user-select', 'none')

    // 左侧 Input
    const left = body.append('xhtml:div')
      .style('flex', '1 1 0')
      .style('min-width', '0')
      .style('padding', '4px 6px')
      .style('border-right', '1px solid #e5e7eb')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '4px')
      .style('background', '#f9fafb')

    left.append('xhtml:div')
      .style('font-size', '9px')
      .style('font-weight', '600')
      .style('color', '#6b7280')
      .text('Input')

    if (hasPrompt) {
      left.append('xhtml:div')
        .style('font-size', '10px')
        .style('color', '#374151')
        .style('white-space', 'pre-wrap')
        .style('word-break', 'break-all')
        .style('max-height', '48px')
        .style('overflow', 'hidden')
        .text(promptText)
        .on('mousedown', ev => ev.stopPropagation())
    } else {
      left.append('xhtml:div')
        .style('font-size', '10px')
        .style('color', '#9ca3af')
        .text('(Prompt is empty)')
    }

    // 简单注明输入类型
    const inputTypeRow = left.append('xhtml:div')
      .style('font-size', '9px')
      .style('color', '#6b7280')

    if (isImage) {
      inputTypeRow.text('Image + text (from upstream)')
    } else if (isVideo) {
      inputTypeRow.text('Video + text (from upstream)')
    } else {
      inputTypeRow.text('Text / upstream workflow output')
    }

    // 右侧 Output
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
        .text('No output yet.')
    }

    // 输出类型提示
    const outputHint = right.append('xhtml:div')
      .style('position', 'absolute')
      .style('bottom', '2px')
      .style('right', '4px')
      .style('font-size', '9px')
      .style('color', '#9ca3af')

    if (isVideo) {
      outputHint.text('Video preview')
    } else if (isImage) {
      outputHint.text('Image output')
    } else if (hasMedia) {
      outputHint.text('Media output')
    } else {
      outputHint.text('Pending generation')
    }

    // 右上角 workflow 类型按钮
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

    // Footer：添加到拼接
    const footer = card.append('xhtml:div')
      .style('display', 'flex')
      .style('justify-content', 'flex-end')
      .style('padding', '2px')

    if (canAddToStitch) {
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
        .style('color', '#3b82f6')
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
        .attr('stroke', '#6b7280')
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

      // Init 右侧 “+ Text” 按钮
      const btnFo = gEl.append('foreignObject')
        .attr('width', 60)
        .attr('height', 30)
        .attr('x', 35)
        .attr('y', -15)
        .style('overflow', 'visible')
      btnFo.append('xhtml:button')
        .style('background-color', '#f3f4f6')
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
        .html('+ Text')
        .on('mousedown', (ev) => ev.stopPropagation())
        .on('click', (ev) => {
          ev.stopPropagation()
          emit('open-generation', d, 'AddText', 'util')
        })
      return
    }

    // 探测是否音频媒体
    const hasMedia = !!(d.media && d.media.rawPath)
    const rawPath = hasMedia ? d.media.rawPath : ''
    const isAudioMedia = typeof rawPath === 'string' &&
      (rawPath.includes('.mp3') || rawPath.includes('.wav') || rawPath.includes('subfolder=audio'))

    if (cardType === 'textFull') {
      renderTextFullNode(gEl, d, selectedIds, emit)
    } else if (cardType === 'audio' || isAudioMedia) {
      renderAudioNode(gEl, d, selectedIds, emit, workflowTypes)
    } else {
      renderIONode(gEl, d, selectedIds, emit, workflowTypes)
    }
  })
}
