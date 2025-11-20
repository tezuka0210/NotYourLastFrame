import json
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
from .state import AgentState

def master_agent_node(state: AgentState):
    print("--- Running Master Agent ---")

    user_text = state.get("user_input", "")
    image_data = state.get("image_data", None)

    # 1. Initialize LLM (GPT-4o is required for Image Vision)
    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0,
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 2. Construct the System Prompt
    system_prompt = """
    You are the "Master Brain" of a creative AI system.
    Your task is to analyze User Input (Text + Optional Image) and extract structured information.

    IMPORTANT:
    1. The user input might be in Chinese or other languages.
    2. You MUST extract specific visual entities and style keywords.
    3. Please translate the extracted values into English for better downstream processing.

    Output JSON format requirements:
    {
        "intent": "Core action (e.g., 'text_to_image', 'image_to_video', 'modify_image')",
        "entities": ["list", "of", "visual", "subjects", "e.g., 'man', 'robe', 'vase'"],
        "style": "Visual style description (e.g., 'Ancient Chinese Court', 'Photorealistic')",
        "image_caption": "Brief description of the uploaded image content (if any, else empty)"
    }
    """

    # 3. Construct the User Message (Text + Image)
    content_blocks = [{"type": "text", "text": f"System Instruction: {system_prompt}\n\nUser Input: {user_text}"}]

    if image_data:
        # Assuming image_data is a base64 string or URL
        # If it's base64, header needs to be handled by frontend or here.
        # For this example, we assume a standard URL or formatted data URI.
        content_blocks.append({
            "type": "image_url",
            "image_url": {"url": image_data}
        })

    message = HumanMessage(content=content_blocks)

    # 4. Execute
    response = llm.invoke([message])

    # 5. Parse JSON
    try:
        parsed_data = json.loads(response.content)
    except json.JSONDecodeError:
        print("❌ Master Agent: JSON Parse Error")
        parsed_data = {
            "intent": user_text,
            "entities": [],
            "style": "General",
            "image_caption": ""
        }

    print(f"AGENCY: Master Agent Intent: {parsed_data.get('intent')}")

    # 6. Update State
    return {
        "intent": parsed_data.get("intent"),
        "entities": parsed_data.get("entities"),
        "style": parsed_data.get("style"),
        "image_caption": parsed_data.get("image_caption")
    }