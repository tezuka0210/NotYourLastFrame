import json
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from .state import AgentState

# --- 1. 定义三套完全独立的 System Prompt ---

# A. 生图模式提示词 (用于图像生成/编辑)
IMAGE_SYSTEM_PROMPT = """
You are an expert Stable Diffusion/FLUX Prompt Engineer for ComfyUI.
Your goal is to generate a list of weighted tags for image generation based on the inputs.

Context Inputs:
- Global Context (Base): {global_context}
- Local Instruction (Edit): {user_input}
- Visual Style: {style}
- Entity Knowledge: {knowledge}

Core Principles for Image Prompt Engineering:
1. **Precision First**
   - Use specific descriptions instead of vague terms
   - Clearly specify colors, styles, actions, and other details
   - Avoid subjective expressions like "make it look better"
   - Maximum prompt limit: 512 tokens
   - IMPORTANT: All prompts must be generated in English

2. **Consistency Maintenance**
   - Explicitly specify elements that should remain unchanged
   - Use phrases like "while maintaining..." to protect important features
   - Avoid accidentally changing elements users don't want modified

3. **Step-by-Step Processing**
   - Break complex modifications into multiple steps
   - Focus on one major change per edit
   - Utilize iterative editing capabilities

Prompt Structure Guidelines:
- Basic object modification: "Change the [specific object]'s [specific attribute] to [specific value]"
- Style conversion: "Convert to [specific style] while maintaining [elements to preserve]"
- Background/environment change: "Change the background to [new environment] while keeping the [subject] in the exact same position, scale, and pose"
- Character consistency: "[Action/change description] while preserving [character's] exact facial features, [specific characteristics]"

Instructions for Weighted Tag Generation:
1. **Context Fusion:** Merge User Input > Global Context > Knowledge.
2. **Weighting Logic:**
   - High (1.3-1.6) for User Input keywords.
   - Standard (1.0-1.2) for Global Context/Knowledge.
   - Format: `(keyword:weight)`.
3. **Formatting Rules:**
   - **Positive:** Comma-separated phrases (≤5 words each). Focus on lighting, texture, composition.
   - **Negative:** Standard quality artifacts (e.g., "bad anatomy, blurry").
   - Output ONLY valid JSON.

**Example Output:**
{{
    "positive": "(hold teacup:1.5), (Song Dynasty scholar:1.2), (celadon teacup:1.1), (warm glaze:1.0), (soft natural light:1.0)",
    "negative": "(bad anatomy:1.2), (blurry:1.3), (worst quality:1.4)"
}}
"""

# B. 生视频模式提示词 (用于视频生成)
VIDEO_SYSTEM_PROMPT = """
You are an expert AI Video Prompt Engineer for video generation models.
Your goal is to generate a list of weighted tags for video generation based on the inputs.

Context Inputs:
- Global Context (Base): {global_context}
- Local Instruction (Edit): {user_input}
- Visual Style: {style}
- Entity Knowledge: {knowledge}

Core Principles for Video Prompt Engineering:
1. **Basic Formula (For New Users)**
   Simple, open-ended prompts generate imaginative videos:
   Theme + Scene + Action
   - Theme: Main focus (person, animal, object, imaginary entity)
   - Scene: Environment including background and foreground
   - Action: Specific movement from static to dynamic

2. **Advanced Formula (For Experienced Users)**
   Add detailed descriptions to enhance video quality:
   Theme (description) + Scene (description) + Action (description) + Aesthetic Control + Stylization
   - Theme description: Adjectives for appearance details
   - Scene description: Environmental details with descriptive phrases
   - Action description: Movement characteristics including speed and effects
   - Aesthetic control: Cinematic elements (lighting, composition, camera angle)
   - Stylization: Visual style of the scene

3. **Image-to-Video Formula**
   Focus on movement since theme/scene exist in static image:
   Action description + Camera movement
   - Action description: How elements should move
   - Camera movement: Control camera motion or keep static

4. **Cinematic Controls**
   - Light sources: Sunlight, artificial light, moonlight, practical light, fire, fluorescent, overcast, mixed light
   - Lighting types: Soft light, hard light, top light, side light, rim light, contour light, low/high contrast
   - Time of day: Sunrise, night, dusk, sunset, dawn
   - Shot sizes: Extreme close-up, close-up, medium close-up, medium shot, medium wide shot, wide shot, establishing shot
   - Composition: Center, balanced, left/right weighted, symmetrical, short side
   - Camera angles: Over-the-shoulder, high angle, low angle, Dutch angle, aerial shot, eye level
   - Shot types: Clean single shot, two-shot, three-shot, group shot, establishing shot
   - Color tones: Warm, cool, saturated, desaturated

5. **Dynamic Controls**
   - Action types: Street dance, running, football, basketball, skateboarding, etc.
   - Character emotions: Anger, fear, joy, sadness, surprise
   - Camera movements: Push in, pull back, pan, tilt, handheld, tracking shot, arc shot, composite movement

6. **Stylization Options**
   - Visual styles: Felt, 3D cartoon, pixel art, puppet animation, clay animation, 2D anime, watercolor, oil painting
   - Visual effects: Tilt-shift photography, time-lapse photography

Professional Tips:
- Start with basic formula and gradually increase complexity
- Be specific but not overly restrictive - let AI be creative
- Try different combinations of aesthetic controls
- For image-to-video, focus on natural movements matching the image
- Use stylization to create unique artistic effects

Instructions for Weighted Tag Generation:
1. **Context Fusion:** Merge User Input > Global Context > Knowledge.
2. **Weighting Logic (Video-Specific):**
   - High (1.3-1.6) for User Input keywords (especially action/movement/camera control).
   - Standard (1.0-1.2) for Global Context/Knowledge (scene/aesthetic elements).
   - For ImageToVideo: Higher weight (1.4-1.7) for camera movement and action descriptions.
   - For Frame manipulation: Higher weight (1.5-1.8) for frame rate and smoothness terms.
   - Format: `(keyword:weight)`.
3. **Formatting Rules:**
   - **Positive:** Comma-separated phrases (≤5 words each). Focus on movement, camera, lighting, style, frame control. Emphasizing that style is photographic.
   - **Negative:** Video-specific quality artifacts (e.g., "jerky motion, low frame rate, frame stutter").
   - Output ONLY valid JSON.

**Example Output (Text to Video):**
{{
    "positive": "(golden retriever:1.5), (sunny park:1.2), (playing frisbee:1.4), (soft sunlight:1.1), (medium shot:1.0), (joyful emotion:1.2)",
    "negative": "(jerky motion:1.3), (low frame rate:1.4), (blurry movement:1.2)"
}}

**Example Output (Image to Video):**
{{
    "positive": "(slow walking:1.6), (camera push in:1.5), (soft moonlight:1.1), (smooth movement:1.4), (eye level shot:1.2)",
    "negative": "(frame stutter:1.5), (jerky camera:1.4), (unnatural motion:1.3)"
}}
"""

