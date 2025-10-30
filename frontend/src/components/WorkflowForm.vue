<template>
  <div id="workflow-form" class="space-y-4">
    <div v-if="props.selectedIds.length === 0">
      <label class="block text-sm font-medium text-gray-600 mb-1">父节点</label>
      <input
        type="text"
        value="未选择 (将创建根节点)"
        class="w-full bg-gray-100 border border-gray-300 rounded-md p-2 text-gray-500 text-sm"
        readonly
      >
    </div>
    
    <div v-else-if="props.selectedIds.length === 1">
      <label class="block text-sm font-medium text-gray-600 mb-1">父节点:</label>
      <input
        type="text"
        :value="`节点: ${parentNode1Id?.substring(0, 8)}...`"
        class="w-full bg-gray-100 border border-gray-300 rounded-md p-2 text-gray-500 text-sm"
        readonly
      >
    </div>

    <div v-else-if="props.selectedIds.length === 2" class="space-y-2">
      <p v-if="moduleId === 'ImageMerging'" class="text-xs font-medium text-green-600">
        合并就绪
      </p>
      
      <div>
        <label class="block text-sm font-medium text-gray-600 mb-1">父节点 1:</label>
        <input
          type="text"
          :value="`节点: ${parentNode1Id?.substring(0, 8)}...`"
          class="w-full bg-gray-100 border border-gray-300 rounded-md p-2 text-gray-500 text-sm"
          readonly
        >
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-600 mb-1">父节点 2:</label>
        <input
          type="text"
          :value="`节点: ${parentNode2Id?.substring(0, 8)}...`"
          class="w-full bg-gray-100 border border-gray-300 rounded-md p-2 text-gray-500 text-sm"
          readonly
        >
      </div>
    </div>

    <div>
      <label for="module-select" class="block text-sm font-medium text-gray-600 mb-1">选择模块</label>
      <select id="module-select" v-model="moduleId" class="w-full bg-white border border-gray-300 rounded-md p-2">
        <option
          v-for="module in availableModules"
          :key="module.id"
          :value="module.id"
        >
          {{ module.name }}
        </option>
      </select>
    </div>

    <div
      v-for="param in currentParameters"
      :key="param.id"
      class="parameter-item"
    >
      <label :for="param.id" class="block text-sm font-medium text-gray-600 mb-1">
        {{ param.label }}
      </label>
      <input
        v-if="param.type === 'number'"
        type="number"
        :id="param.id"
        v-model.number="parameterValues[param.id]"
        :step="param.step"
        :min="param.min"
        :max="param.max"
        :placeholder="param.placeholder"
        @keydown.enter.prevent
        class="w-full bg-white border border-gray-300 rounded-md p-2"
      />

      <input
        v-else-if="param.type === 'text'"
        type="text"
        :id="param.id"
        v-model="parameterValues[param.id]"
        :placeholder="param.placeholder"
        class="w-full bg-white border border-gray-300 rounded-md p-2"
      />

      <textarea
        v-else-if="param.type === 'textarea'"
        :id="param.id"
        rows="4"
        v-model="parameterValues[param.id]"
        :placeholder="param.placeholder"
        class="w-full bg-white border border-gray-300 rounded-md p-2"
      ></textarea>
      <select
        v-else-if="param.type === 'select'"
        :id="param.id"
        v-model="parameterValues[param.id]"
        class="w-full bg-white border border-gray-300 rounded-md p-2"
      >
        <option
          v-for="option in param.options"
          :key="option"
          :value="option"
        >
          {{ option }}
        </option>
      </select>
    </div>
    <div>
      <label for="image-upload" class="block text-sm font-medium text-gray-600 mb-1">图片输入 (可选)</label>
      <input
        type="file"
        id="image-upload"
        ref="fileInputRef"
        :disabled="isGenerating"
        @change="onFileChange"
        accept="image/*"
        class="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
      >
      <p class="text-xs text-gray-500 mt-1">提示：上传新图将覆盖父节点图像。</p>
    </div>

    <div class="pt-2">
      <button
        id="generate-btn"
        :disabled="isGenerating"
        @click="onGenerateClick"
        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center transition-colors disabled:bg-gray-400"
      >
        <span id="button-text">{{ isGenerating ? '生成中...' : '开始生成' }}</span>
        <div
          id="button-loader"
          :class="['loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-6 w-6 ml-3', { 'hidden': !isGenerating }]"
        ></div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted , reactive } from 'vue'


