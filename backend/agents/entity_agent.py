import json
import os
import base64
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

class EntityAgent:
    def __init__(self):
        # 初始化 GPT-4o 视觉模型
        self.llm = ChatOpenAI(
            model="gpt-4o",
            temperature=0,
            model_kwargs={"response_format": {"type": "json_object"}}
        )

    def _encode_image(self, image_path):
        """将本地物理路径图片转为 Base64 供 Vision 使用"""
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')

    def detect_entities_from_vision(self, image_path, original_prompt):
        """
        核心逻辑：结合生成图和原始 Prompt，提取出适合分割的实体数组
        """
        print(f"--- Running Entity Vision Agent ---")
        
        if not os.path.exists(image_path):
            print(f"❌ EntityAgent: 找不到图片 {image_path}")
            return ["object"]

        # 1. 准备图片数据 (Base64)
        base64_image = self._encode_image(image_path)

        # 2. 构建 System Prompt
        # 强调：不要拆分附属物（如衣服），要提取独立、完整的视觉主体
        system_prompt = """
        You are a Visual Entity Analyzer with priority judgment capability. Your goal is to identify distinct, complete visual subjects in the provided image, following strict priority rules.
        
        CORE PRIORITY RULES (MANDATORY):
        1. Highest Priority: Living moving objects (humans, animals, birds, fish, insects, etc.) - MUST identify these first and prioritize them.
        2. Medium Priority: Background buildings/structures (houses, bridges, roads, cars, furniture, etc.) - Identify only if they are prominent and independent.
        3. Lowest Priority (GENERALLY EXCLUDE): Flowers, grass, trees, plants - DO NOT list these entities unless they are the absolute core subject of the image (e.g., the image is only a single tree with no other objects).
        
        BASIC RULES (SUPPLEMENTARY):
        1. "Subject Completeness": If a person is wearing a dress, the entity is "woman" or "person", NOT "dress". Do not split attached accessories from the main subject.
        2. "Semantic Guidance": Use the provided 'original_prompt' to understand user intent, but only list entities that are ACTUALLY VISIBLE in the image.
        3. "Segmentation Ready": Return simple, clear English nouns (singular form preferred) that a segmentation model (like SAM) can easily understand (e.g., "man", "dog", "house").
        4. "No duplication": Do not return overlapping entities like ['man', 'head', 'arm']. Just return the most comprehensive main subject (e.g., ['man']).
        5. "Minimal List": Only return entities that meet the priority rules, avoid trivial or background elements (e.g., exclude "grass" even if visible).

        Return JSON format (strictly follow, no extra text):
        {
            "entities": ["entity1", "entity2", ...]
        }
        """

        # 3. 构建消息
        content_blocks = [
            {"type": "text", "text": f"Original Prompt used for generation: {original_prompt}"},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{base64_image}"}
            }
        ]

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=content_blocks)
        ]

        # 4. 执行并解析
        try:
            response = self.llm.invoke(messages)
            parsed_data = json.loads(response.content)
            entities = parsed_data.get("entities", [])
            print(f"👁️ Entity Vision Agent 识别到: {entities}")
            return entities
        except Exception as e:
            print(f"❌ EntityAgent Error: {e}")
            return ["object"]