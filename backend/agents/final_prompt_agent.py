import json
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from .state import AgentState

def final_prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent (Updated for Sentence Prompts) ---")

    # 1. 从状态中获取上下文（变量名与你原代码一致）
    user_input = state.get("user_positive_input", "")
    intent = state.get("intent", "")
    style = state.get("style", "")
    image_caption = state.get("image_caption", "")
    knowledge = state.get("knowledge_context", "")
    selected_workflow = state.get("selected_workflow", "")
    global_context = state.get("global_context","")

    # 2. 初始化 LLM（保持 GPT-4o，温度 0.7，强制 JSON 输出）
    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0.7,
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. 仅添加 weight<1 的选项差异限制，其他保持原始提示词内容
    system_prompt = """
    You are an expert Stable Diffusion Prompt Engineer for ComfyUI.
    Your goal is to generate coherent, complete English sentences as prompts (not isolated phrases) based on the user request and analysis, integrating ComfyUI syntax for weighting and random selection.

    Context:
    - Source Image Content: {image_caption}
    - Global Context (The Base): {global_context}
    - Local Instruction (The Edit): {user_input}   
    - Visual Style: {style} 
    - Entity Knowledge: {knowledge} 

    Weight Definition & Syntax Rules:
    1.  Weight > 1: Higher value = more important (must prioritize this detail, no flexibility).
    2.  Weight = 1: Standard requirement (strictly follow the content, no expansion).
    3.  Weight < 1: Represents ambiguous intent (allow 2-3 options using {{option1|option2|option3}} syntax; all options ≤5 words).
        *   **Critical:** For weight < 1, the nature of the options is determined by how close the weight is to 0 or 1:
            *   A weight **closer to 0** (e.g., 0.1, 0.2) means the options should be **completely different and from distinct categories** (e.g., for "bright sun", options could be `{{bright sun|full moon|stormy sky}}`).
            *   A weight **closer to 1** (e.g., 0.8, 0.9) means the options should be **similar and within the same category** (e.g., for "bright sun", options could be `{{bright sun|glowing sun|radiant sun}}`).
    4.  Random Selection: Use {{option1|option2|option3}} *only* for content with weight < 1 (embed directly in the sentence).
    5.  Sentence Requirement: Prompts must be complete, coherent sentences (not phrases) that describe the full image/transformation logic, with weighted/content options integrated naturally.

    Instructions:
    1. Context Fusion Strategy (CRITICAL):
        - Priority Order: {user_input} > {global_context} > {knowledge}  # User instruction takes precedence; knowledge supplements details
        - Use {knowledge} to enhance specificity: Convert entity features (material, texture, form, historical context) into precise visual keywords.
          Example: Knowledge = "Blue and white porcelain: White base with blue patterns, glossy glaze, interlocking lotus motifs" 
          → Converted to: (white base blue patterns:1.2), (glossy glaze:1.1), (interlocking lotus motifs:1.1)
        - If {knowledge} is empty, ignore this section without affecting core logic.

    2. Positive Prompt Rules:
       - Must be a complete English sentence (not isolated phrases)
       - Emphasize lighting, texture, and composition
       - Integrate (content:weight) for key details (≤5 words per weighted content chunk)
       - For weight < 1: Embed {{option1|option2|option3}} (2-3 options, each ≤5 words) within the weighted structure, following the critical rule for option differences
       - Ensure natural flow (weighted chunks/options fit seamlessly into the sentence)

    3. Negative Prompt Rules:
       - Must be a complete English sentence (not isolated phrases)
       - Focus on avoiding image defects/artifacts
       - Integrate (content:weight) for key negative details (≤5 words per weighted content chunk)
       - For weight < 1: Embed {{option1|option2|option3}} (2-3 options, each ≤5 words) within the weighted structure, following the critical rule for option differences
       - Ensure natural flow (weighted chunks/options fit seamlessly into the sentence)

    4. Output Rules:
       - Strictly follow sentence structure (no phrase lists), weight definition, and syntax rules
       - No extra text, only JSON format (no line breaks in prompt strings):
    {{
      "positive": "Complete positive sentence with (weighted content:1.5) and {{option1|option2}} integrated naturally",
      "negative": "Complete negative sentence with (weighted defect:1.3) and {{option1|option2|option3}} integrated naturally"
    }}
    """

    # 【修复核心】创建 Prompt 模板 + 定义 chain（仅补充缺失的 chain 定义，不修改其他逻辑）
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "User Request: {input} | Intent: {intent}")
    ])
    chain = prompt | llm  # 仅补充这一行，修复 chain 未定义的报错

    # 4. 执行 LLM 调用（保持原始参数）
    result = chain.invoke({
        "image_caption": image_caption,
        "user_input": user_input,
        "intent": intent,  # 恢复原始的 intent 参数传递
        "knowledge": knowledge
    })

    # 5. 解析结果（保持你原有的异常处理逻辑）
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
# 测试代码（保持你原始的测试用例）
# ==========================
if __name__ == "__main__":
    # 1. 准备测试用的 AgentState（模拟真实场景的输入）
    test_state = AgentState({
        "user_input": "(sandy beach:1.5), (running puppy:1.6), (bright sun:0.2), (soft fur:1.3), (joyful motion:1.7)",
        "image_caption": "",  # 无原始图片描述，仅基于用户输入生成
        "intent": "generate a vivid beach scene with a playful puppy"  # 恢复原始的 intent
    })

    # 2. 运行 Agent
    result = prompt_agent_node(test_state)

    # 3. 打印结果
    print("\n" + "="*50)
    print("Test Result:")
    print("="*50)
    print(f"Final Prompt:\n{json.dumps(result['final_prompt'], indent=2, ensure_ascii=False)}")

    # 4. 验证结果格式（保持原始的验证逻辑）
    positive = result["final_prompt"]["positive"]
    negative = result["final_prompt"]["negative"]
    print("\n" + "-"*30)
    print("Validation:")
    print(f"- Positive Prompt is a sentence: {len(positive.split('.')) >= 1}")
    print(f"- Positive contains weights: {'(' in positive and ':' in positive and ')' in positive}")
    print(f"- Positive contains random options: {'{' in positive and '}' in positive}")
    print(f"- Negative Prompt is a sentence: {len(negative.split('.')) >= 1}")