// --- 1. Props (从 App.vue 传入) ---

// 定义组件接收的 props，TypeScript 方式
const props = defineProps<{
  selectedIds: string[];
  isGenerating: boolean;
  initialModuleId: string | null;
  initialWorkflowType: 'preprocess' | 'image' | 'video' | null;
}>()

// --- 2. Emits (向 App.vue 传出) ---

// 定义组件可以发出的事件
const emit = defineEmits<{
  (e: 'generate', moduleId: string, parameters: Record<string, any>): void;
  (e: 'upload', file: File): void;
}>()


const parentNode1Id = computed(() => {
  // 如果长度 >= 1，安全地返回第一个 ID
  return props.selectedIds.length >= 1 ? props.selectedIds[0] : null;
});

const parentNode2Id = computed(() => {
  // 如果长度 >= 2，安全地返回第二个 ID
  return props.selectedIds.length >= 2 ? props.selectedIds[1] : null;
});


const moduleId = ref('');

// (核心修改) 定义所有可用模块
const allModules = [
  { id: 'ImageCanny', name: 'ImageCanny', type: 'preprocess' },
  { id: 'RemoveBackground', name: 'RemoveBackground', type: 'preprocess' },
  { id: 'ImageMerging', name: 'ImageMerging', type: 'preprocess' },

  { id: 'TextGenerateImage', name: 'TextToImage', type: 'image' },
  { id: 'ImageGenerateImage', name: 'ImageToImage', type: 'image' },
  { id: 'PartialRepainting', name: 'PartialRepainting', type: 'image' },
  { id: 'ImageHDRestoration', name: 'ImageHDRestoration', type: 'image' },
  { id: 'Put_It_Here', name: 'ObjectMigration', type: 'image' },

  { id: 'TextGenerateVideo', name: 'TextToVideo', type: 'video' },
  { id: 'ImageGenerateVideo', name: 'ImageToVideo', type: 'video' },
  { id: 'CameraControl', name: 'CameraControl', type: 'video' },
  { id: 'FrameInterpolation', name: 'FrameInterpolation', type: 'video' },
  { id: 'FLFrameToVideo', name: 'FisrtAndLastFrameControl', type: 'video' },
  
];



// 定义工作流参数
interface FormParameter {
  id: string; // 用于 v-model 绑定和 key
  label: string; // 显示的标签
  type: 'number' | 'text' | 'textarea' | 'select'; // 输入框类型
  defaultValue: any; // 默认值
  // 可选属性
  options?: string[]; // 用于 select
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}


