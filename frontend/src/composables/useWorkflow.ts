// /frontend/src/composables/useWorkflow.ts

import { color } from 'd3'
import { ref, reactive } from 'vue'
// @ts-ignore 忽略类型检查报错
import { getPrevAgentContext } from '../lib/agentSharedState.js'

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
  input?: {          // 输入类型资源
    images?: string[];
    videos?: string[];
    audio?: string[];
  };
  output?: {         // 输出类型资源
    images?: string[];
    videos?: string[];
    audio?: string[];
  };
}

// 媒体文件的统一结构
interface AssetMedia {
  rawPath: string; // 相对路径 (用于 API)
  url: string;     // 完整 URL (用于 <img> <video>)
  type: 'image' | 'video' | 'audio';
  source: 'input' | 'output'; 
}

// 经过前端处理后，用于 D3 渲染和 App 内部使用的 Node 结构
export interface AppNode {
  id: string;
  //parent_id: string | null; // 简化：只取第一个父节点用于 D3 树状布局
  originalParents: string[] | null;
  module_id: string;
  created_at: string;
  status: string;
  media: AssetMedia[] | null; // 处理后的第一个媒体文件
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

// 运输带中的 clip，可以包含三种
export type BufferClip = ImageClip | VideoClip | AudioClip;

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

