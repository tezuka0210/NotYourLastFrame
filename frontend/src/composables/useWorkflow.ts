// /frontend/src/composables/useWorkflow.ts

import { color } from 'd3'
import { ref, reactive } from 'vue'

// --- 1. 常量定义 ---
const DB_API_GET_URL = '/api/trees/1'
const DB_API_POST_URL = '/api/nodes'
const ASSET_UPLOAD_URL = '/api/assets/upload'
const STITCH_API_URL = '/api/stitch'
const DELETE_API_URL = '/api/nodes'
const COMFYUI_URL = 'http://223.193.6.178:8188' 

export const workflowTypes = {
  red: { type: 'preprocess', defaultModuleId: 'ImageCanny', color: '#ef4444' }, // Red-500
  yellow: { type: 'image', defaultModuleId: 'TextGenerateImage', color: '#f59e0b' }, // Amber-500
  green: { type: 'video', defaultModuleId: 'TextGenerateVideo', color: '#10b981' }, // Emerald-500
  audio: {type:'audio', defaultModuleId:'TextToAudio',color:'#3b82f6'}
};
const defaultLinkColor = '#9ca3af'; // Gray-400

// /frontend/src/composables/useWorkflow.ts
const moduleIdToColor = {
  'ImageCanny': workflowTypes.red.color, 
  'ImageMerging': workflowTypes.red.color,
  'RemoveBackground': workflowTypes.red.color,
  'TextGenerateImage': workflowTypes.yellow.color,
  'ImageGenerateImage_Basic': workflowTypes.yellow.color,
  'ImageGenerateImage_Canny': workflowTypes.yellow.color,
  'PartialRepainting': workflowTypes.yellow.color,
  'ImageHDRestoration': workflowTypes.yellow.color,
  'Put_It_Here': workflowTypes.yellow.color,
  'TextGenerateVideo': workflowTypes.green.color,
  'ImageGenerateVideo': workflowTypes.green.color,
  'CameraControl': workflowTypes.green.color,
  'FLFrameToVideo': workflowTypes.green.color,
  'FrameInterpolation': workflowTypes.green.color,
  // Add mappings for ALL your module IDs
};

// --- 2. TypeScript 类型定义 ---

// 后端数据库返回的原始 Node 结构
interface DbNode {
  node_id: string;
  parent_id: string | string[] | null; // 父ID可以是 null, string, 或 string[]
  tree_id: number;
  module_id: string;
  parameters: Record<string,any> | null; // JSON string
  assets: Record<string,any> | null;     // JSON string
  status: string;
  created_at: string;
}

// 原始 assets 字段 JSON 解析后的结构
interface AssetDetails {
  images?: string[];
  videos?: string[];
  audio?: string[];
  // ... 其他可能的资产
}

// 媒体文件的统一结构
interface AssetMedia {
  rawPath: string; // 相对路径 (用于 API)
  url: string;     // 完整 URL (用于 <img> <video>)
  type: 'image' | 'video' | 'audio';
}

// 经过前端处理后，用于 D3 渲染和 App 内部使用的 Node 结构
export interface AppNode {
  id: string;
  //parent_id: string | null; // 简化：只取第一个父节点用于 D3 树状布局
  originalParents: string[] | null;
  module_id: string;
  created_at: string;
  status: string;
  media: AssetMedia | null; // 处理后的第一个媒体文件
  // originalParents: string | string[] | null; // (可选) 保留原始父ID信息
  linkColor?:string;
  _collapsed?: boolean;
  parameters: Record<string, any> | null;
}

// 拼接序列中片段的类型
export interface ImageClip {
  nodeId: string;
  mediaPath: string; // 原始相对路径
  thumbnailUrl: string;
  type: 'image';
  duration: number; // 图片的时长
}

export interface VideoClip {
  nodeId: string;
  mediaPath: string; // 原始相对路径
  thumbnailUrl: string;
  duration:number
  type: 'video';
  //startTime: number;
  //endTime: number;
  //totalDuration: number;
}
export interface AudioClip {
  nodeId: string;
  mediaPath: string;
  thumbnailUrl: string;
  duration:number
  type: 'audio';
}


// 使用 "可辨识联合类型" (Discriminated Union)
export type StitchingClip = ImageClip | VideoClip;