const workflowParameters: Record<string, FormParameter[]> = {
  // --- 预处理 ---
  'ImageCanny': [
    { id: 'low_threshold', label: 'Low Threshold', type: 'number', defaultValue: 0.1, step:0.01, min: 0, max: 1  },
    { id: 'high_threshold', label: 'High Threshold', type: 'number', defaultValue: 0.8, step:0.01, min: 0, max: 1  },
  ],
  'RemoveBackground': [
    { id: 'model', label: 'Model', type: 'select', options: ['u2net', 'u2netp','silueta','isnet-general-use','isnet-anime'], defaultValue: 'u2net' },
    { id: 'foreground_threshold', label:'foreground_threshold', type: 'number', defaultValue:240},
    { id: 'background_threshold', label:'background_threshold', type: 'number', defaultValue:10},
    { id: 'erode_size', label:'erode_size', type: 'number', defaultValue:10},
  ],
  'ImageMerging': [
    {id:'stitch', label:'image stitch',type:'select', options:['top', 'left', 'bottom', 'right'], defaultValue:'right'},
  ],


  // --- 图片生成 --- Put it here还没做！！！！
  'TextGenerateImage': [
    { id: 'positive_prompt', label: 'Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your creative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'steps', label: 'Steps', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: 'Guidance', type: 'number', defaultValue: 7.5, step: 0.1 },
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024},
    { id: 'height', label: 'height', type: 'number',defaultValue: 512},
    { id: 'batch_size', label: 'batch_size', type:'number', defaultValue:1}
  ],
  'ImageGenerateImage': [
    { id:'lora_selector', label:'LORA',type:'select', options: ['None','Canny'], defaultValue:'None'},
    { id: 'positive_prompt', label: 'Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your creative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'steps', label: 'Steps', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: 'Guidance', type: 'number', defaultValue: 7.5, step: 0.1 },
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024},
    { id: 'height', label: 'height', type: 'number',defaultValue: 512},
    { id: 'batch_size', label: 'batch_size', type:'number', defaultValue:1}
  ],
  'ImageHDRestoration':[
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'denoise', label: 'denoise', type: 'number', defaultValue: 0.1, step: 0.01},
  ],
  'PartialRepainting':[
    { id: 'positive_prompt', label: 'Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your creative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'steps', label: 'Steps', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: 'Guidance', type: 'number', defaultValue: 7.5, step: 0.1 },
  ],
  // --- 视频生成 ---
  'TextGenerateVideo': [
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'noise_seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step:1},
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024},
    { id: 'height', label: 'height', type: 'number',defaultValue: 512},
    { id: 'length', label: 'length', type: 'number', defaultValue: 41, step:8},
    { id: 'batch_size', label: 'batch_size', type:'number', defaultValue:1}
  ],
  'ImageGenerateVideo': [
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'noise_seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step:1},
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024},
    { id: 'height', label: 'height', type: 'number',defaultValue: 512},
    { id: 'length', label: 'length', type: 'number', defaultValue: 41, step:8},
    { id: 'batch_size', label: 'batch_size', type:'number', defaultValue:1}
  ],
  'FLFrameToVideo': [
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'noise_seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step:1},
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024},
    { id: 'height', label: 'height', type: 'number',defaultValue: 512},
    { id: 'length', label: 'length', type: 'number', defaultValue: 41, step:8},
    { id: 'batch_size', label: 'batch_size', type:'number', defaultValue:1}
  ],
  'CameraControl': [
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'noise_seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'camera_pose', label:'camera_pose', type:'select', options:['Pan Up', 'Pan Down', 'Pan Left', 'Pan Right', 'Zoom In', 'Zoom Out', 'Anti Clockwise (ACW)', 'ClockWise (CW)'], defaultValue : 'Pan Up'},
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step:1},
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024},
    { id: 'height', label: 'height', type: 'number',defaultValue: 512},
    { id: 'length', label: 'length', type: 'number', defaultValue: 41, step:8},
    { id: 'batch_size', label: 'batch_size', type:'number', defaultValue:1}
  ],
  'FrameInterpolation':[
    {id:'multiplier', label:'multiplier',type:'number',defaultValue:2},
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step:1},
  ]
};
// --- (核心修改 3) 存储当前参数值的 reactive 对象 ---
const parameterValues = reactive<Record<string, any>>({});

// (核心修改) 创建一个计算属性，根据传入的类型过滤模块列表
const availableModules = computed(() => {
  if (!props.initialWorkflowType) {
    return allModules; // 如果没有类型，显示全部 (或只显示默认?)
  }
  return allModules.filter(module => module.type === props.initialWorkflowType);
});

// --- (核心修改 4) 计算当前应显示的参数列表 ---
const currentParameters = computed<FormParameter[]>(() => {
  return workflowParameters[moduleId.value as keyof typeof workflowParameters] || [];
});

// --- (核心修改 5) 监听 moduleId 变化，重置参数值为默认值 ---
function resetParameterValues(moduleIdToLoad: string) {
  // 清空旧值 (非常重要!)
  Object.keys(parameterValues).forEach(key => delete parameterValues[key]);
  // 设置新模块的默认值
  const params = workflowParameters[moduleIdToLoad as keyof typeof workflowParameters] || [];
  params.forEach(param => {
    parameterValues[param.id] = param.defaultValue;
  });
  console.log("参数已重置为:", moduleIdToLoad, parameterValues);
}

// 监听从父组件传入的 initialModuleId
watch(() => props.initialModuleId, (newModuleId) => {
  if (newModuleId && newModuleId !== moduleId.value) {
    moduleId.value = newModuleId;
  } else if (!newModuleId && availableModules.value.length > 0) {
    if (!moduleId.value) {
      // (核心修复) 确保 availableModules[0] 存在
      const firstModule = availableModules.value[0];
      if (firstModule) {
        moduleId.value = firstModule.id;
      }
    }
  }
}, { immediate: true });

// 监听用户选择或上面 watch 改变的 moduleId
watch(moduleId, (newModuleId, oldModuleId) => {
  // 确保在模块 ID 确实改变时才重置
  if (newModuleId && newModuleId !== oldModuleId) {
      resetParameterValues(newModuleId);
  }
}, { immediate: true }); // immediate 保证首次加载时设置默认值


