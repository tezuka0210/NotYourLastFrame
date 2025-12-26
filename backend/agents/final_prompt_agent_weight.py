import json
import re
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from .state import AgentState

def final_prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent (Semantic Hint Mode - Fixed) ---")

    # 1. 获取输入
    user_input = state.get("user_input", "") 
    intent = state.get("intent", "")
    style = state.get("style", "")
    knowledge = state.get("knowledge_context", "")
    global_context = state.get("global_context", "")

    # =========================================================================
    # 步骤 A: 带语义提示的占位符 (Semantic Hint Masking)
    # =========================================================================
    protected_tokens = {}
    llm_view_input_list = []
    counter = 0
    pattern = r"\(([^)]+):(\d+(?:\.\d+)?)\)"
    
    # 查找所有匹配项
    all_tokens = list(re.finditer(pattern, user_input))
    
    for match in all_tokens:
        full_string = match.group(0) # (museum:1.5)
        keyword = match.group(1)     # museum
        weight = float(match.group(2))
        
        if weight >= 1.0:
            # === 高权重：制作替身 ===
            placeholder_id = f"__LOCKED_{counter}__"
            
            # 这里生成的字符串用于替换 {masked_input} 变量，
            # 传给 LangChain 后，它会变成最终 Prompt 的一部分。
            # 为了让 LLM 看到 "{ __LOCKED_0__ }"，Python f-string 需要写成 "{{ ... }}"
            # 但这里我们是在 Python 代码里生成字符串，不是在 PromptTemplate 里，
            # 所以生成 "keyword { __LOCKED_0__ }" 即可。
            hint_string = f"{keyword} {{ {placeholder_id} }}" 
            
            protected_tokens[placeholder_id] = full_string
            llm_view_input_list.append(hint_string)
            counter += 1
        else:
            # === 低权重 ===
            llm_view_input_list.append(full_string)

    masked_input_for_llm = ", ".join(llm_view_input_list)
    
    print(f"DEBUG: Input to LLM -> {masked_input_for_llm}")
    # =========================================================================

    # 2. 初始化 LLM
    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0.3, 
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. System Prompt (关键修复：所有示例中的 { } 都改成了 {{ }})
    system_prompt = """
    You are an Art Director describing a visual scene.
    
    ### INPUT DATA
    - Visual Elements: {masked_input}
    - Context: {global_context}
    - Style: {style}

    ### CRITICAL FORMATTING RULES
    The input format is: `visual description {{ __LOCKED_x__ }}`.
    
    1. **Structure:** You MUST write a visual description sentence starting with phrases like "The image features...", "The scene displays...", or "A view of...".
    2. **Handling Tokens:**
       - You will see items like `museum scenes {{ __LOCKED_0__ }}`.
       - You MUST include the ID part `{{ __LOCKED_x__ }}` in your output sentence, placed immediately after the description.
       - **Example:** "A grand museum scenes {{ __LOCKED_0__ }} with bright lighting {{ __LOCKED_1__ }}."
    3. **FORBIDDEN:**
       - DO NOT write narratives like "discussing", "talking", "thinking".
       - DO NOT treat elements as people unless the keyword says "person".
       - These are visual tags, not characters in a story.
    4. **Low Weights:** If you see `(key:0.x)`, convert to `{{{{opt1|opt2}}}}`. 
       (Note: double braces used above to escape for LangChain, LLM sees single braces)

    ### OUTPUT JSON
    {{
        "positive": "The image features [Element {{ __LOCKED_x__ }}]...",
        "negative": "low quality..."
    }}
    """

    # 4. 创建模板
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "Describe the scene.")
    ])

    chain = prompt | llm

    # 5. 执行
    result = chain.invoke({
        # 这里传入的内容本身包含 { } 是没问题的，因为它是作为变量值填进去的
        "masked_input": masked_input_for_llm, 
        "global_context": global_context,
        "style": style
    })

    # 6. 解析与还原
    try:
        final_prompts = json.loads(result.content)
        positive_text = final_prompts.get("positive", "")
        negative_text = final_prompts.get("negative", "")

        # =====================================================================
        # 步骤 B: 智能还原
        # =====================================================================
        restored_positive = positive_text
        
        for placeholder_id, original_weighted_string in protected_tokens.items():
            # 正则匹配 { __LOCKED_x__ } (允许空格)
            id_pattern = r"\{\s*" + re.escape(placeholder_id) + r"\s*\}"
            
            if re.search(id_pattern, restored_positive):
                restored_positive = re.sub(id_pattern, original_weighted_string, restored_positive)
            elif placeholder_id in restored_positive:
                restored_positive = restored_positive.replace(placeholder_id, original_weighted_string)
            else:
                # 强制找回
                restored_positive += f", {original_weighted_string}"

        final_prompts["positive"] = restored_positive
        final_prompts["negative"] = negative_text
        # =====================================================================

    except Exception as e:
        print(f"Error: {e}")
        final_prompts = {
            "positive": user_input,
            "negative": "bad quality"
        }

    print(f"AGENCY: Final Prompt Output: {final_prompts['positive']}")
    return {"final_prompt": final_prompts}