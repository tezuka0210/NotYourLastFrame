import json
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from .state import AgentState

def prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent ---")

    # 1. Gather all context
    user_input = state.get("user_input", "")
    intent = state.get("intent", "")
    style = state.get("style", "")
    image_caption = state.get("image_caption", "")
    knowledge = state.get("knowledge_context", "")
    selected_workflow = state.get("selected_workflow", "")

    # 2. Initialize LLM
    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0.7, # Slightly creative
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. System Prompt
    system_prompt = """
    You are an expert Stable Diffusion Prompt Engineer for ComfyUI.
    Your goal is to generate high-quality English prompts based on the user request and analysis.

    Context:
    - Style: {style}
    - Knowledge/Background: {knowledge}
    - Source Image Content: {image_caption}
    - Target Workflow: {workflow}

    Instructions:
    1. Create a detailed 'positive_prompt' emphasizing lighting, texture, and composition.
    2. Create a standard 'negative_prompt' to avoid artifacts.
    3. Use ComfyUI weighting syntax if needed (e.g., (masterpiece:1.2)).
    4. Output JSON format:
       {{
         "positive": "...",
         "negative": "..."
       }}
    """

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "User Request: {input} | Intent: {intent}")
    ])

    # 4. Execute
    chain = prompt | llm

    result = chain.invoke({
        "style": style,
        "knowledge": knowledge,
        "image_caption": image_caption,
        "workflow": selected_workflow,
        "input": user_input,
        "intent": intent
    })

    # 5. Parse and Return
    try:
        final_prompts = json.loads(result.content)
    except json.JSONDecodeError:
        final_prompts = {
            "positive": user_input,
            "negative": "bad quality, low res"
        }

    print("AGENCY: Prompt Agent Generated Prompts.")

    return {"final_prompt": final_prompts}