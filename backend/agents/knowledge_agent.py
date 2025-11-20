from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from .state import AgentState

def knowledge_agent_node(state: AgentState):
    print("--- Running Knowledge Agent (Internal Brain) ---")

    # 1. 获取数据
    entities = state.get("entities", [])
    style = state.get("style", "")
    user_input = state.get("user_input", "") # 多拿一个原始输入作为备用

    # 2. 调试打印：看看 Master Agent 到底传了什么过来
    print(f"DEBUG: Master传来的 Style: '{style}' | Entities: {entities}")

    # 3. 兜底逻辑：如果 Master 没提取出东西，就用原始 User Input
    # 这样保证 Knowledge Agent 永远有活干
    target_info = ""
    if entities or style:
        target_info = f"Entities: {', '.join(entities)}\nStyle: {style}"
    else:
        print("⚠️ Master没提取到有效信息，使用原始输入兜底...")
        target_info = f"User Context: {user_input}"

    # 4. 调用 LLM
    llm = ChatOpenAI(model="gpt-4o", temperature=0.5)

    system_prompt = """
    You are a Knowledge Specialist for an Art Generation System.
    Your task is to provide visual descriptions and background information based on the provided context.

    Goal: Enhance the visual details (clothing, lighting, architecture, atmosphere).
    Keep it concise (3-5 sentences).
    """

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "Context Information:\n{info}\n\nPlease provide visual enhancement knowledge.")
    ])

    chain = prompt | llm

    result = chain.invoke({"info": target_info})

    print(f"AGENCY: Knowledge generated :{result.content} ")
    return {"knowledge_context": result.content}