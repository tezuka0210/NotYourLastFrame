import os
import dashscope
from http import HTTPStatus # 用于检查API响应状态
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# --- 初始化和配置 ---
load_dotenv() # 加载 .env 文件中的环境变量

app = Flask(__name__)
# 启用CORS，允许你的前端页面访问这个API
CORS(app) 

# --- MODIFIED: 配置Qwen API ---
api_key = os.getenv("DASHSCOPE_API_KEY")
if not api_key:
    raise ValueError("未找到DASHSCOPE_API_KEY，请检查.env文件")
dashscope.api_key = api_key


# --- 知识注入的指令 (Meta-Prompt) ---
# 这个指令本身是通用的，不需要改变
KNOWLEDGE_INJECTION_SYSTEM_PROMPT = """
你是一位精通历史文化和艺术的专家。请为一个AI绘画工具，根据用户输入的简单概念，生成一段详细、丰富的视觉描述关键词。
你的任务是：
1. 识别核心概念。
2. 围绕这个概念，扩展出具体的、视觉化的细节，特别是服装、配饰、场景、氛围等。
3. 以逗号分隔的关键词或短语形式输出，以便AI绘画工具更好地理解。
4. **不要包含任何解释性语句，只输出关键词和短语。**
例如，如果用户概念是“明朝官员”，你应该输出：“乌纱帽, 红色圆领袍, 胸前有仙鹤补子, 腰束革带, 面容严肃, 站在宫殿的庭院里”。
"""

# --- 创建API端点 ---
@app.route('/enhance-prompt', methods=['POST'])
def enhance_prompt():
    """接收简单prompt，返回增强后的prompt"""
    # 1. 获取前端发送的数据
    data = request.get_json()
    if not data or 'prompt' not in data:
        return jsonify({'error': '请求数据不合法，缺少 "prompt" 字段'}), 400
    
    user_prompt = data['prompt']
    
    try:
        # --- MODIFIED: 调用Qwen模型进行知识注入 ---
        # Qwen API推荐使用messages格式，可以更好地控制模型的角色和行为
        messages = [
            {'role': 'system', 'content': KNOWLEDGE_INJECTION_SYSTEM_PROMPT},
            {'role': 'user', 'content': f'现在，请为以下概念生成描述：\n用户概念："{user_prompt}"'}
        ]
        
        # 调用Dashscope的Generation API
        response = dashscope.Generation.call(
            model='qwen-plus',  # 你可以选择 'qwen-turbo', 'qwen-plus', 或 'qwen-max'
            messages=messages,
            result_format='message',  # 指定返回格式
        )

        # 检查API调用是否成功
        if response.status_code == HTTPStatus.OK:
            # 提取生成的知识片段
            knowledge_snippet = response.output.choices[0]['message']['content'].strip()
            
            # 3. 组合成最终的增强版Prompt
            final_prompt = f"{user_prompt}, {knowledge_snippet}, 杰作, 最高质量, 细节丰富"

            # 4. 将结果返回给前端
            return jsonify({'enhanced_prompt': final_prompt})
        else:
            # 如果API返回错误
            print(f"调用Dashscope API失败: Code: {response.code}, Message: {response.message}")
            return jsonify({
                'error': '调用AI服务失败',
                'details': f"Code: {response.code}, Message: {response.message}"
            }), 500

    except Exception as e:
        print(f"处理请求时发生未知错误: {e}")
        return jsonify({'error': '服务器内部错误，请检查后端日志'}), 500

# --- 启动服务器 ---
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)