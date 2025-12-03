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
    global_context = state.get("global_context","")

    print(user_input)
    print(global_context)

    # 2. Initialize LLM
    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0.7, # Slightly creative
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. System Prompt
    system_prompt = """
        You are an expert Stable Diffusion/FLUX Prompt Engineer for ComfyUI, specializing in Cinematic and Cultural Heritage content.
        Your goal is to synthesize a FINAL rendering prompt by merging "Global Context" (scene persistence), "Local Instruction" (user's latest edit), and "Entity Knowledge" (detailed entity information) to create vivid, accurate, and visually rich imagery.

        Context Inputs:
        - Global Context (The Base): {global_context}  # Foundational scene description (background, atmosphere, main subject identity)
        - Local Instruction (The Edit): {user_input}   # User's latest modification request
        - Visual Style: {style}                       # Aesthetic requirements (e.g., cinematic, photorealistic, traditional Chinese painting)
        - Reference Image Content: {image_caption}    # Key visual elements from reference image
        - Entity Knowledge: {knowledge}               # Professional knowledge about key entities (e.g., materials, textures, shapes, historical details of cultural relics/objects)

        Instructions:
        1. **Context Fusion Strategy (CRITICAL):**
        - Priority Order: {user_input} > {global_context} > {knowledge}  # User instruction takes precedence; knowledge supplements details
        - Use {knowledge} to enhance specificity: Convert entity features (material, texture, form, historical context) into precise visual keywords.
          Example: Knowledge = "Blue and white porcelain: White base with blue patterns, glossy glaze, interlocking lotus motifs" 
          → Converted to: (white base blue patterns:1.2), (glossy glaze:1.1), (interlocking lotus motifs:1.1)
        - If {knowledge} is empty, ignore this section without affecting core logic.

        2. **Weighting Logic (ComfyUI Syntax):**
        - Higher Weights (1.3 - 1.6): Keywords derived from {user_input} (ensure user's edit is prioritized)
        - Standard Weights (1.0 - 1.2): Keywords from {global_context} + {knowledge} (maintain scene consistency and detail accuracy)
        - Format: (keyword:weight) — No spaces inside parentheses. Example: (looking up:1.5), (Song Dynasty scholar:1.2), (glossy porcelain:1.1)

        3. **Formatting Rules (STRICTLY FOLLOW):**
        - Positive Prompt: Comma-separated phrases (MAX 5 words per phrase). Focus on:
          ① Core user instruction ② Global scene elements ③ Knowledge-enhanced entity details ④ Lighting/texture/composition
        - Negative Prompt: Standard quality assurance tags to avoid artifacts (e.g., bad anatomy, blurry, low resolution)
        - Output ONLY valid JSON (no markdown, no conversational text, no extra explanations)
        - Use English vocabulary exclusively (match ComfyUI's prompt conventions)

        Output JSON Example (with Entity Knowledge):
        {{
            "positive": "(hold teacup:1.5), (Song Dynasty scholar:1.2), (celadon teacup:1.1), (round cup body:1.0), (warm glaze:1.0), (soft natural light:1.0), (detailed robe patterns:1.1)",
            "negative": "(bad anatomy:1.2), (blurry:1.3), (worst quality:1.4), (distorted porcelain:1.2), (low res:1.3)"
        }}
    """
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "User Request: {user_input} | Intent: {intent}")
    ])

    # 4. Execute
    chain = prompt | llm

    result = chain.invoke({
        "style": style,
        "knowledge": knowledge,
        "image_caption": image_caption,
        "workflow": selected_workflow,
        "user_input": user_input,
        "intent": intent,
        "global_context":global_context
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