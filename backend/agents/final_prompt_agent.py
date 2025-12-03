import json
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from .state import AgentState

def final_prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent (Updated for Sentence Prompts) ---")

    # 1. 从状态中获取上下文（修复：变量名与模板引用一致，补充缺失变量）
    user_input = state.get("user_positive_input", "")  # 原逻辑：用户输入从 user_positive_input 获取
    intent = state.get("intent", "")
    style = state.get("style", "")  # 模板需要，补充获取（默认空字符串）
    #image_caption = state.get("image_caption", "")
    knowledge = state.get("knowledge_context", "")
    selected_workflow = state.get("selected_workflow", "")
    global_context = state.get("global_context", "")  # 模板需要，补充获取（默认空字符串）

    # 2. 初始化 LLM（保持原有配置）
    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0.5,
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. 提示词模板（保持原有逻辑，仅确保变量引用一致）
    system_prompt = """
    You are an expert Stable Diffusion Prompt Engineer for ComfyUI.
    Your goal is to generate coherent, complete English sentences as prompts (not isolated phrases) based on the user request and analysis, integrating ComfyUI syntax for weighting and random selection.

    Context:
    - Global Context (The Base): {global_context}
    - Local Instruction (The Edit): {user_input}   
    - Visual Style: {style} 
    - Entity Knowledge: {knowledge} 

    Weight Definition & Syntax Rules:
    1.  **NON-NEGOTIABLE: Preserve all user-provided (keyword:weight) entries VERBATIM—no deletion, replacement, abbreviation, or modification of keywords/weights.** (e.g., if user inputs "(black white spots on dog:1.6)", output must include this exact phrase and weight; do not change to "black dog" or remove "on dog".)
    2.  Weight > 1: Higher value = more important (must prioritize this detail, no flexibility).
    3.  Weight = 1: Standard requirement (strictly follow the content, no expansion).
    4.  Weight < 1: Represents ambiguous intent (allow 2-3 options using {{option1|option2|option3}} syntax; all options ≤5 words).
        *   **Critical:** For weight < 1, the nature of the options is determined by how close the weight is to 0 or 1:
            *   A weight **closer to 0** (e.g., 0.1, 0.2) means the options should be **completely different and from distinct categories**.
            *   A weight **closer to 1** (e.g., 0.8, 0.9) means the options should be **similar and within the same category**.
    5.  Random Selection: Use {{option1|option2|option3}} *only* for content with weight < 1 (embed directly in the sentence).
    6.  Sentence Requirement: Prompts must be complete, coherent sentences (not phrases) that describe the full image/transformation logic, with ALL user-provided weighted entries integrated naturally.

    Instructions:
    1. Context Fusion Strategy (CRITICAL):
        - Priority Order: {user_input} > {global_context} > {knowledge}  # User instruction takes precedence; knowledge supplements details
        - Use {knowledge} to enhance specificity (e.g., texture, lighting) but never replace or delete user-provided keywords.
        - Example: If user inputs "(blue and white porcelain:1.5)", knowledge can add "glossy glaze" but must retain the original (blue and white porcelain:1.5).
        - If {knowledge} is empty, ignore this section without affecting core logic.

    2. Positive Prompt Rules:
    - Must be a complete English sentence (not isolated phrases)
    - Emphasize lighting, texture, and composition (supplement, do not replace user keywords)
    - Integrate ALL user-provided (content:weight) entries (no omissions)
    - For weight < 1: Embed {{option1|option2|option3}} (2-3 options, each ≤5 words) only if the original entry has weight < 1
    - Ensure natural flow (weighted chunks fit seamlessly into the sentence)

    3. Negative Prompt Rules:
    - Must be a complete English sentence (not isolated phrases)
    - Focus on avoiding image defects/artifacts
    - Integrate ALL user-provided (negative content:weight) entries (no omissions)
    - For weight < 1: Embed {{option1|option2|option3}} (2-3 options, each ≤5 words) only if the original entry has weight < 1
    - Ensure natural flow (weighted chunks fit seamlessly into the sentence)

    4. Output Rules:
    - Strictly follow sentence structure (no phrase lists), weight definition, and syntax rules
    - No extra text, only JSON format (no line breaks in prompt strings):
    {{
    "positive": "Complete positive sentence with ALL user-provided (weighted content:1.5) integrated naturally",
    "negative": "Complete negative sentence with ALL user-provided (weighted defect:1.3) integrated naturally"
    }}
    """
    # 4. 创建 Prompt 模板 + 定义 chain（修复：确保模板变量与传递参数一致）
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        # 修复：模板中的 {input} 改为 {user_input}（与传递的变量名一致，避免额外未定义变量）
        ("user", "User Request: {user_input} | Intent: {intent}")
    ])
    chain = prompt | llm

    # 5. 执行 LLM 调用（核心修复：补充缺失的 3 个变量，确保与模板引用完全一致）
    result = chain.invoke({
        #"image_caption": image_caption,
        "user_input": user_input,  # 对应模板中的 {user_input}（包括 system 和 user 消息）
        "intent": intent,
        "knowledge": knowledge,
        "style": style,  # 补充：模板中引用了 {style}
        "global_context": global_context,  # 补充：模板中引用了 {global_context}
    })

    # 6. 解析结果（保持原有异常处理逻辑）
    try:
        final_prompts = json.loads(result.content)
        # 验证输出格式是否符合要求（增强鲁棒性）
        if not isinstance(final_prompts.get("positive"), str) or not isinstance(final_prompts.get("negative"), str):
            raise ValueError("Prompt values must be strings")
    except (json.JSONDecodeError, ValueError):
        # 回退到默认值
        final_prompts = {
            "positive": user_input,
            "negative": "bad quality, low res"
        }

    print("AGENCY: Prompt Agent Generated Sentence-Based Prompts.")
    return {"final_prompt": final_prompts}

# ==========================
# 测试代码（修复变量名和缺失参数）
# ==========================
if __name__ == "__main__":
    # 1. 准备测试用的 AgentState（补充缺失的默认变量，避免获取为空时模板报错）
    test_state = AgentState({
        "user_positive_input": "(sandy beach:1.5), (running puppy:1.6), (bright sun:0.2), (soft fur:1.3), (joyful motion:1.7)",
        "image_caption": "",
        "intent": "generate a vivid beach scene with a playful puppy",
        "style": "",  # 补充：测试时默认空（可根据需要设置具体风格，如 "photorealistic"）
        "global_context": "",  # 补充：测试时默认空（可根据需要设置全局上下文）
        "knowledge_context": ""  # 补充：对应代码中的 knowledge 来源
    })

    # 2. 运行 Agent（修复：函数名拼写错误，原 prompt_agent_node → 正确 final_prompt_agent_node）
    result = final_prompt_agent_node(test_state)

    # 3. 打印结果
    print("\n" + "="*50)
    print("Test Result:")
    print("="*50)
    print(f"Final Prompt:\n{json.dumps(result['final_prompt'], indent=2, ensure_ascii=False)}")

    # 4. 验证结果格式
    positive = result["final_prompt"]["positive"]
    negative = result["final_prompt"]["negative"]
    print("\n" + "-"*30)
    print("Validation:")
    print(f"- Positive Prompt is a sentence: {len(positive.strip().split('.')) >= 1 and positive.strip().endswith('.')}")
    print(f"- Positive contains weights: {'(' in positive and ':' in positive and ')' in positive}")
    print(f"- Positive contains random options: '{{' in positive and '}}' in positive")
    print(f"- Negative Prompt is a sentence: {len(negative.strip().split('.')) >= 1 and negative.strip().endswith('.')}")