// 预览弹窗的状态
interface PreviewMedia {
  url: string;
  type: 'image' | 'video' | 'audio';
}


// --- 3. Composable 函数 ---

export function useWorkflow() {

  // --- 4. 响应式状态 (State) ---

  // 全局状态
  const statusText = ref('正在初始化...')
  const isLoadingTree = ref(false)
  const isGenerating = ref(false)
  const isStitching = ref(false)

  // 节点数据
  const allNodes = ref<AppNode[]>([]) // D3 将会监听这个
  const rootNodeId = ref<string | null>(null)
  const selectedParentIds = ref<string[]>([]) // 选中的父节点

  // 视频拼接
  const stitchingClips = reactive<StitchingClip[]>([])
  const audioClips = reactive<AudioClip[]>([])

  // 预览弹窗
  const isPreviewOpen = ref(false)
  const previewMedia = reactive<PreviewMedia>({ url: '', type: 'image' })


  // --- 5. 内部辅助函数 (Helpers) ---

  /** 更新顶部状态栏文本 */
  function showStatus(text: string) {
    statusText.value = text
  }

  /** 解析 DB 传来的 assets 字段 (可能为 null 或 JSON 字符串) */
  function parseAssetsField(assetsObject: AssetDetails | null): AssetDetails | null {
    if (!assetsObject) return null
    return assetsObject;
  }

  /** 从解析后的 assets 对象中获取第一个媒体文件 */
  function firstMediaFromAssets(assets: AssetDetails | null): { path: string; type: 'image' | 'video' |'audio'} | null {
    if (!assets) return null;
    // (v91 修复)
    // 检查 .mp4，因为后端 可能把视频放进 images
    const imgs = assets.images || [];
    const vids = assets.videos || [];
    const auds = assets.audio || [];
    // (v91) 优先检查视频
    if (Array.isArray(vids) && vids.length > 0) {
      if (vids[0]) return { path: vids[0], type: 'video' };
    }
    // 检查音频
    if (Array.isArray(auds) && auds.length > 0) {
      if (auds[0]) return { path: auds[0], type: 'audio' };
    }
    // (v91) 其次检查图片
    if (Array.isArray(imgs) && imgs.length > 0) {
      if (imgs[0]) {
        // (v91 关键逻辑) 检查这个 "image" 是不是 .mp4
        const isVideo = (typeof imgs[0] === 'string') && (imgs[0].includes('.mp4') || imgs[0].includes('subfolder=video'));
        return { path: imgs[0], type: isVideo ? 'video' : 'image' };
      }
    }
    
    return null;
  }
  
  /** 将相对路径转换为完整的 ComfyUI URL */
  function makeFullUrl(path: string | null): string | null {
    if (!path) return null
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    const cleanPath = path.startsWith('/') ? path : '/' + path
    return cleanPath  /*COMFYUI_URL + */
  }

  /** 异步获取视频时长 */
  function getVideoDuration(videoUrl: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        resolve(video.duration)
      }
      video.onerror = (e) => {
        reject(new Error('视频元数据加载失败'))
      }
      video.src = videoUrl
    })
  }

  /** * (重要)
   * 此函数替换了原版 processAndRenderTree。
   * 它只负责处理数据，不负责 D3 渲染。
   * D3 渲染由 WorkflowTree.vue 组件通过 watch(allNodes) 来触发。
   */
  function processTreeData(nodes: DbNode[], statusMessage: string) {
    if (!nodes) {
      console.error('接收到的节点数据无效:', nodes)
      showStatus('错误：无法处理或渲染树数据。')
      return
    }

    const root = nodes.find(n => n.parent_id === null)
    rootNodeId.value = root ? root.node_id : null

    // 将 DbNode 转换为 AppNode
    const processedNodes: AppNode[] = nodes.map(n => {
       if (n.module_id === 'TextToAudio') { // 只打印音频节点，保持控制台干净
        console.log('--- 正在检查音频节点 ---', n.assets);
      }
      const parsedAssets = parseAssetsField(n.assets)
      const firstMedia = firstMediaFromAssets(parsedAssets)
      const media = firstMedia
        ? {
          rawPath: firstMedia.path,
          url: makeFullUrl(firstMedia.path)!, // 我们断言它非 null，因为 path 存在
          type: firstMedia.type
        }
        : null

      // D3 树状图只支持单个父节点，我们取第一个
      //const firstParentId = Array.isArray(n.parent_id) ? n.parent_id[0] : n.parent_id
       // (Core Change 5) Assign linkColor based on module ID
      const linkColor = moduleIdToColor[n.module_id as keyof typeof moduleIdToColor];

       let originalParents: string[] | null = null;
      if (Array.isArray(n.parent_id)) {
        originalParents = n.parent_id.length > 0 ? n.parent_id : null;
      } else if (n.parent_id) { // 如果是单个字符串
        originalParents = [n.parent_id];
      }
      return {
        id: n.node_id,
        //parent_id: firstParentId || null,
        originalParents: originalParents,
        module_id: n.module_id,
        created_at: n.created_at,
        status: n.status,
        media: media,
        linkColor: linkColor,
        _collapsed: false,
        parameters:n.parameters
      }
    })

    allNodes.value = processedNodes // (核心) 更新响应式状态
    showStatus(statusMessage || '点击节点可设为父节点，点击缩略图可预览。')
  }

    /** (新) 切换节点的收缩状态 */


