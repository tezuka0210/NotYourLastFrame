import json
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from .state import AgentState

def final_prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent (Plain Text Mode) ---")

    # 1. 获取输入
    user_input = state.get("user_input", "") 
    intent = state.get("intent", "")  # 保留但未使用，兼容原有状态结构
    style = state.get("style", "")
    knowledge = state.get("knowledge_context", "")  # 保留但未使用
    global_context = state.get("global_context", "")

    # =========================================================================
    # 步骤 A: 直接处理纯文本输入，不解析权重，原样保留所有词汇
    # =========================================================================
    # 仅做简单的空值处理，不修改任何用户输入的词汇
    llm_view_input = user_input.strip() if user_input.strip() else "no visual elements"
    
    print(f"DEBUG: Input to LLM -> {llm_view_input}")
    # =========================================================================

    # 2. 初始化 LLM
    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0.3, 
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. System Prompt (移除权重相关逻辑，仅保留纯文本描述规则)
    system_prompt = """
    You are an Art Director describing a visual scene.
    
    ### INPUT DATA
    - Visual Elements: {masked_input}
    - Context: {global_context}
    - Style: {style}

    ### CRITICAL FORMATTING RULES
    1. **Structure:** You MUST write a visual description sentence starting with phrases like "The image features...", "The scene displays...", or "A view of...".
    2. **Content:** You MUST use all the visual elements provided in {masked_input} exactly as they are, without modifying any words or adding/removing any vocabulary.
    3. **FORBIDDEN:**
       - DO NOT write narratives like "discussing", "talking", "thinking".
       - DO NOT treat elements as people unless the keyword says "person".
       - These are visual tags, not characters in a story.

    ### OUTPUT JSON
    {{
        "positive": "The image features [all input elements exactly as provided]...",
        "negative": "low quality..."
    }}
    """

    # 4. 创建模板
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "Describe the scene using the provided visual elements exactly as they are.")
    ])

    chain = prompt | llm

    # 5. 执行
    result = chain.invoke({
        "masked_input": llm_view_input,  # 直接传入纯文本用户输入
        "global_context": global_context,
        "style": style
    })

    # 6. 解析结果（移除权重还原逻辑，直接使用LLM输出）
    try:
        final_prompts = json.loads(result.content)
        # 确保positive字段存在，且不修改用户输入的任何词汇
        positive_text = final_prompts.get("positive", llm_view_input)
        negative_text = final_prompts.get("negative", "low quality, blurry, distorted")
        
        final_prompts = {
            "positive": positive_text,
            "negative": negative_text
        }

    except Exception as e:
        print(f"Error: {e}")
        final_prompts = {
            "positive": user_input,  # 异常时直接返回原始用户输入
            "negative": "bad quality"
        }

    print(f"AGENCY: Final Prompt Output: {final_prompts['positive']}")
    return {"final_prompt": final_prompts}