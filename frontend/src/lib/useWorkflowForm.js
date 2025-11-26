import { ref, reactive, computed, watch } from 'vue'

/* 全部模块 */
const allModules = [
  { id: 'AddText',name:'Text',type:'util'},
  { id: 'AddWorkflow',name:'AddWorkflow',type:'util'},
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
  { id: 'TextToAudio',name:'TextToAudio',type:'audio'}
]

/* 各模块参数定义 */
const workflowParameters = {
  AddText: [
    { id: 'text', label: 'Text', type: 'textarea', defaultValue: '' },
  ],
  AddWorkflow: [
    { id: 'text', label: 'Text', type: 'textarea', defaultValue: '' },
  ],
  TextToAudio: [
    { id: 'text', label: 'Audio Prompt', type: 'textarea', defaultValue: '', placeholder: 'Text to be converted to audio...' },
    { id: 'audio_seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'voice_speed_factor', label: 'Speed', type: 'number', defaultValue: 1.0, step:0.01, min:0.8, max:1.2  }
  ],
  ImageCanny: [
    { id: 'low_threshold', label: 'Low Threshold', type: 'number', defaultValue: 0.1, step: 0.01, min: 0, max: 1 },
    { id: 'high_threshold', label: 'High Threshold', type: 'number', defaultValue: 0.8, step: 0.01, min: 0, max: 1 }
  ],
  RemoveBackground: [
    { id: 'model', label: 'Model', type: 'select', options: ['u2net', 'u2netp', 'silueta', 'isnet-general-use', 'isnet-anime'], defaultValue: 'u2net' },
    { id: 'foreground_threshold', label: 'foreground_threshold', type: 'number', defaultValue: 240 },
    { id: 'background_threshold', label: 'background_threshold', type: 'number', defaultValue: 10 },
    { id: 'erode_size', label: 'erode_size', type: 'number', defaultValue: 10 }
  ],
  ImageMerging: [
    { id: 'stitch', label: 'image stitch', type: 'select', options: ['top', 'left', 'bottom', 'right'], defaultValue: 'right' }
  ],
  TextGenerateImage: [
    { id: 'positive_prompt', label: 'Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your creative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'steps', label: 'Steps', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: 'Guidance', type: 'number', defaultValue: 7.5, step: 0.1 },
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024 },
    { id: 'height', label: 'height', type: 'number', defaultValue: 512 },
    { id: 'batch_size', label: 'batch_size', type: 'number', defaultValue: 1 }
  ],
  ImageGenerateImage: [
    { id: 'lora_selector', label: 'LORA', type: 'select', options: ['None', 'Canny'], defaultValue: 'None' },
    { id: 'positive_prompt', label: 'Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your creative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'steps', label: 'Steps', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: 'Guidance', type: 'number', defaultValue: 7.5, step: 0.1 },
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024 },
    { id: 'height', label: 'height', type: 'number', defaultValue: 512 },
    { id: 'batch_size', label: 'batch_size', type: 'number', defaultValue: 1 }
  ],
  ImageHDRestoration: [
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'denoise', label: 'denoise', type: 'number', defaultValue: 0.1, step: 0.01 }
  ],
  PartialRepainting: [
    { id: 'positive_prompt', label: 'Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your creative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'steps', label: 'Steps', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: 'Guidance', type: 'number', defaultValue: 7.5, step: 0.1 }
  ],
  TextGenerateVideo: [
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step: 1 },
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024 },
    { id: 'height', label: 'height', type: 'number', defaultValue: 512 },
    { id: 'length', label: 'length', type: 'number', defaultValue: 41, step: 8 },
    { id: 'batch_size', label: 'batch_size', type: 'number', defaultValue: 1 }
  ],
  ImageGenerateVideo: [
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step: 1 },
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024 },
    { id: 'height', label: 'height', type: 'number', defaultValue: 512 },
    { id: 'length', label: 'length', type: 'number', defaultValue: 41, step: 8 },
    { id: 'batch_size', label: 'batch_size', type: 'number', defaultValue: 1 }
  ],
  FLFrameToVideo: [
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step: 1 },
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024 },
    { id: 'height', label: 'height', type: 'number', defaultValue: 512 },
    { id: 'length', label: 'length', type: 'number', defaultValue: 41, step: 8 },
    { id: 'batch_size', label: 'batch_size', type: 'number', defaultValue: 1 }
  ],
  CameraControl: [
    { id: 'positive_prompt', label: 'Positive Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your positive prompt...' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'textarea', defaultValue: '', placeholder: 'Your negative prompt...' },
    { id: 'seed', label: 'Seed', type: 'number', defaultValue: null, placeholder: 'Random' },
    { id: 'camera_pose', label: 'camera_pose', type: 'select', options: ['Pan Up', 'Pan Down', 'Pan Left', 'Pan Right', 'Zoom In', 'Zoom Out', 'Anti Clockwise (ACW)', 'ClockWise (CW)'], defaultValue: 'Pan Up' },
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step: 1 },
    { id: 'width', label: 'width', type: 'number', defaultValue: 1024 },
    { id: 'height', label: 'height', type: 'number', defaultValue: 512 },
    { id: 'length', label: 'length', type: 'number', defaultValue: 41, step: 8 },
    { id: 'batch_size', label: 'batch_size', type: 'number', defaultValue: 1 }
  ],
  FrameInterpolation: [
    { id: 'multiplier', label: 'multiplier', type: 'number', defaultValue: 2 },
    { id: 'fps', label: 'fps', type: 'number', defaultValue: 16, step: 1 }
  ]
}

/* 主函数：useWorkflowForm */
export function useWorkflowForm (props) {
  const moduleId = ref('')
  const parameterValues = reactive({})

  /* 计算属性 */
  const availableModules = computed(() => {
    if (!props.initialWorkflowType) return allModules
    return allModules.filter(m => m.type === props.initialWorkflowType)
  })

  const currentParameters = computed(() => {
    return workflowParameters[moduleId.value] || []
  })

  /* 方法 */
  function resetParameterValues (id) {
    Object.keys(parameterValues).forEach(k => delete parameterValues[k])
    const params = workflowParameters[id] || []
    params.forEach(p => { parameterValues[p.id] = p.defaultValue })
  }

  /* 监听 */
  watch(() => props.initialModuleId, (val) => {
    if (val && val !== moduleId.value) moduleId.value = val
    else if (!val && availableModules.value.length) {
      const first = availableModules.value[0]
      if (first) moduleId.value = first.id
    }
  }, { immediate: true })

  watch(moduleId, (newId, oldId) => {
    if (newId && newId !== oldId) resetParameterValues(newId)
  }, { immediate: true })

  return {
    moduleId,
    parameterValues,
    availableModules,
    currentParameters,
    resetParameterValues
  }
}