// 对 <input type="file"> DOM 元素的引用
const fileInputRef = ref<HTMLInputElement | null>(null)


// (Core Change 13) Watch the prop and update local state
watch(() => props.initialModuleId, (newModuleId) => {
  if (newModuleId) {
    moduleId.value = newModuleId;
  }
}, { immediate: true }); // immediate: true ensures it runs on mount
// --- 4. 计算属性 (Computed) ---

// 动态计算父节点输入框的显示文本
// 这替换了原版 JS 中的 updateSelectedNodeInput() 函数
/*const selectedNodeText = computed(() => {
  // VVVV 添加这个日志 VVVV
  console.log(
    `%c[Form] 5. Computed 正在重新计算...`,
    'color: #FFA500; font-weight: bold;'
  );
  // ^^^^ 添加这个日志 ^^^^
  const count = props.selectedIds.length
  if (count === 0) {
    return '未选择 (将创建根节点)'
  } 
  if (count === 1) {
    // (新) 我们先把[0]取出来
    const firstId = props.selectedIds[0] 
    // (新) 我们再检查它是不是真的存在 (虽然在 count === 1 时它一定在)
    // 这一步能 100% 让 TypeScript 闭嘴
    if (firstId) {
      return `已选择 (1): ${firstId.substring(0, 8)}...`
    }
    // 理论上走不到这里，但这是个安全出口
    return '错误：无法读取ID'
  }

  // 专为 ImageMerging 优化提示
  if (moduleId.value === 'ImageMerging' && count === 2) {
    return `已选择 2 个节点 (合并就绪)`
  }

  return `已选择 (${count}) 个节点`
})*/


watch(() => props.selectedIds, (newIds) => {
  console.log("%c--- 表单(Form) 收到 Prop 更新 ---", "color: blue; font-weight: bold");
  console.log("  表单收到的新 IDs:", newIds);
}, { deep: true });
// --- 5. 事件处理器 (Methods) ---

/**
 * 当文件上传框内容改变时触发
 */
function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0] // 获取选中的第一个文件

  if (file) {
    // (核心) 将文件 emit 出去，让 App.vue 的 useWorkflow.ts 去处理
    emit('upload', file)
  }

  // (重要) 清空文件输入框
  // 这样用户才能在上传同一个文件时再次触发 change 事件
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

/**
 * 当点击 "开始生成" 按钮时触发
 */
function onGenerateClick() {
  // (核心修改 1)
  // 获取用户在下拉框中选择的 虚拟 module ID
  let virtualModuleId = moduleId.value;
  // 这是我们将要发给后端的 真实 module ID
  let finalModuleId = virtualModuleId; 

  // 1. (核心) 直接复制当前的参数值
  const currentParams = { ...parameterValues };

  // 2. (核心修改 2) 在这里实现你的逻辑“开关”
  if (virtualModuleId === 'ImageToImage') {
    const loraChoice = currentParams.lora_selector; // 获取 'LoRA / Control Model' 的值

    if (loraChoice === 'Canny') {
      finalModuleId = 'ImageGenerateImage_Canny'; // 告诉后端运行 Canny 工作流
    } else {
      // 默认 (loraChoice === 'None' 或其他)
      finalModuleId = 'ImageGenerateImage_Basic'; // 告诉后端运行 Basic 工作流
    }
    // (可选，但推荐) 从参数中移除这个仅供前端使用的 lora_selector
    // 因为后端 (app.py) 并不认识 'lora_selector' 这个 key
    delete currentParams.lora_selector;
  }

  // 3. (v53 逻辑) 处理后端需要的特定参数名
  const finalParameters: Record<string, any> = {};
  // a. 复制所有*剩余*的参数
  for (const key in currentParams) {
    finalParameters[key] = currentParams[key];
  }
  // b. 处理 'prompt' -> 'positive_prompt'
  if (currentParams.prompt !== undefined) {
    finalParameters.positive_prompt = currentParams.prompt;
  }
  // c. 处理 'seed'
  if (finalParameters.seed === null || finalParameters.seed === undefined || finalParameters.seed === '') {
    finalParameters.seed = Math.floor(Math.random() * 1000000000000000);
  }
  console.log("即将提交的真实 ModuleID:", finalModuleId, "和参数:", finalParameters);

  // 4. (核心) 将*真实*的模块ID (finalModuleId) 和处理后的参数 emit 出去
  emit('generate', finalModuleId, finalParameters);
}
</script>