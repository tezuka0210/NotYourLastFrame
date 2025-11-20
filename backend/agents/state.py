from typing import TypedDict, List, Optional, Dict, Any

class AgentState(TypedDict):
    # --- Inputs ---
    user_input: str
    image_data: Optional[str]  # Base64 string or URL

    # --- Master Agent Outputs ---
    intent: str
    entities: List[str]
    style: str
    image_caption: str         # Description of the uploaded image

    # --- Knowledge Agent Outputs ---
    knowledge_context: str

    # --- Workflow Agent Outputs ---
    workflow_list: List[str]
    selected_workflow: str
    workflow_title: str
    parent_workflow: Optional[str]

    # --- Prompt Agent Outputs ---
    # We use Dict to store {"positive": "...", "negative": "..."}
    final_prompt: Dict[str, str]