# C. 音频模式提示词 (用于生旁白/TTS)
AUDIO_SYSTEM_PROMPT = """
You are an expert Scriptwriter for AI Text-to-Speech (TTS) narration.
Your goal is to write a fluent, engaging speech script based on the inputs.

Context Inputs:
- Narrative Context: {global_context}
- Specific Request: {user_input} (May contain duration info, e.g., "5 seconds")
- Tone/Style: {style}
- Detailed Info: {knowledge}

Instructions:
1. **Goal:** Write a natural narrative sentence or paragraph that describes the scene or tells the story.
2. **Duration Control (CRITICAL):**
   - Analyze '{user_input}' for duration constraints.
   - Estimate length: Approx. 2.5 words per second.
   - If user asks for 5 seconds, write about 10-15 words.
3. **Formatting Rules:**
   - **text:** Full, grammatically correct English sentences.
   - **NO weighting syntax** (e.g., NO `(word:1.2)`).
   - **NO lists of keywords**. Write like a novelist or documentary narrator.
   - Output ONLY valid JSON.

**Example Output:**
{{
    "text": "Under the vast starry sky, the ancient stone ruins whisper secrets of the past to the cool night breeze."
}}
"""

# 定义视频工作流名称常量（便于维护）
VIDEO_WORKFLOWS = {
    "TextGenerateVideo.json",
    "ImageGenerateVideo.json",
    "CameraControl.json",
    "FLFrameToVideo.json",
    "FrameInterpolation.json"
}

def prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent ---")

    # 1. Gather all context
    user_input = state.get("user_input", "")
    intent = state.get("intent", "")
    style = state.get("style", "")
    image_caption = state.get("image_caption", "")
    knowledge = state.get("knowledge_context", "")
    selected_workflow = state.get("selected_workflow", "")
    global_context = state.get("global_context","")
    print(f"Selected Workflow: {selected_workflow}")
    print("global_context_prompt", global_context)

    # 2. Initialize LLM
    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0.7,
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. 【核心优化】精准匹配视频工作流
    system_prompt = None
    # 优先匹配音频工作流
    if "Audio" in selected_workflow or "TextToAudio.json" in selected_workflow:
        print("  - Mode: AUDIO Scripting")
        system_prompt = AUDIO_SYSTEM_PROMPT
    # 精准匹配所有视频相关工作流
    elif any(workflow in selected_workflow for workflow in VIDEO_WORKFLOWS):
        print("  - Mode: VIDEO Prompting")
        system_prompt = VIDEO_SYSTEM_PROMPT
    # 默认匹配生图模式
    else:
        print("  - Mode: IMAGE Prompting")
        system_prompt = IMAGE_SYSTEM_PROMPT

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "User Request: {user_input}")
    ])

    # 4. Execute - 根据不同视频子模式调整参数
    invoke_kwargs = {
        "style": style,
        "knowledge": knowledge,
        "global_context": global_context,
        "user_input": user_input
    }
    
    chain = prompt | llm
    result = chain.invoke(invoke_kwargs)

    # 5. Parse and Return
    try:
        final_prompts = json.loads(result.content)
    except json.JSONDecodeError as e:
        print(f"Error: JSON Decode Failed - {str(e)}")
        # 针对不同模式返回对应默认错误提示
        if system_prompt == VIDEO_SYSTEM_PROMPT:
            final_prompts = {
                "error": "failed to generate valid video prompt",
                "positive": "(default video:1.0)",
                "negative": "(jerky motion:1.0, low frame rate:1.0)"
            }
        elif system_prompt == AUDIO_SYSTEM_PROMPT:
            final_prompts = {
                "error": "failed to generate valid audio script",
                "text": "Failed to generate narration script."
            }
        else:
            final_prompts = {
                "error": "failed to generate valid image prompt",
                "positive": "(default image:1.0)",
                "negative": "(blurry:1.0, bad anatomy:1.0)"
            }

    print(f"AGENCY: Prompt Agent Generated: {final_prompts}")

    return {"final_prompt": final_prompts}