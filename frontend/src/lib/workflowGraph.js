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
  if (isNaN(seconds) || seconds < 0) return '--:--';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
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

/** 完整重绘（重新布局 & 初始缩放） */
export function renderTree(
  svgElement,
  allNodesData,
  selectedIds,
  emit,           // (eventName, ...args) => void
  workflowTypes   // { red:{color,type,defaultModuleId}, yellow:{...}, green:{...} }
) {
  const wrapper = d3.select(svgElement)
  wrapper.html('')

  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodesData)
  if (!visibleNodes.length) {
    wrapper.append('text')
      .attr('x', '50%').attr('y', '50%')
      .attr('text-anchor', 'middle')
      .attr('fill', '#9ca3af')
      .text('暂无数据，请从右侧开始生成...')
    return
  }

  // Dagre 布局
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 120 })
  g.setDefaultEdgeLabel(() => ({}))

  // --- (核心修复 1) 动态计算高度 ---
   const BASE_CARD_HEIGHT = 180; // (Header + 140px图片 + Footer) //
  const PROMPT_AREA_HEIGHT = 30; // (为 Prompt 额外增加的高度) //
  const TEXT_NODE_HEIGHT = 100; // 纯文本节点的额外高度 //

  visibleNodes.forEach(node => { //
    const isInit = node.module_id === 'Init';
    const promptText = (node.parameters)? ( node.parameters.positive_prompt|| node.parameters.text) : null; 
    const hasPrompt = typeof promptText === 'string' && promptText.trim() !== ''; //
    const hasMedia = !!(node.media && node.media.rawPath); //
    const isPureTextNode = !hasMedia && hasPrompt;
    // --- 【修改】开始：为布局计算 isAudio ---
    const rawPath = hasMedia ? node.media.rawPath : '';
    const isAudio = typeof rawPath === 'string' && (rawPath.includes('.mp3') || rawPath.includes('.wav') || rawPath.includes('subfolder=audio'));

    const width = isInit ? 60 : (isAudio ? 240 : (isPureTextNode? 100 : 140 )); // <-- 音频节点宽度 240px

    let height;
    if (isInit) {
      height = 60;
    } else if (isAudio) {
      height = 90; // <-- 音频节点高度 90px (Header + 约 50px 的播放器)
    } else {
      // 原始的图片/视频/文本节点的高度逻辑
      height = BASE_CARD_HEIGHT;
      if (isPureTextNode) {
         height = 100;
      } else if (hasMedia && hasPrompt) {
         height = BASE_CARD_HEIGHT + PROMPT_AREA_HEIGHT;
      }
    }

    // 把计算结果存回节点，方便后面使用
    node.calculatedHeight = height;
    node.calculatedWidth = width;

    g.setNode(node.id, {
      label: node.module_id,
      width: width,
      height: height, 
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
  ;[
    { id: 'red', color: workflowTypes.red.color },
    { id: 'yellow', color: workflowTypes.yellow.color },
    { id: 'green', color: workflowTypes.green.color },
    { id: 'audio', color: workflowTypes.audio?.color || '#3b82f6' },
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
    if (linkColor === workflowTypes.red.color) return { color: workflowTypes.red.color, id: 'url(#arrowhead-red)' }
    if (linkColor === workflowTypes.yellow.color) return { color: workflowTypes.yellow.color, id: 'url(#arrowhead-yellow)' }
    if (linkColor === workflowTypes.green.color) return { color: workflowTypes.green.color, id: 'url(#arrowhead-green)' }
    if (linkColor === (workflowTypes.audio?.color || '#3b82f6')) return { color: workflowTypes.audio.color, id: 'url(#arrowhead-audio)' }
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
   * 渲染新的音频播放器节点
   */
  function renderAudioNode(gEl, d, selectedIds, emit, workflowTypes) {
    // --- 1. 计算通用变量 ---
    const mediaUrl = d.media.url;

    // --- 2. 创建卡片基础 ---
    const fo = gEl.append('foreignObject') //
      .attr('width', d.calculatedWidth)
      .attr('height', d.calculatedHeight)
      .attr('x', -d.calculatedWidth / 2)
      .attr('y', -d.calculatedHeight / 2)
      .style('overflow', 'visible');

    // --- 4. 创建卡片 DIV (d3-selection) ---
    const card = fo.append('xhtml:div') //
      .attr('class', 'node-card')
      .style('width', '100%')
      .style('height', '100%')
      .style('display', 'flex').style('flex-direction', 'column')
      .style('border-width', '2px')
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff');

    // 边框和选中样式
    const border = d.status === 'running' ? '#3b82f6' : '#d1d5db';
    card.style('border-color', border);
    card.style('box-shadow', selectedIds.includes(d.id) ? '0 0 0 3px #3b82f6' : 'none');

    // 卡片点击事件 (选中)
    card.on('click', (ev) => {
      if (ev.target && ev.target.closest && ev.target.closest('button, .dots-container')) return; // 忽略按钮
      ev.stopPropagation();
      const selected = new Set(selectedIds);
      const on = selected.has(d.id);
      if (on) selected.delete(d.id);
      else if (selected.size < 2) selected.add(d.id);
      card.style('box-shadow', on ? 'none' : '0 0 0 3px #3b82f6');
      emit('update:selectedIds', Array.from(selected));
    });

    // Hover 事件 (显示按钮)
    card.on('mouseenter', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '1'))
       .on('mouseleave', () => card.selectAll('.add-clip-btn, .dots-container').style('opacity', '0'));

    // --- 5. 卡片 Header (与标准卡片相同) ---
    const header = card.append('xhtml:div') //
      .style('display', 'flex')
      .style('justify-content', 'space-between')
      .style('align-items', 'center')
      .style('padding', '1px 4px')
      .style('border-bottom', '1px solid #e5e7eb')
      .style('flex-shrink', '0');

    header.append('xhtml:h3') //
      .style('font-size', '8px').style('font-weight', '700').style('color', '#1f2937')
      .style('overflow', 'hidden').style('text-overflow', 'ellipsis').style('white-space', 'nowrap')
      .style('min-width','0')
      .text(d.module_id || '(节点)');

    header.append('xhtml:button') //
      .style('background-color', '#fff')
      .style('color', '#E4080A')
      .style('border-radius', '50%').style('border', 'none')
      .style('width', '16px').style('height', '16px').style('font-size', '16px').style('line-height', '16px')
      .style('cursor', 'pointer').style('flexShrink', '0')
      .html('&#xD7;')
      .on('mousedown', (ev) => ev.stopPropagation())
      .on('click', (ev) => { ev.stopPropagation(); emit('delete-node', d.id) }); //

    // --- 6. 【新】音频播放器 Content ---
    const content = card.append('xhtml:div')
      .style('flex-grow', '1')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('padding', '8px')
      .style('gap', '8px');

    // 6a. 播放/暂停 按钮
    const playBtn = content.append('xhtml:button')
      .style('width', '32px').style('height', '32px')
      .style('border', 'none')
      .style('background-color', '#3b82f6') // 蓝色
      .style('color', 'white')
      .style('border-radius', '50%')
      .style('font-size', '16px')
      .style('line-height', '32px')
      .style('flex-shrink', '0')
      .style('cursor', 'pointer')
      .html('&#9658;'); // ▶

    // 6b. 波形图 + 时间
   const waveformWrapper = content.append('xhtml:div')
      .style('flex-grow', '1')
      .style('display', 'flex').style('flex-direction', 'column')
      .style('justify-content', 'center')
      .style('min-width', '0')
      

    
    // 6b-1. 【新】WaveSurfer.js 的挂载点
    const waveformDiv = waveformWrapper.append('xhtml:div')
      .style('width', '100%')
      .style('height', '20px'); // WaveSurfer 会自动填充这个 div

    // 6b-2. 时间显示
    const timeDisplay = waveformWrapper.append('xhtml:div')
      .style('font-size', '10px').style('color', '#6b7280')
      .text('0:00 / --:--');

    // --- 7. 【新】初始化 WaveSurfer.js ---

    // (D3.select 返回的是 D3 实例, .node() 返回的是真实 DOM 元素)
    const wavesurfer = WaveSurfer.create({
      container: waveformDiv.node(), // 挂载到我们创建的 <div>
      waveColor: '#9ca3af', // 灰色
      progressColor: '#3b82f6', // 蓝色
      height: 20, // 必须与 <div> 的高度匹配
      barHeight:2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      url: mediaUrl,
      // (注意：WaveSurfer 自动创建 <audio> 元素)
    });

    // --- 8. 【新】绑定 WaveSurfer.js 事件 ---

    // (错误处理)
    wavesurfer.on('error', (err) => {
      console.error('WaveSurfer error:', err);
      // 【重要】在这里检查 F12 控制台的 CORS 错误！
      waveformDiv.html(`<span style="color:red; font-size:10px;">CORS Error? ${err}</span>`);
    });

    // --- 7. 【新】音频播放逻辑 ---
     // (加载完成，获取总时长)
    wavesurfer.on('ready', (duration) => {
      timeDisplay.text(`0:00 / ${formatTime(duration)}`);
    });

    // (播放中，更新当前时间)
    wavesurfer.on('timeupdate', (currentTime) => {
      timeDisplay.text(`${formatTime(currentTime)} / ${formatTime(wavesurfer.getDuration())}`);
    });

    // (播放结束，重置按钮)
    wavesurfer.on('finish', () => {
      playBtn.html('&#9658;'); // ▶
    });

    // (连接我们的播放按钮)
    playBtn.on('click', (ev) => {
      ev.stopPropagation();
      wavesurfer.playPause();
      // 更新按钮图标
      if (wavesurfer.isPlaying()) {
        playBtn.html('&#10074;&#10074;'); // ⏸
      } else {
        playBtn.html('&#9658;'); // ▶
      }
    });

    // (D3 重绘时清理)
    fo.on('remove', () => {
      wavesurfer.destroy();
    });

    // --- 8. 右上角三色按钮 (附加到 card) ---
    const dots = card.append('xhtml:div') //
      .attr('class', 'dots-container')
      .style('position', 'absolute') //
      .style('display', 'flex').style('flex-direction', 'column')
      .style('opacity', '0').style('transition', 'opacity 0.15s ease-in-out')
      .style('z-index', '10')
      .style('top', '55px') // <-- 放在 Header 下方
      .style('right', '4px'); //

    const buttonTypes = ['audio']; // 音频节点显示所有按钮
    buttonTypes.forEach((key, idx) => { //
      const info = workflowTypes[key];
      if (!info) return;
      dots.append('xhtml:button') //
        .style('background-color', info.color)
        .style('width', '16px').style('height', '16px').style('border-radius', '50%')
        .style('border', 'none').style('padding', '0').style('cursor', 'pointer')
        .style('transition', 'transform 0.15s ease-in-out')
        .style('margin-top', idx > 0 ? '4px' : '0')
        .attr('title', `Start ${info.type} workflow`)
        .on('mouseenter', function () { d3.select(this).style('transform', 'scale(1.25)') })
        .on('mouseleave', function () { d3.select(this).style('transform', 'scale(1)') })
        .on('mousedown', (ev) => ev.stopPropagation())
        .on('click', (ev) => { ev.stopPropagation(); emit('open-generation', d, info.defaultModuleId, info.type) }); //
    });

    const footer = card.append('xhtml:div')
      .style('display', 'flex').style('justify-content', 'flex-end')
      .style('padding', '2px')
      

    footer.append('xhtml:button')
      .attr('class', 'add-clip-btn')
      .html('&#9658;') // ▶
      .style('opacity', '0').style('transition', 'opacity 0.15s ease-in-out') // (默认隐藏，同)
      .style('width', '10px').style('height', '10px')
      .style('display', 'flex').style('align-items', 'center').style('justify-content', 'center')
      .style('color', '#3b82f6').style('font-size', '1.125rem')
      .style('border', 'none').style('background-color', 'transparent').style('padding', '0')
      .style('cursor', 'pointer')
      .on('mousedown', (ev) => ev.stopPropagation())
      .on('click', (ev) => {
          ev.stopPropagation();
          // (关键) 发出 'audio' 类型
          emit('add-clip', d, 'audio');
        });
    // --- 9. 收缩/展开按钮 (与标准卡片相同) ---
    addCollapseButton(gEl, d, allNodesData, emit); //

    // --- 10. Tooltip (与标准卡片相同) ---
    addTooltip(gEl, d); //
  }

  /**
   * 渲染标准的图片、视频或纯文本节点
   */
  function renderStandardNode(gEl, d, selectedIds, emit, workflowTypes) {
    // --- 1. 计算通用变量 ---
    const hasMedia = !!(d.media && d.media.rawPath); 
    const mediaUrl = hasMedia ? d.media.url : ''; 
    const rawPath = hasMedia ? d.media.rawPath : ''; 
    const isVideo = typeof rawPath === 'string' && (rawPath.includes('.mp4') || rawPath.includes('subfolder=video')); 
    const isImage = hasMedia && !isVideo; // (isAudio 已经在外部被检查为 false)
    const canAddToStitch = hasMedia && (isImage || isVideo); //
    const promptText = (d.parameters)? ( d.parameters.positive_prompt|| d.parameters.text) : null; 
    const hasPrompt = typeof promptText === 'string' && promptText.trim() !== ''; 
    const isPureTextNode = !hasMedia && hasPrompt;

    // --- 2. 创建卡片基础 ---
    const fo = gEl.append('foreignObject') 
      .attr('width', d.calculatedWidth)
      .attr('height', d.calculatedHeight)
      .attr('x', -d.calculatedWidth / 2)
      .attr('y', -d.calculatedHeight / 2)
      .style('overflow', 'visible');

    const card = fo.append('xhtml:div') //
      .attr('class', 'node-card')
      .style('width', '100%')
      .style('height', '100%')
      .style('display', 'flex').style('flex-direction', 'column')
      .style('border-width', '2px')
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff');

    // 边框和选中样式
    const border =
      d.status === 'running' ? '#3b82f6' :
      d.status === 'success' ? '#22c55e' :
      d.status === 'error'   ? '#ef4444' : '#d1d5db';
    card.style('border-color', border);
    card.style('border-radius',isPureTextNode? '50%' : '8px');
    card.style('box-shadow', selectedIds.includes(d.id) ? '0 0 0 3px #3b82f6' : 'none');

    // 选中逻辑
    card.on('click', (ev) => {
      if (isPureTextNode && ev.target && ev.target.closest && ev.target.closest('.text-content-wrapper')) return;
      if (ev.target && ev.target.closest && ev.target.closest('button, img, video, .prompt-div-inner')) return;
      ev.stopPropagation();
      const selected = new Set(selectedIds);
      const on = selected.has(d.id);
      if (on) selected.delete(d.id);
      else if (selected.size < 2) selected.add(d.id);
      card.style('box-shadow', on ? 'none' : '0 0 0 3px #3b82f6');
      emit('update:selectedIds', Array.from(selected));
    });

    // Hover 事件
    card.on('mouseenter', function () {
      d3.select(this).selectAll('.add-clip-btn, .dots-container').style('opacity', '1')
    }).on('mouseleave', function () {
      d3.select(this).selectAll('.add-clip-btn, .dots-container').style('opacity', '0')
    });

    // --- 3. 卡片 Header ---
    const header = card.append('xhtml:div') //
      // ... (header 样式) ...
      .style('display', 'flex')
      .style('justify-content', 'space-between')
      .style('align-items', 'center')
      .style('padding', '1px 4px')
      .style('border-bottom', '1px solid #e5e7eb')
      .style('flex-shrink', '0')
      .style('justify-content', isPureTextNode ? 'center' : 'space-between'); 

    header.append('xhtml:h3') //
      .style('font-size', '8px').style('font-weight', '700').style('color', '#1f2937')
      .style('overflow', 'hidden').style('text-overflow', 'ellipsis').style('white-space', 'nowrap')
      .style('min-width','0')
      .text(d.module_id || '(节点)');

    header.append('xhtml:button') //
      .style('background-color', '#fff')
      .style('color', '#E4080A')
      .style('border-radius', '50%').style('border', 'none')
      .style('width', '16px').style('height', '16px').style('font-size', '16px').style('line-height', '16px')
      .style('cursor', 'pointer').style('flexShrink', '0')
      .html('&#xD7;')
      .on('mousedown', (ev) => ev.stopPropagation())
      .on('click', (ev) => { ev.stopPropagation(); emit('delete-node', d.id) }); //

    // --- 4. 标准 Content (图片/视频/文本) ---
    const content = card.append('xhtml:div')
      .style('flex-grow', '1')
      .style('flex-shrink', '1')
      .style('min-height', '0')
      .style('position', 'relative')
      .style('overflow', 'hidden');

    if (hasMedia) {
      content.style('height', '100px');
      content.style('flex-grow', '0');
      content.style('flex-shrink', '0');

      if (isVideo) { //
        const v = content.append('xhtml:video')
          // ... (video 样式) ...
          .style('width', '100%').style('height', '100%').style('object-fit', 'contain').style('display', 'block')
          .attr('muted', true).attr('playsinline', true).attr('preload', 'metadata')
          .on('mousedown', (ev) => ev.stopPropagation())
          .on('click', (ev) => { ev.stopPropagation(); emit('open-preview', mediaUrl, d.media.type) }) //
        const el = v.node()
        el.autoplay = true; el.loop = true; el.muted = true; el.playsInline = true; el.src = mediaUrl
      } else { // Image
        content.append('xhtml:img') //
          // ... (img 样式) ...
          .style('width', '100%').style('height', '100%').style('object-fit', 'contain').style('display', 'block')
          .attr('src', mediaUrl).attr('alt', d.module_id || 'thumb')
          .on('mousedown', (ev) => ev.stopPropagation())
          .on('click', (ev) => { ev.stopPropagation(); emit('open-preview', mediaUrl, d.media.type) }) //
      }
    } else if (hasPrompt) { //
      // 纯文本节点
       content
        .attr('class', 'text-content-wrapper') // <-- 【新增】给文本内容加个 class
        .style('overflow-y', 'auto').style('padding', '4px')
        .style('font-size', '10px').style('color', '#374151')
        .style('white-space', 'pre-wrap').style('word-break', 'break-all')
        .style('height', isPureTextNode ? 'calc(100% - 24px)' : null) // 【新增】文本节点内容区高度
        .style('display', 'flex') // 【新增】
        .style('align-items', 'center') // 【新增】
        .style('justify-content', 'center') // 【新增】
        .on('mousedown', (ev) => ev.stopPropagation())
      content.append('xhtml:div').text(promptText); //
    } else { //
      // "无缩略图"
      content.style('height', '100px');
      content.style('flex-grow', '0');
      content.style('flex-shrink', '0');
      content.append('xhtml:div')
        .style('width', '100%').style('height', '100%')
        .style('display', 'flex').style('align-items', 'center').style('justify-content', 'center')
        .style('font-size', '12px').style('color', '#6b7280').text('无缩略图'); //
    }

    // --- 5. 右上角三色按钮 (附加到 content) ---
    const dots = content.append('xhtml:div') //
      .attr('class', 'dots-container')
      .style('position', 'absolute') //
      // ... (dots 样式) ...
      .style('display', 'flex').style('flex-direction', 'column')
      .style('align-items', 'center').style('justify-content', 'center')
      .style('opacity', '0').style('transition', 'opacity 0.15s ease-in-out')
      .style('z-index', '10').style('top', '4px').style('right', '4px'); //

    const buttonTypes = (d.module_id === 'AddText') ? ['red', 'yellow', 'green', 'audio'] : ['red', 'yellow', 'green']; //
    buttonTypes.forEach((key, idx) => { //
      const info = workflowTypes[key];
      if (!info) { console.warn(`WorkflowType "${key}" is not defined.`); return; } //
      dots.append('xhtml:button') //
        // ... (button 样式) ...
        .style('background-color', info.color)
        .style('width', '16px').style('height', '16px').style('border-radius', '50%')
        .style('border', 'none').style('padding', '0').style('cursor', 'pointer')
        .style('transition', 'transform 0.15s ease-in-out')
        .style('margin-top', idx > 0 ? '4px' : '0')
        .attr('title', `Start ${info.type} workflow`)
        .on('mouseenter', function () { d3.select(this).style('transform', 'scale(1.25)') })
        .on('mouseleave', function () { d3.select(this).style('transform', 'scale(1)') })
        .on('mousedown', (ev) => ev.stopPropagation())
        .on('click', (ev) => { ev.stopPropagation(); emit('open-generation', d, info.defaultModuleId, info.type) }); //
    });

    // --- 6. Prompt 区 (若有) ---
    if (hasMedia && hasPrompt) { //
      const promptDiv = card.append('xhtml:div')
        .attr('class', 'prompt-div-inner')
        // ... (promptDiv 样式) ...
        .style('flex-grow', '1').style('flex-shrink', '1').style('min-height', '0')
        .style('overflow-y', 'auto').style('padding', '4px')
        .style('border-top', '1px solid #e5e7eb')
        .style('font-size', '10px').style('color', '#374151')
        .style('white-space', 'pre-wrap').style('word-break', 'break-all')
        .on('mousedown', (ev) => ev.stopPropagation());
      promptDiv.append('xhtml:div').text(promptText); //
    }

    // --- 7. Footer (▶ 按钮) ---
    if(!isPureTextNode){
      const footer = card.append('xhtml:div') //
        .style('display', 'flex').style('justify-content', 'flex-end')
        .style('padding', '2px');

      if (canAddToStitch) { //
        footer.append('xhtml:button')
          .attr('class', 'add-clip-btn')
          .html('&#9658;')
          // ... (footer button 样式) ...
          .style('opacity', '0').style('transition', 'opacity 0.15s ease-in-out')
          .style('width', '20px').style('height', '20px')
          .style('display', 'flex').style('align-items', 'center').style('justify-content', 'center')
          .style('color', '#3b82f6').style('font-size', '1.125rem')
          .style('border', 'none').style('background-color', 'transparent').style('padding', '0')
          .style('cursor', 'pointer')
          .on('mousedown', (ev) => ev.stopPropagation())
          .on('click', (ev) => { ev.stopPropagation(); emit('add-clip', d, isVideo ? 'video' : 'image') }); //
      }
    }

    // --- 8. 收缩/展开按钮 ---
    addCollapseButton(gEl, d, allNodesData, emit); //

    // --- 9. Tooltip ---
    addTooltip(gEl, d); //
  }

  /**
   * (辅助) 添加 Tooltip
   */
  function addTooltip(gEl, d) {
    const titleText = //
      (d.module_id || '') +
      (d.created_at ? (' · ' + d.created_at) : '') +
      (d.status ? (' · ' + d.status) : '');
    gEl.attr('title', titleText); //
  }

  /**
   * (辅助) 添加收缩按钮
   */
  function addCollapseButton(gEl, d, allNodesData, emit) {
    const card = gEl.select('.node-card');
    if (card.empty()) return;

    // (计算 hasChildren)
    const tempMap = new Map(allNodesData.map(n => [n.id, { ...n, children: [] }]))
    allNodesData.forEach(n => {
      if (n.originalParents) n.originalParents.forEach(p => tempMap.get(p)?.children.push(n))
    })
    const hasChildren = !!(tempMap.get(d.id) && tempMap.get(d.id).children.length)

    if (hasChildren) { //
      card.append('xhtml:button')
        .attr('class', 'collapse-btn')
        // ... (collapse button 样式) ...
        .style('position', 'absolute').style('bottom', '8px').style('left', '0')
        .style('background-color', '#ffffff')
        .style('color', d._collapsed ? '#E4080A' : '#9ca3af')
        .style('border-radius', '50%')
        .style('width', '16px').style('height', '16px').style('fontSize', '16px')
        .style('lineHeight', '16px').style('textAlign', 'center').style('fontWeight', '700')
        .style('zIndex', '10').style('border', 'none').style('cursor', 'pointer')
        .style('transition', 'background-color 0.15s ease-in-out')
        .style('transform', 'translate(-25%, 25%)')
        .text(d._collapsed ? '+' : '-') //
        .on('mouseenter', function () { d3.select(this).style('background-color', '#ffffff') }) //
        .on('mouseleave', function () { d3.select(this).style('background-color', '#ffffff') }) //
        .on('mousedown', (ev) => ev.stopPropagation()) //
        .on('click', (ev) => { ev.stopPropagation(); emit('toggle-collapse', d.id) }); //
    }
  }

  // --- 【重构】结束：主循环，根据 isAudio 分配渲染函数 ---
  nodeSel.each(function (d) {
    const gEl = d3.select(this)

    // 1. Init 特例
    if (d.module_id === 'Init') {
      gEl.append('circle').attr('r', 30).attr('fill', '#fff').attr('stroke', '#6b7280').attr('stroke-width', 2)
      gEl.append('text')
        .attr('text-anchor', 'middle').attr('dy', '0.35em')
        .style('font-size', '14px').style('fill', '#6b7280').style('pointer-events', 'none')
        .text('Init')
      gEl.style('cursor', 'pointer')
        .on('click', (ev) => { //
          ev.stopPropagation()
          const selected = new Set(selectedIds)
          if (selected.has(d.id)) selected.delete(d.id)
          else if (selected.size < 2) selected.add(d.id)
          emit('update:selectedIds', Array.from(selected))
        })

      // 【添加】Init 节点的 "Add Text" 按钮 (来自您之前的请求)
      const btnFo = gEl.append('foreignObject')
        .attr('width', 60).attr('height', 30)
        .attr('x', 35).attr('y', -15)
        .style('overflow', 'visible');
      btnFo.append('xhtml:button')
        .style('background-color', '#f3f4f6').style('border', '1px solid #d1d5db')
        .style('color', '#374151').style('border-radius', '6px')
        .style('width', '100%').style('height', '100%')
        .style('font-size', '12px').style('font-weight', '600')
        .style('cursor', 'pointer')
        .style('display', 'flex').style('align-items', 'center').style('justify-content', 'center')
        .html('+ Text')
        .on('mousedown', (ev) => ev.stopPropagation())
        .on('click', (ev) => {
          ev.stopPropagation();
          emit('open-generation', d, 'AddText', 'util');
        });
      return; //
    }

    // 2. 检查节点类型
    const hasMedia = !!(d.media && d.media.rawPath); //
    const rawPath = hasMedia ? d.media.rawPath : ''; //
    const isAudio = typeof rawPath === 'string' && (rawPath.includes('.mp3') || rawPath.includes('.wav') || rawPath.includes('subfolder=audio')); //

    // 3. 根据类型调用不同的渲染函数
    if (isAudio) {
      renderAudioNode(gEl, d, selectedIds, emit, workflowTypes);
    } else {
      renderStandardNode(gEl, d, selectedIds, emit, workflowTypes);
    }
  })
}
