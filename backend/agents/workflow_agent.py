import json
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from .state import AgentState

WORKFLOW_METADATA = {
    "ImageGenerateImage_Basic.json": "General image-to-image generation. Use ONLY for fusion, modification of images (no line art focus).",
    "ImageGenerateImage_Canny.json": "Specialized image-to-image generation. Use ONLY for generating images from line draft (no fusion/modification).",
    "ImageCanny.json": "Generates line art by extracting edge maps.",
    "LayerStacking.json": "Layers one object onto another image. Use ONLY for stacking (no fusion, no line art focus).",
    "TextToAudio.json": "Generates AUDIO, SPEECH, or NARRATION. **High Priority** if user mentions 'narration', 'voice', 'say', 'speak'.",
    "TextGenerateImage.json": "Generates STATIC IMAGES from text. Use for visual descriptions. Do NOT use for narration/audio.",
    "TextGenerateVideo.json": "Generates VIDEO/ANIMATION from text.",
    "ImageGenerateVideo.json":"Generates VIDEO/ANIMATION from image.",
    "FLFrameToVideo.json":"Determine the beginning and end frames of the video and generate the video",
    "CameraControl.json": "Control the direction of camera movement",
    "ImageInpainting.json": "Partially redraw the mask area of the image"
}

def format_workflow_list(file_list):
    formatted_lines = []
    for f in file_list:
        desc = WORKFLOW_METADATA.get(f, "Generic workflow. Use only if no specific match found.")
        formatted_lines.append(f"- {f}: {desc}")
    return "\n".join(formatted_lines)

def workflow_selector_node(state: AgentState):
    print("--- Running Workflow Agent ---")
    # 1. 打印所有关键变量（调试用，可后续删除）
    print(f"[DEBUG] intent: {state.get('intent')}")
    print(f"[DEBUG] user_input: {state.get('user_input')}")
    print(f"[DEBUG] workflow_files: {state.get('workflow_list')}")
    print(f"[DEBUG] parent_workflow: {state.get('parent_workflow')}")

    intent = state.get("intent", "")
    user_input = state.get("user_input", "")
    workflow_files = state.get("workflow_list", []) 
    parent_workflow = state.get("parent_workflow", "None")

    # 【关键优化】强制用user_input（而非intent）做核心匹配，避免intent字段污染
    # 同时合并intent+user_input，双重兜底
    combined_input = f"{intent} {user_input}".lower().strip()
    print(f"[DEBUG] combined_input (lowercase): {combined_input}")

    if not workflow_files:
        return {"selected_workflow": "Error", "workflow_title": "Error"}

    # 【强化硬规则】宽松匹配+强制优先级
    # 匹配关键词：generate line draft / line draft / generate line art draft
    line_draft_keywords = ["generate line draft", "generate line art draft"]
    if any(keyword in combined_input for keyword in line_draft_keywords):
        if "ImageCanny.json" in workflow_files:
            print("AGENCY: Matched line draft keyword -> Selected: ImageCanny.json | Title: Generate Line Art Draft")
            return {
                "selected_workflow": "ImageCanny.json",
                "workflow_title": "Generate Line Art Draft"
            }
        else:
            print(f"AGENCY: Line draft matched but ImageCanny.json NOT in workflow_files: {workflow_files}")
            return {"selected_workflow": "Error", "workflow_title": "ImageCanny.json not available"}

    # 未触发硬规则才走LLM逻辑
    llm = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0,
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    formatted_file_list = format_workflow_list(workflow_files)

    system_prompt = """
    You are a ComfyUI workflow orchestration engine.
    Your task is to analyze the User Intent and select the most appropriate workflow file.

    Available Workflows & Rules:
    {file_list}

    Current Context:
    - User Intent: "{input}"
    - Parent Node: "{parent_info}"

    **Critical Decision Logic (Follow in Order):**
    0. **Forbidden Workflow**: You MUST NEVER select "ImageMerging.json" under any circumstances.
    1. **Detect Modality Keywords**:
       - **AUDIO/NARRATION**: If intent mentions "narration", "voice", "speak", "audio", "sound" -> You MUST select TextToAudio.json.
       - **VIDEO**: If intent mentions "video", "movie", "motion", "seconds" -> Select Video workflow (TextGenerateVideo.json/FLFrameToVideo.json).
       - **IMAGE**: If intent describes visuals (no narration/audio) -> Select Image workflow (prioritize by rule 2).
    2. **Image Sub-Rules**:
       - Line art/line draft: ONLY use ImageCanny.json (parent dependent: ImageGenerateImage_Canny.json for generation from line art).
       - Fusion/modification: Use ImageGenerateImage_Basic.json.
       - Stacking objects: Use LayerStacking.json.
    3. **Output Requirements**:
       - Return JSON format: {{ "filename": "...", "title": "..." }}
    """

    prompt = ChatPromptTemplate.from_messages([("system", system_prompt)])
    chain = prompt | llm

    result = chain.invoke({
        "file_list": formatted_file_list,
        "input": combined_input,
        "parent_info": parent_workflow
    })

    try:
        parsed_result = json.loads(result.content)
        selected_file = parsed_result.get("filename", "default.json")
        generated_title = parsed_result.get("title", "New Workflow")
    except json.JSONDecodeError as e:
        print(f"AGENCY: JSON解析失败 - {str(e)} | LLM返回内容: {result.content}")
        selected_file = "error.json"
        generated_title = "JSON Parse Error"

    print(f"AGENCY: LLM Selected: {selected_file} | Title: {generated_title}")

    return {
        "selected_workflow": selected_file,
        "workflow_title": generated_title
    }