  // 上方“运输带 / 缓冲区”
  const bufferClips = reactive<BufferClip[]>([])

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
    if (!nodes) return;
    const processedNodes: AppNode[] = nodes.map(n => {
      const parsedAssets = parseAssetsField(n.assets);
      const media: AssetMedia[] = [];

      if (parsedAssets) {
        // 辅助函数：根据路径判断媒体类型（优先于字段名）
        const getMediaTypeByPath = (path: string): 'image' | 'video' | 'audio' => {
          //console.log(`processTreedata ${path}`)
          if (typeof path !== 'string') return 'image'; // 默认值
          // 视频识别：.mp4 后缀或 video 子文件夹
          if (path.includes('.mp4') || path.includes('subfolder=video')) {
            //console.log(`video video video video video`)
            return 'video';
          }
          // 音频识别：.mp3/.wav 后缀或 audio 子文件夹
          if (path.includes('.mp3') || path.includes('.wav') || path.includes('subfolder=audio')) {
            return 'audio';
          }
          // 其余视为图片
          return 'image';
        };

        const processMediaGroup = (group: { images?: string[], videos?: string[], audio?: string[] }, source: 'input' | 'output') => {
          if (!group) return;

          // 处理图片字段（可能包含错误归类的视频）
          group.images?.forEach(path => {
            if (path) {
              const type = getMediaTypeByPath(path); // 强制按路径判断
              media.push({
                rawPath: path,
                url: makeFullUrl(path)!,
                type: type,
                source: source
              });
            }
          });

          // 处理视频字段（正常视频）
          group.videos?.forEach(path => {
            if (path) {
              media.push({
                rawPath: path,
                url: makeFullUrl(path)!,
                type: 'video',
                source: source
              });
            }
          });

          // 处理音频字段（正常音频）
          group.audio?.forEach(path => {
            if (path) {
              media.push({
                rawPath: path,
                url: makeFullUrl(path)!,
                type: 'audio',
                source: source
              });
            }
          });
        };

        parsedAssets.input && processMediaGroup(parsedAssets.input, 'input');
        parsedAssets.output && processMediaGroup(parsedAssets.output, 'output');
      }

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
        parameters:n.parameters,
        assets:n.assets
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

  /** 更新现有节点的媒体资源（支持多文件） */
  async function updateNodeMedia(nodeId: string, file: File) {
    if (!nodeId || !file) return;

    isGenerating.value = true;
    showStatus(`正在更新节点媒体...`);

    const formData = new FormData();
    // 确保文件正确添加到FormData，参数名使用后端预期的"file"
    formData.append('file', file, file.name); // 显式指定文件名，增强兼容性
    
    try {
      const uploadResponse = await fetch(
        `/api/assets/upload?tree_id=1&target_node_id=${nodeId}`,
        { 
          method: 'POST', 
          body: formData,
          // 不要手动设置Content-Type，浏览器会自动添加正确的multipart/form-data类型及边界
        }
      );
      console.log(`formdata:${formData}`);
      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        throw new Error(`文件上传失败: ${errText}`);
      }

      // 2. 提取上传后的媒体URL
      const uploadResult = await uploadResponse.json();
      const targetNode = uploadResult.nodes.find((n: any) => n.node_id === nodeId);
      if (!targetNode || !targetNode.assets?.input) {
        throw new Error('未获取到上传的媒体信息');
      }

      // 3. 调用PUT接口更新assets字段（保留所有类型的媒体）
      const updateResponse = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: 'TextImage',
          assets: targetNode.assets, // 直接使用后端返回的完整assets结构
          parameters: allNodes.value.find(n => n.id === nodeId)?.parameters
        })
      });
      console.log(`assets:${targetNode.assets}`);

      if (!updateResponse.ok) {
        const errText = await updateResponse.text();
        throw new Error(`节点更新失败: ${errText}`);
      }

      // 4. 刷新节点数据
      const updatedTree = await updateResponse.json();
      processTreeData(updatedTree.nodes, '节点媒体更新成功！');

    } catch (error: any) {
      console.error("更新节点媒体失败:", error);
      alert(`更新失败: ${error.message}`);
      showStatus('更新失败，请重试。');
    } finally {
      isGenerating.value = false;
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

      
    } catch (error: any) {
      console.error("处理上传失败:", error)
      alert(`上传失败: ${error.message}`)
      showStatus('上传失败，请重试。')
    } finally {
      isGenerating.value = false
      // 注意：清空 <input type="file"> 的值需要由组件自己完成
    }
  }

  /** (Action) 提交生成请求（仅传递参数，不处理业务逻辑） */
  async function handleGenerate(nodeId:string, moduleId: string, parameters: Record<string, any>,nodeTitle: string) {
    isGenerating.value = true;
    showStatus('正在提交生成请求...');

    try {
        // 1. 从共享工具中获取前一轮 Agent 上下文
      if(moduleId != "AddWorkflow"&& moduleId !=  "AddText"){
        const prevAgentContext = getPrevAgentContext();

        // 2. 调用后端轻量接口（仅跑 Final Prompt Agent）
        const promptResponse = await fetch('/api/agents/only-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            positive_prompt: parameters.positive_prompt, // 前端新传入的 prompt
            negative_prompt: parameters.negative_prompt,
            prev_agent_context: prevAgentContext||'' // 共享的前一轮上下文
          })
        });

        if (!promptResponse.ok) {
          const errText = await promptResponse.text();
          throw new Error(`Prompt 优化失败: ${errText}`);
        }

        const promptResult = await promptResponse.json();
        if (promptResult.status !== 'success') {
          throw new Error(`Prompt 优化异常: ${promptResult.message || '未知错误'}`);
        }

        const optimizedPrompt = promptResult.final_prompt;
        showStatus('Prompt 优化完成，正在提交生成请求...');
        console.log(`final_prompt:${optimizedPrompt}`)

          let parentIds = [...selectedParentIds.value] // 复制
        if (parentIds.length === 0 && allNodes.value.length > 0 && rootNodeId.value) {
        }
        // 2. 构建请求 payload（仅包含核心信息）
        const payload = {
          tree_id: 1,
          node_id: nodeId, // 目标节点ID
          title: nodeTitle,
          parent_ids: parentIds,
          module_id: moduleId,    // 要执行的模块
          parameters: {
            ...parameters,
            optimized_positive_prompt: optimizedPrompt.positive,
            optimized_negative_prompt: optimizedPrompt.negative,
          }
        };

        // 3. 调用后端 create_node 接口（由后端处理生成和数据库更新）
        const response = await fetch('/api/nodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`请求失败: ${errText}`);
        }

         // 4. 接收后端返回的更新后的数据并刷新视图
        const updatedTree: { nodes: DbNode[] } = await response.json();
        processTreeData(updatedTree.nodes, '生成操作完成');

      }else{
        let parentIds = [...selectedParentIds.value] // 复制
        if (parentIds.length === 0 && allNodes.value.length > 0 && rootNodeId.value) {
        }
        // 2. 构建请求 payload（仅包含核心信息）
        const payload = {
          tree_id: 1,
          node_id: nodeId, // 目标节点ID
          title: nodeTitle,
          parent_ids: parentIds,
          module_id: moduleId,    // 要执行的模块
          parameters: parameters,
        };
        // 3. 调用后端 create_node 接口（由后端处理生成和数据库更新）
        const response = await fetch('/api/nodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`请求失败: ${errText}`);
        }

         // 4. 接收后端返回的更新后的数据并刷新视图
        const updatedTree: { nodes: DbNode[] } = await response.json();
        processTreeData(updatedTree.nodes, '生成操作完成');

      }

    } catch (error: any) {
      console.error('生成请求处理失败:', error);
      alert(error.message || '生成失败，请重试');
      showStatus('生成失败');
    } finally {
      isGenerating.value = false;
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

  /** (Action) 添加一个片段到“运输带” (由 WorkflowTree.vue 调用) */
  async function addClipToStitch(node: AppNode, type: 'image' | 'video' | 'audio') {
    // 1. 检查 media 数组是否存在且不为空
    if (!node.media || node.media.length === 0) {
      console.warn(`[addClipToStitch] 节点 ${node.id} 没有可添加的媒体。`);
      return;
    }
    //console.log(`addClipToStitch:${node.media}`)
    // 2. 从 media 数组中查找我们想要的媒体
    //    这里我们优先选择 'output' 类型的媒体
    const targetMedia = node.media.find(media => media.source === 'output');

    // 3. 如果没有找到 output 媒体，可以选择第一个，或者直接返回
    if (!targetMedia) {
      console.warn(`[addClipToStitch] 节点 ${node.id} 没有找到 'output' 类型的媒体，将使用第一个可用媒体。`);
      // 或者直接 return; 如果必须要有 output 媒体的话
      // return; 
    }
    
    // 如果连第一个都没有（理论上不会发生）
    if (!targetMedia) {
      console.error(`[addClipToStitch] 节点 ${node.id} 媒体数组为空或无效。`);
      return;
    }

    console.log(`[addClipToStitch] 接收到类型：${type}，将添加媒体:`, targetMedia);

    try {
      // 注意：下面的代码都从 targetMedia 获取信息，而不是 node.media
      if (type === 'audio') {
        const audioDuration = await getVideoDuration(targetMedia.url);

        const waveformPath =
          (node.parameters && (node.parameters as any).waveform_image)
            ? (node.parameters as any).waveform_image
            : targetMedia.rawPath;

        const waveformUrl = makeFullUrl(waveformPath)!

        bufferClips.push({
          nodeId: node.id,
          mediaPath: targetMedia.rawPath,
          thumbnailUrl: waveformUrl,
          type: 'audio',
          duration: audioDuration,
        });

      } else if (type === 'video') {
        console.log(`video来了`)
        const videoDuration = await getVideoDuration(targetMedia.url);
        bufferClips.push({
          nodeId: node.id,
          mediaPath: targetMedia.rawPath,
          thumbnailUrl: targetMedia.url,
          type: 'video',
          duration: videoDuration,
        });

      } else { // image
        bufferClips.push({
          nodeId: node.id,
          mediaPath: targetMedia.rawPath,
          thumbnailUrl: targetMedia.url,
          type: 'image',
          duration: 3.0,
        });
      }
      console.log(`[addClipToStitch] 已推入 bufferClips (${type})，当前数量:`, bufferClips.length);

    } catch (error: any) {
      console.error('添加片段到 bufferClips 时出错:', error);
      alert('无法加载媒体元数据，添加失败。');
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
    bufferClips,
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
    updateNodeMedia,
  }
}