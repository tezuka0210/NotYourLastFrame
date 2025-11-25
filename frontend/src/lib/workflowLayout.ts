// src/lib/workflowLayout.ts
import App from '@/App.vue'
import type { AppNode } from '@/composables/useWorkflow'

// 三种卡片类型（后面可以再细分）
export type CardType = 'init' | 'textFull' | 'audio' | 'io'

// D3 实际使用的节点结构 = AppNode + UI 元数据
export interface ViewNode extends AppNode {
  cardType: CardType
  title: string          // 卡片标题栏显示的文字
  isInit: boolean        // 是否是根/初始卡
}

// 根据 AppNode 判定 cardType
function inferCardType(node: AppNode): CardType {
  // 1) 根节点：没有 originalParents
  if (!node.originalParents || node.originalParents.length === 0) {
    return 'init'
  }

  // 2) 纯文本提示词卡
  if (node.module_id === 'AddText') {
    return 'textFull'
  }

  // 3) 音频卡
  if (node.module_id === 'TextToAudio') {
    return 'audio'
  }

  // 4) 其他默认当作 IO 卡（左右分栏：输入/输出）
  return 'io'
}

// 构造显示标题（现在先用 module_id 占位）
function buildTitle(node: AppNode): string {
  if (!node.originalParents || node.originalParents.length === 0) {
    return 'Init'
  }
  // 之后可以接你在 useWorkflowForm 里定义的 name
  return node.module_id
}

// 对外暴露的主函数：把 AppNode[] 变成 ViewNode[]
export function buildWorkflowView(nodes: AppNode[]): ViewNode[] {
  return (nodes || []).map((n) => {
    const cardType = inferCardType(n)
    //console.log(`workflowLayout.ts ${cardType}`)
    return {
      ...n,
      cardType,
      title: buildTitle(n),
      isInit: !n.originalParents || n.originalParents.length === 0,
    }
  })
}
