import json
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from .state import AgentState

# Define descriptions/rules for your workflows here.
# This helps the Agent understand strict logic constraints.
WORKFLOW_METADATA = {
    "ImageGenerateImage_Basic.json": "General purpose image-to-image generation. Use this for standard requests.",
    "ImageGenerateImage_Canny.json": "SPECIALIZED workflow. Use this ONLY when the parent node is 'ImageCanny.json' or involves Canny Edge Detection.",
    "ImageCanny.json": "Extracts edge maps from images.",
    # You can add other files here as needed.
    # Files not in this list will just show their filename.
}

def format_workflow_list(file_list):
    """
    Helper function to combine filename with its description.
    Output format: "- filename.json: description"
    """
    formatted_lines = []
    for f in file_list:
        desc = WORKFLOW_METADATA.get(f, "No specific restrictions.")
        formatted_lines.append(f"- {f}: {desc}")
    return "\n".join(formatted_lines)

def workflow_selector_node(state: AgentState):
    print("--- Running Workflow Agent ---")

    # 1. Retrieve data
    intent = state.get("intent", "")
    user_input = state.get("user_input", "")
    workflow_files = state.get("workflow_list", [])
    parent_workflow = state.get("parent_workflow", "None")

    final_intent = intent if intent else user_input

    if not workflow_files:
        return {
            "selected_workflow": "Error: No workflows available",
            "title": "Error"
        }

    # 2. Initialize LLM with JSON mode enforced
    # "response_format" ensures valid JSON output
    llm = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0,
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. Prepare list
    formatted_file_list = format_workflow_list(workflow_files)

    # 4. Define Prompt for JSON Output
    system_prompt = """
    You are a ComfyUI workflow orchestration engine.
    Your task is to select the correct workflow and generate a short UI title.

    Available Workflows:
    {file_list}

    Current Context:
    - User Intent: {input}
    - Parent Node: {parent_info}

    Instructions:
    1. Select the best JSON filename based on the intent and parent logic.
       (Rule: If parent is 'ImageCanny.json', prefer Canny workflows).
    2. Generate a short, punchy title (3-5 words) summarizing the action (e.g., "Canny Image Gen", "Cyberpunk Video").
    3. You MUST return a valid JSON object with exactly these two keys:
       {{
         "filename": "selected_file.json",
         "title": "The Generated Title"
       }}
    """

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
    ])

    # 5. Execute
    chain = prompt | llm

    result = chain.invoke({
        "file_list": formatted_file_list,
        "input": final_intent,
        "parent_info": parent_workflow
    })

    # 6. Parse JSON Content
    try:
        parsed_result = json.loads(result.content)
        selected_file = parsed_result.get("filename", "default.json")
        generated_title = parsed_result.get("title", "New Workflow")
    except json.JSONDecodeError:
        print("Error: Failed to parse JSON from LLM")
        selected_file = "error.json"
        generated_title = "Error"

    print(f"AGENCY: Selected: {selected_file} | Title: {generated_title}")

    # 7. Return updated state
    return {
        "selected_workflow": selected_file,
        "workflow_title": generated_title
    }