function toggleNodeCollapse(nodeId: string) {
  const node = allNodes.value.find(n => n.id === nodeId);
  if (!node) return;
  // 原地改，数组引用不变
  node._collapsed = !node._collapsed;
  console.log(`[parent] 节点 ${nodeId} -> _collapsed = ${node._collapsed}`);
}

  // --- 6. 导出的逻辑函数 (Actions) ---

  /** (Action) 从数据库加载和渲染整棵树 */
  async function loadAndRender() {
    isLoadingTree.value = true
    showStatus('正在从数据库加载作品...')
    try {
      const res = await fetch(DB_API_GET_URL)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const treeData: { nodes: DbNode[] } = await res.json()

      if (!treeData.nodes || treeData.nodes.length === 0) {
        showStatus('数据库中没有找到任何节点。请在右侧开始您的第一次生成。')
        allNodes.value = []
        return
      }
      processTreeData(treeData.nodes, '加载完成。')
    } catch (err: any) {
      console.error(err)
      showStatus('加载失败: ' + err.message)
    } finally {
      isLoadingTree.value = false
    }
  }

  /** (Action) 处理文件上传 (由 WorkflowForm.vue 调用) */
  async function handleFileUpload(file: File) {
    if (!file) return

    isGenerating.value = true; // 借用生成按钮的 loading 状态
    showStatus('正在上传图片并创建节点...')

    const formData = new FormData()
    formData.append('file', file)

    // 确定父节点
    let parentIdQuery = ''
    let currentParentId = (selectedParentIds.value.length > 0 ? selectedParentIds.value[selectedParentIds.value.length - 1] : null) || rootNodeId.value || null
    if (currentParentId) {
      parentIdQuery = `&parent_id=${currentParentId}`
    }
    const uploadUrl = `${ASSET_UPLOAD_URL}?tree_id=${1}${parentIdQuery}` // 假设 tree_id 总是 1

    try {
      const response = await fetch(uploadUrl, { method: 'POST', body: formData })
      if (!response.ok) { const errText = await response.text(); throw new Error(`上传失败: ${errText}`) }

      const updatedTree: { nodes: DbNode[] } = await response.json() // 后端返回更新后的树
      processTreeData(updatedTree.nodes, '上传成功！新节点已添加到历史树。')

      // (可选) 自动选中新节点
      // const newUploadNode = findLatestUploadNode(updatedTree.nodes);
      // if (newUploadNode) {
      //   selectedParentIds.length = 0; // 清空
      //   selectedParentIds.push(newUploadNode.node_id); // 选中
      // }
    } catch (error: any) {
      console.error("处理上传失败:", error)
      alert(`上传失败: ${error.message}`)
      showStatus('上传失败，请重试。')
    } finally {
      isGenerating.value = false
      // 注意：清空 <input type="file"> 的值需要由组件自己完成
    }
  }

  /** (Action) 开始生成新节点 (由 WorkflowForm.vue 调用) */
  async function handleGenerate(moduleId: string, parameters: Record<string, any>) {
    isGenerating.value = true
    showStatus('开始生成...')

    try {
      let parentIds = [...selectedParentIds.value] // 复制
      if (parentIds.length === 0 && allNodes.value.length > 0 && rootNodeId.value) {
        // (策略) 如果未选择，自动使用根节点 (如果存在)
        // parentIds.push(rootNodeId.value)
        // (或者) 策略：未选择时，创建新的根节点
        // parentIds = []
      }
      // (校验) 可以在这里添加原版的校验逻辑
      if ((moduleId === 'ImageGenerateImage_Basic' || moduleId === 'ImageGenerateVideo') && parentIds.length === 0) {
        alert('此模块需要输入图像/视频，请先选择一个包含媒体的父节点。')
        throw new Error('缺少父节点提供输入媒体')
      }
      if (moduleId === 'ImageMerging' && parentIds.length !== 2) {
        alert('图像合并模块需要选择两个父节点。')
        throw new Error('图像合并需要两个父节点')
      }

      const payload = {
        tree_id: 1, // 假设 tree_id 总是 1
        parent_ids: parentIds,
        module_id: moduleId,
        parameters: parameters
      }

      const response = await fetch(DB_API_POST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) { const errText = await response.text(); throw new Error(`生成失败: ${errText}`) }

      const updatedTree: { nodes: DbNode[] } = await response.json()
      processTreeData(updatedTree.nodes, '生成完成！新节点已添加到历史树。')
      // (重要) 生成后清空选择
      selectedParentIds.value.length = 0

    } catch (error: any) {
      console.error(error)
      if (!['缺少父节点', '需要两个父节点'].some(msg => error.message.includes(msg))) {
        alert(error.message)
      }
      showStatus('生成失败，请检查参数或父节点选择。')
    } finally {
      isGenerating.value = false
    }
  }

  /** (Action) 删除一个节点 (由 WorkflowTree.vue 调用) */
  async function handleDeleteNode(nodeId: string) {
    // 1. 向用户确认
    const confirmMsg = `您确定要删除这个节点吗？\n\n警告：这也会从数据库中删除所有依赖此节点的子孙节点！`
    if (!confirm(confirmMsg)) {
      return
    }

    isGenerating.value = true; // 借用 loading 状态
    showStatus(`正在删除节点 ${nodeId.substring(0, 8)}...`)

    try {
      const response = await fetch(`${DELETE_API_URL}/${nodeId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`删除失败 (HTTP ${response.status}): ${errText}`)
      }

      // 6. 检查已删除的节点是否是当前选中的父节点
      const indexInSelection = selectedParentIds.value.indexOf(nodeId)
      if (indexInSelection > -1) {
        selectedParentIds.value.splice(indexInSelection, 1)
      }

      // 7. (重要) 后端删除成功，调用 loadAndRender 重新加载整个树
      await loadAndRender() // 这会重新获取并刷新 allNodes.value
      showStatus('节点删除成功。')

    } catch (error: any) {
      console.error("删除节点时出错:", error)
      alert(`删除失败: ${error.message}`)
      showStatus('删除失败，请重试。')
    } finally {
      isGenerating.value = false
    }
  }


  // --- 7. 导出的拼接相关函数 (Actions) ---

  /** (Action) 添加一个片段到拼接序列 (由 WorkflowTree.vue 调用) */
  async function addClipToStitch(node: AppNode, type: 'image' | 'video' | 'audio') {
    if (!node.media || !node.media.rawPath) return
    // if (stitchingClips.some(clip => clip.nodeId === node.id)) {
    //   alert('该片段已在拼接序列中。')
    //   return
    // }
    console.log(`[addClipToStitch]接收到类型：${type}`)
    try {
      if (type === 'audio'){
        const audioDuration = await getVideoDuration(node.media.url)
        audioClips.push({
          nodeId: node.id,
          mediaPath: node.media.rawPath,
          thumbnailUrl: node.media.url,
          type: 'audio',
          duration: audioDuration,
        })
        console.log(`[addClipToStitch]成功推送到'audioClips', A1轨道现在有:`,audioClips.length,"个剪辑")
      }else if (type === 'video') {
        const videoDuration = await getVideoDuration(node.media.url)
        stitchingClips.push({
          nodeId: node.id,
          mediaPath: node.media.rawPath,
          thumbnailUrl: node.media.url,
          type: 'video',
          duration: videoDuration,
        })
        console.log(`[addClipToStitch]成功推送到'stitchingClips'`)
      } else {
        stitchingClips.push({
          nodeId: node.id,
          mediaPath: node.media.rawPath,
          thumbnailUrl: node.media.url,
          type: 'image',
          duration: 3.0 // 默认 3 秒
        })
        console.log(`[addClipToStitch]成功推送到'stitchingClips'`)
      }
    } catch (error: any) {
      console.error("添加片段时出错:", error)
      alert("无法加载视频元数据，添加失败。")
    }
  }

  /** (Action) 从拼接序列中移除片段 (由 StitchingPanel.vue 调用) */
  function removeClipFromStitch(index: number) {
    stitchingClips.splice(index, 1)
  }
  function removeClipFromAudio(index: number){
    audioClips.splice(index, 1)
  }

  /** (Action) 请求后端拼接视频 (由 StitchingPanel.vue 调用) */
  async function handleStitchRequest() {
    if (stitchingClips.length < 1) {
      alert('请至少添加一个片段进行拼接。')
      return
    }
    isStitching.value = true
    showStatus('正在请求后端拼接...')
    // --- 【调试】---
    console.log("--- [Stitch Request] 准备发送 ---");
    console.log("V1 (video) 轨道内容:", JSON.stringify(stitchingClips));
    console.log("A1 (audio) 轨道内容:", JSON.stringify(audioClips));
    // --- 【调试】---
    // StitchingPanel.vue 应该自己显示结果, 这里只更新 status
    // 准备要发送的数据
    const clipsData = stitchingClips.map(clip => {
      if (clip.type === 'image') {
        return { path: clip.mediaPath, type: clip.type, duration: clip.duration }
      } else { // 'video'
        return { path: clip.mediaPath, type: clip.type, duration: clip.duration }
      }
    })
    const audioClipsData = audioClips.map(clip => {
      return { path: clip.mediaPath, type: clip.type, duration: clip.duration }
    })
    // --- 【调试】---
    const payload = { 
        clips: clipsData, 
        audio_clips: audioClipsData 
    }
    console.log("发送到后端的 Payload:", payload);
    // --- 【调试】---

    try {
      const response = await fetch(STITCH_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ 
          clips: clipsData, 
          audio_clips: audioClipsData // <-- 新增的键
        })
      })

      if (!response.ok) { const errText = await response.text(); throw new Error(`拼接失败: ${errText}`) }
      const result = await response.json()
      if (result.output_url) {
        showStatus('拼接完成！')
        // (重要) 返回结果，让组件去显示
        return result.output_url
      } else {
        throw new Error('后端未返回有效的输出URL')
      }
    } catch (error: any) {
      console.error(error)
      showStatus(`错误: ${error.message}`)
      alert(error.message)
      return null // 返回 null 表示失败
    } finally {
      isStitching.value = false
    }
  }


  // --- 8. 导出的弹窗函数 (Actions) ---

  /** (Action) 打开预览弹窗 (由 WorkflowTree.vue 调用) */
  function openPreview(mediaUrl: string, type: 'image' | 'video'|'audio') {
    previewMedia.url = mediaUrl
    previewMedia.type = type
    isPreviewOpen.value = true
  }

  /** (Action) 关闭预览弹窗 (由 PreviewModal.vue 调用) */
  function closePreview() {
    isPreviewOpen.value = false
    previewMedia.url = '' // 清理
  }


  // --- 9. 返回 (Return) ---
  // 导出所有组件需要用到的 状态 和 函数
  return {
    // 状态 (State)
    statusText,
    isLoadingTree,
    isGenerating,
    isStitching,
    allNodes,
    selectedParentIds,
    stitchingClips,
    audioClips,
    isPreviewOpen,
    previewMedia,

    // 函数 (Actions)
    loadAndRender,
    handleGenerate,
    handleFileUpload,
    handleDeleteNode,
    addClipToStitch,
    removeClipFromStitch,
    removeClipFromAudio,
    handleStitchRequest,
    openPreview,
    closePreview,
    toggleNodeCollapse,
  }
}