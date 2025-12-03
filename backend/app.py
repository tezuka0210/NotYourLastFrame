import os
import json
import requests
import uuid
import time
import urllib.parse
import websocket # 用于与ComfyUI进行实时通信
import shutil
import mimetypes
import re
from flask import Flask, request, jsonify, send_from_directory, render_template, send_file, abort, Response
from flask_cors import CORS
from dotenv import load_dotenv
from typing import Optional
from moviepy import VideoFileClip, concatenate_videoclips,ImageClip,AudioFileClip,concatenate_audioclips
# 导入之前设计的数据库操作模块
from database import update_node, get_tree_as_json
import database
import random
import sys
import base64
from pathlib import Path
# 将agents文件夹添加到Python路径（确保能导入）
sys.path.append(str(Path(__file__).parent / "agents"))
from agents.utils import get_all_workflow_names
from agents.master_agent import master_agent_node
from agents.knowledge_agent import knowledge_agent_node
from agents.workflow_agent import workflow_selector_node
from agents.prompt_agent import prompt_agent_node
from agents.final_prompt_agent import final_prompt_agent_node 


# --- 1. 初始化与配置 ---

load_dotenv()
app = Flask(__name__, template_folder='templates')
CORS(app)

# --- 模式开关 ----
APP_MODE = os.getenv('APP_MODE', 'server') 
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
print(f"--- 应用程序正在以 {APP_MODE.upper()} 模式运行 ---")

# --- 配置常量 ---
COMFYUI_SERVER_ADDRESS = "223.193.6.178:8188" # ComfyUI后端的地址和端口
CLIENT_ID = str(uuid.uuid4()) # 为我们的后端应用生成一个唯一的客户端ID
# UPLOAD_FOLDER = 'assets'
# os.makedirs(UPLOAD_FOLDER, exist_ok=True)

if APP_MODE == 'local':
    # 本地模式：使用 backend/local_assets 文件夹
    LOCAL_ASSETS_PATH = os.path.join(BASE_DIR, 'local_assets')
    COMFYUI_INPUT_PATH = os.path.join(LOCAL_ASSETS_PATH, 'input')
    COMFYUI_OUTPUT_PATH = os.path.join(LOCAL_ASSETS_PATH, 'output')
    print(f"本地模式：使用 '{LOCAL_ASSETS_PATH}' 作为资源根目录")
else:
    BASE_COMFYUI_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'comfyui', 'comfyui'))
    COMFYUI_INPUT_PATH = os.path.join(BASE_COMFYUI_PATH, 'input')
    COMFYUI_OUTPUT_PATH = os.path.join(BASE_COMFYUI_PATH, 'output')
    print(f"服务器模式：使用 '{BASE_COMFYUI_PATH}' 作为 ComfyUI 根目录")

print(f"ComfyUI的输入目录被设置为: {COMFYUI_INPUT_PATH}")
print(f"ComfyUI的输出目录被设置为: {COMFYUI_OUTPUT_PATH}")
os.makedirs(COMFYUI_INPUT_PATH, exist_ok=True)
# 图片目录
IMAGE_DIR = os.path.join(COMFYUI_OUTPUT_PATH)
# 视频目录
VIDEO_DIR = os.path.join(IMAGE_DIR, "video")
STITCHED_OUTPUT_FOLDER = os.path.join(os.path.dirname(__file__), 'stitched_videos') # 存放拼接结果
os.makedirs(STITCHED_OUTPUT_FOLDER, exist_ok=True)

# --- 2. 核心辅助函数 ---

def find_node_id_by_title(workflow: dict, target_title: str) -> Optional[str]:
    """遍历工作流JSON，根据自定义的节点标题查找节点ID。"""
    for node_id, node_info in workflow.items():
        if '_meta' in node_info and node_info['_meta'].get('title') == target_title:
            return node_id
    return None

def load_workflow(module_id: str) -> Optional[dict]:
    """根据模块ID从workflows文件夹加载对应的工作流JSON文件。"""
    workflow_path = os.path.join('workflows', f"{module_id}.json")
    if not os.path.exists(workflow_path):
        return None
    with open(workflow_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def queue_comfyui_prompt(workflow: dict) -> dict:
    """将工作流提交到ComfyUI的队列中。"""
    prompt_data = {"prompt": workflow, "client_id": CLIENT_ID}
    print(">>> 正在向ComfyUI提交工作流...")
    
    # 【关键调试代码】打印最终要发送的工作流JSON
    print("--- 最终发送给 ComfyUI 的工作流 (可复制用于调试) ---")
    print(json.dumps(workflow, indent=2, ensure_ascii=False))
    print("----------------------------------------------------")
    
    response = requests.post(f"http://{COMFYUI_SERVER_ADDRESS}/prompt", json=prompt_data)
    response.raise_for_status()
    print("<<< ComfyUI已接受任务。")
    return response.json()

def get_comfyui_outputs(prompt_id: str) -> dict:
    """
    通过WebSocket连接，等待ComfyUI任务执行完成，并获取输出结果。
    这是处理耗时任务的关键。
    """
    ws = websocket.WebSocket()
    ws.connect(f"ws://{COMFYUI_SERVER_ADDRESS}/ws?clientId={CLIENT_ID}")
    
    while True:
        try:
            out = ws.recv()
            if isinstance(out, str):
                message = json.loads(out)
                if message['type'] == 'executing':
                    data = message['data']
                    if data['node'] is None and data['prompt_id'] == prompt_id:
                        # 执行完成的标志
                        break 
        except websocket.WebSocketConnectionClosedException:
            print("WebSocket连接已关闭，任务可能已完成或中断。")
            break
    ws.close()

    # 从/history API获取最终的输出信息
    history_response = requests.get(f"http://{COMFYUI_SERVER_ADDRESS}/history/{prompt_id}")
    history_response.raise_for_status()
    history = history_response.json()
    # --- 【请在这里添加关键调试代码】---
    print("--- ComfyUI History Output (DEBUG) ---")
    print(json.dumps(history, indent=2, ensure_ascii=False))
    print("---------------------------------------")
    outputs = {}
    # 遍历历史记录中的输出
    for node_id, node_output in history[prompt_id]['outputs'].items():
        if 'images' in node_output:
            image_list = []
            for image in node_output['images']:
                cache_buster = int(time.time())
                # ComfyUI的/view API可以获取图片，我们需要构建完整的URL
                image_url = f"/view?filename={urllib.parse.quote_plus(image['filename'])}&subfolder={urllib.parse.quote_plus(image['subfolder'])}&type={image['type']}&_cache_buster={cache_buster}"
                image_list.append(image_url)
            outputs['images'] = image_list
        # 在这里添加对视频等其他输出类型的处理
        if 'audio' in node_output:
            audio_list = []
            for audio_file in node_output['audio']:
                cache_buster = int(time.time())
                # 构建 URL，与图片/视频相同
                audio_url = f"/view?filename={urllib.parse.quote_plus(audio_file['filename'])}&subfolder={urllib.parse.quote_plus(audio_file['subfolder'])}&type={audio_file['type']}&_cache_buster={cache_buster}"
                audio_list.append(audio_url)
            outputs['audio'] = audio_list

        if 'videos' in node_output: 
            video_list = []
            for video in node_output['videos']:
                cache_buster = int(time.time())
                # ComfyUI的/view API可以获取图片，我们需要构建完整的URL
                video_url = f"/view?filename={urllib.parse.quote_plus(video['filename'])}&subfolder={urllib.parse.quote_plus(video['subfolder'])}&type={video['type']}&_cache_buster={cache_buster}"
                video_list.append(video_url)
            outputs['videos'] = video_list

    return outputs

import urllib.parse

def get_input_image_filenames_from_db(node_id: str) -> list[str]:
    """
    从数据库加载节点数据，提取 assets.input.images 中图片的文件名（仅 filename）
    Args: node_id: 节点ID   
    Returns: list[str]: 图片文件名列表（若不存在则返回空列表）
    """
    try:
        # 1. 从数据库获取节点数据
        node_data = database.get_node(node_id)
        if not node_data:
            print(f"节点 {node_id} 不存在于数据库中")
            return []
        
        # 2. 层级解析 assets.input.images 字段
        assets = node_data.get('assets', {})
        input_assets = assets.get('input', {})
        images_urls = input_assets.get('images', [])
        
        # 3. 确保是列表类型
        if not isinstance(images_urls, list):
            print(f"节点 {node_id} 的 assets.input.images 不是列表类型")
            return []
        
        # 4. 提取每个URL中的filename参数（仅保留文件名）
        filenames = []
        for url in images_urls:
            if not isinstance(url, str):
                continue  # 跳过非字符串类型的URL
            parsed_url = urllib.parse.urlparse(url)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            filename = query_params.get('filename', [None])[0]
            if filename:
                filenames.append(filename)
        
        return filenames
    
    except Exception as e:
        print(f"获取节点 {node_id} 的 input.images 文件名时出错: {str(e)}")
        return []

def get_input_image_count_from_db(node_id: str) -> int:
    """
    从数据库加载节点数据，计算 assets.input.images 中的图片数量
    Args:
        node_id: 节点ID
    Returns:
        int: 图片数量（不存在则返回0）
    """
    try:
        # 1. 从数据库加载节点数据
        node_data = database.get_node(node_id)
        if not node_data:
            print(f"节点 {node_id} 不存在于数据库中")
            return 0
        
        # 2. 解析 assets 字段（兼容可能的空值或缺失）
        assets = node_data.get('assets', {})
        input_assets = assets.get('input', {})  # 获取 input 子字段
        images_list = input_assets.get('images', [])  # 获取 images 列表
        
        # 3. 确保是列表类型，避免非列表数据导致错误
        if not isinstance(images_list, list):
            print(f"节点 {node_id} 的 assets.input.images 不是列表类型")
            return 0
        
        # 4. 返回列表长度（即图片数量）
        return len(images_list)
    
    except Exception as e:
        print(f"计算节点 {node_id} 的 input.images 数量时出错: {str(e)}")
        return 0

def encode_image_to_base64(path):
    mime, _ = mimetypes.guess_type(path)
    if not mime:
        mime = "image/png"

    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")

    return f"data:{mime};base64,{encoded}"


# --- 3. Flask API 路由定义 ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route("/view", methods=["GET"])
def view_file():
    filename = request.args.get("filename")
    subfolder = request.args.get("subfolder", "")
    file_type = request.args.get("type", "output") # (v89 修复) 1. 读取 'type' 参数

    if not filename:
        return abort(400, "缺少 filename 参数")

    # (v89 修复) 2. 根据 'type' 决定搜索路径
    if file_type == "input":
        # 如果是 'input' 类型, 只在 input 目录查找
        file_path = os.path.join(COMFYUI_INPUT_PATH, filename)
    else:
        # 否则 (output, temp, etc.)，在 output/ 或 output/video/ 查找
        base_output_path = os.path.join(COMFYUI_OUTPUT_PATH, subfolder)
        file_path = os.path.join(base_output_path, filename)
        # (v89 修复) 增加对 output/video 的兼容
        if not os.path.exists(file_path) and subfolder != "video":
             video_path_alt = os.path.join(COMFYUI_OUTPUT_PATH, "video", filename)
             if os.path.exists(video_path_alt):
                 file_path = video_path_alt

    if not os.path.exists(file_path):
        return abort(404, f"文件 {filename} (类型: {file_type}) 在路径 {file_path} 中不存在")

    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type is None:
        mime_type = "application/octet-stream"

    # --- (v89 核心修复) 视频流逻辑 ---
    if mime_type.startswith("video/") or mime_type.startswith("audio/"):
        try:
            file_size = os.path.getsize(file_path)
            range_header = request.headers.get("Range", None)

            start = 0
            end = file_size - 1
            length = file_size
            status_code = 200 # (v89 修复) 默认 200

            if range_header:
                # (v89 修复) Case 1: 浏览器请求 'Range' (206)
                status_code = 206
                start_str, end_str = range_header.replace("bytes=", "").split("-")
                start = int(start_str)
                end = int(end_str) if end_str else file_size - 1
                length = end - start + 1
            else:
                # (v89 修复) Case 2: 浏览器 没有 请求 'Range' (200)
                # 我们 必须 强制发送 206，并假装它请求了 'bytes=0-'
                # 这样 Chrome 才能在 foreignObject 中播放
                status_code = 206
                # (start=0, end=file_size-1, length=file_size 保持不变)
            with open(file_path, "rb") as f:
                f.seek(start)
                data = f.read(length)

            rv = Response(data, status_code, mimetype=mime_type)
            rv.headers.add("Content-Range", f"bytes {start}-{end}/{file_size}")
            rv.headers.add("Accept-Ranges", "bytes")
            # (v84 修复) Content-Length 由 Flask/Response 自动添加
            rv.headers.add("X-Content-Type-Options", "nosniff")
            return rv

        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # --- 图片或其他文件 (保持不变) ---
    rv = send_file(file_path, mimetype=mime_type)
    rv.headers.add("X-Content-Type-Options", "nosniff")
    return rv

# 和agents通信
@app.route('/api/agents/process', methods=['POST'])
def process_agent_request():
    try:
        # 1. 获取前端传递的参数
        data = request.get_json()
        user_input = data.get('user_input', '')
        node_id = data.get('node_id', '')
        image_url = data.get('image_url', '')
        workflow_context = data.get('workflow_context', {})
        global_context = database.find_global_context(node_id)

        # 处理 image_url 可能是数组、无效类型的情况
        if isinstance(image_url, list) and len(image_url) > 0:
            image_url = image_url[0]  # 取第一个 URL
        elif not isinstance(image_url, str):
            image_url = ''  # 无效类型时设为空字符串
        
        # 初始化 Base64 编码结果（默认 None，表示无图片）
        image_base64 = None
        if image_url:  # 只有当 image_url 非空时，才解析 filename
            parsed_url = urllib.parse.urlparse(image_url)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            filename = query_params.get('filename', [None])[0]  # 提取 filename 参数
            
            # 关键判断：filename 必须非空、非 None，且文件存在
            if filename and isinstance(filename, str):
                local_dir = "/home/zhengzy/comfyui/comfyui/input"
                local_path = os.path.join(local_dir, filename)  # 此时 filename 是字符串，不会报错
                
                # 额外判断文件是否存在，避免 FileNotFoundError
                if os.path.exists(local_path):
                    image_base64 = encode_image_to_base64(local_path)
                else:
                    print(f"警告：图片文件不存在 -> {local_path}")
            else:
                print("警告：未从 image_url 中提取到有效的 filename")
        else:
            print("提示：未传入 image_url，跳过图片处理")
            
        # 2. 准备agent所需的状态
        mock_state = {
            "global_input":global_context,
            "user_input": user_input,
            "intent": user_input,
            "image_data": image_base64,  # 传给master_agent的图片数据（URL格式）
            "workflow_list": get_all_workflow_names(),
            "parent_workflow": workflow_context.get('current_workflow'),
            "selected_workflow": None
        }

        # --- 2. Run Master Agent ---
        state_after_master = master_agent_node(mock_state)
        # Merge state
        current_state = {**mock_state, **state_after_master}

        # --- 3. Run Knowledge Agent (Parallel with Master usually, but here serial) ---
        state_after_knowledge = knowledge_agent_node(current_state)
        current_state.update(state_after_knowledge)

        # --- 4. Run Workflow Agent (User clicks + button) ---
        state_after_workflow = workflow_selector_node(current_state)
        current_state.update(state_after_workflow)

        # --- 5. Run Prompt Agent ---
        state_after_prompt = prompt_agent_node(current_state)
        current_state.update(state_after_prompt)

        print(current_state.get('final_prompt'))
        # 4. 返回处理结果给前端
        return jsonify({
            "status": "success",
            "selected_workflow": current_state.get('selected_workflow'),
            "workflow_title": current_state.get('workflow_title'),
            "message": current_state.get('final_prompt'),
            "intent": current_state.get('intent'),
            "global_context": current_state.get('global_context'),
            "knowledge_context": current_state.get('knowledge_context'),
            "image_caption":current_state.get('image_caption'),
            "style": current_state.get('style')
        })

    except Exception as e:
        print(f"Agent处理出错: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/agents/only-prompt', methods=['POST'])
def only_prompt_agent():
    try:
        # 1. 获取前端传递的参数：新 prompt + 前一轮 Agent 的关键上下文
        data = request.get_json()
        new_positive_prompt = data.get('positive_prompt', '')  # 前端传入的新 prompt
        new_negative_prompt = data.get('negative_prompt', '')
        prev_agent_context = data.get('prev_agent_context', {})  # 前一轮 Agent 结果的上下文

        # 2. 构造 Final Prompt Agent 所需的 state（复用前一轮上下文，覆盖新 prompt）
        prompt_agent_state = {
            # 前一轮 Agent 的上下文（比如 global_input、selected_workflow、knowledge_context 等）
            "global_context": prev_agent_context.get('global_context', ''),
            "intent": prev_agent_context.get('intent', ''),  # 用前一轮 intent 或新 prompt
            "image_caption": prev_agent_context.get('image_caption', ''),  # 前一轮的图片描述（如果有）
            "knowledge_context": prev_agent_context.get('knowledge_context', ''),  # 前一轮的知识上下文
            "selected_workflow": prev_agent_context.get('selected_workflow', ''),  # 前一轮选中的工作流
            # 新传入的 prompt（核心：覆盖 user_input，作为优化的原始输入）
            "user_input": new_positive_prompt,
            # 其他 Final Prompt Agent 依赖的字段（按需从 prev_agent_context 提取）
            "style": prev_agent_context.get('style', ''),
        }
        print(prompt_agent_state)

        # 3. 仅调用 Final Prompt Agent（不跑 Master/Knowledge/Workflow Agent）
        prompt_result = final_prompt_agent_node(prompt_agent_state)
        final_prompt = prompt_result.get('final_prompt', {
            "positive": new_positive_prompt,
            "negative": new_negative_prompt
        })

        # 4. 返回优化后的 prompt 给前端
        return jsonify({
            "status": "success",
            "final_prompt": final_prompt
        })

    except Exception as e:
        print(f"仅执行 Prompt Agent 出错: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/assets/upload', methods=['POST'])
def upload_asset():
    """API: 接收上传文件（支持多文件），保存到 input，更新指定节点的媒体信息，返回更新后的树。"""

    # 1. 检查文件是否存在（支持多文件）
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    files = request.files.getlist('file')  # 获取所有文件
    if not files or all(file.filename == '' for file in files):
        return jsonify({"error": "No selected files"}), 400  # 检查是否有有效文件

    # 2. 获取必要参数
    tree_id = request.args.get('tree_id', default=1, type=int)
    target_node_id = request.args.get('target_node_id')
    if not target_node_id:
        return jsonify({"error": "缺少目标节点ID（target_node_id）"}), 400

    try:
        # 3. 批量保存文件到 ComfyUI input 目录
        asset_urls = []  # 存储 (URL, 扩展名)
        for file in files:
            _, ext = os.path.splitext(file.filename)
            filename = f"{uuid.uuid4()}{ext}"  # 唯一文件名
            filepath = os.path.join(COMFYUI_INPUT_PATH, filename)
            file.save(filepath)
            print(f"    - 文件已上传并保存到: {filepath}")

            # 4. 构建文件访问URL
            asset_url = f"/view?filename={urllib.parse.quote_plus(filename)}&subfolder=&type=input"
            asset_urls.append((asset_url, ext.lower()))

        # 5. 获取目标节点
        target_node = database.get_node(target_node_id)
        if not target_node:
            raise Exception(f"目标节点 {target_node_id} 不存在")

        # 6. 批量更新assets字段
        updated_assets = target_node.get('assets', {})
        updated_assets['input'] = updated_assets.get('input', {})  # 初始化input

        # 按文件类型分类添加
        for asset_url, ext in asset_urls:
            if ext in ['.jpg', '.jpeg', '.png', '.gif']:
                updated_assets['input']['images'] = updated_assets['input'].get('images', []) + [asset_url]
            elif ext in ['.mp4', '.mov', '.avi', '.webm']:
                updated_assets['input']['videos'] = updated_assets['input'].get('videos', []) + [asset_url]
            elif ext in ['.mp3', '.wav', '.flac', '.ogg']:
                updated_assets['input']['audio'] = updated_assets['input'].get('audio', []) + [asset_url]
            else:
                updated_assets['input']['images'] = updated_assets['input'].get('images', []) + [asset_url]

        print(updated_assets)
        # 7. 更新数据库
        database.update_node(
            node_id=target_node_id,
            payload={
                "assets": updated_assets,
                "parameters": target_node.get('parameters', {})
            }
        )

        # 8. 返回更新后的树
        updated_tree = database.get_tree_as_json(tree_id)
        if not updated_tree:
            raise Exception("获取更新后的树失败")

        return jsonify(updated_tree), 200

    except Exception as e:
        print(f"处理上传并更新节点时出错: {e}")
        # 清理已保存的文件
        if 'asset_urls' in locals():
            for asset_url, ext in asset_urls:
                parsed = urllib.parse.urlparse(asset_url)
                query_params = urllib.parse.parse_qs(parsed.query)
                filename = query_params.get('filename', [None])[0]
                if filename:
                    filepath = os.path.join(COMFYUI_INPUT_PATH, urllib.parse.unquote_plus(filename))
                    if os.path.exists(filepath):
                        try:
                            os.remove(filepath)
                        except OSError:
                            pass
        return jsonify({"error": f"处理上传失败: {e}"}), 500


# -------------- 新增：PUT /api/nodes/<node_id>/media-placeholder --------------
# app.py
@app.route('/api/nodes/<node_id>', methods=['PUT'])
def update_node_media(node_id):
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求体不能为空"}), 400

        # 调用 update_node 函数更新节点
        database.update_node(node_id, data)

        # 获取更新后的树
        tree_data = get_tree_as_json(database.get_node(node_id)['tree_id'])
        return jsonify(tree_data), 200

    except Exception as e:
        print("更新节点失败:", e)
        return jsonify({"error": str(e)}), 500



@app.route('/api/trees/<int:tree_id>', methods=['GET'])
def get_tree(tree_id):
    """API: 获取一棵树的完整结构，如果项目或根节点不存在，则自动创建。"""
    tree_data = database.get_tree_as_json(tree_id)
    
    # 场景1：连项目（树）本身都不存在
    if not tree_data:
        print(f"项目 {tree_id} 不存在，正在自动创建...")
        # 简单处理：只为ID为1的项目自动创建
        if tree_id == 1:
            new_tree_id = database.create_tree("我的第一个项目")
            database.add_node(new_tree_id, None, "Init", {"description": "项目根节点"})
            tree_data = database.get_tree_as_json(new_tree_id)
        else:
            return jsonify({"error": f"Tree with ID {tree_id} not found."}), 404
        
    #  场景2：项目存在，但里面是空的（没有任何节点）
    elif not tree_data.get('nodes'):
        print(f"项目 {tree_id} 为空，正在自动添加根节点...")
        database.add_node(tree_id, None, "Init", {"description": "项目根节点"})
        # 重新获取一次数据
        tree_data = database.get_tree_as_json(tree_id)
        
    return jsonify(tree_data)

# --- 【新增】删除节点的API接口 ---
@app.route('/api/nodes/<node_id>', methods=['DELETE'])
def delete_node(node_id):
    """API: 删除一个节点及其所有后代。"""
    try:
        # 调用我们新创建的数据库函数
        database.delete_node_and_descendants(node_id)
        return jsonify({"status": "success", "message": f"节点 {node_id} 及其后代已被删除。"}), 200
    except Exception as e:
        print(f"删除节点 {node_id} 时出错: {e}")
        return jsonify({"error": "删除节点失败。"}), 500

@app.route('/api/nodes', methods=['POST'])
def create_node():
    # --- 本地模式 ---
    if APP_MODE == 'local':
        print(">>> 处于本地模式：模拟生成。")
        data = request.get_json()
        print(data)
        tree_id = data.get('tree_id')
        node_id = data.get('node_id')
        parent_ids = data.get('parent_ids', [])
        module_id_from_frontend = data.get('module_id')
        node_title = data.get('title')
        parameters = data.get('parameters', {})
        if module_id_from_frontend == 'AddText':
            print(">>> 检测到 AddText 模块，仅保存文本节点到数据库。")
            # "AddText" 模块没有 ComfyUI 操作，它只保存节点
            new_node_id = database.add_node(
                node_id=node_id,
                tree_id=tree_id,
                parent_ids=parent_ids,
                module_id=module_id_from_frontend,
                parameters=parameters,
                title='AddText',
                assets={}, # 没有媒体资源
                status='completed'
            )
            if not new_node_id:
                raise Exception("保存 AddText 节点到数据库失败。")

            # 返回更新后的树
            updated_tree = database.get_tree_as_json(tree_id)
            return jsonify(updated_tree), 201

        if module_id_from_frontend == 'AddWorkflow':
            print(">>> 检测到 AddWorkflow 模块，仅保存文本节点到数据库。")
            # "AddWorkflow" 模块没有 ComfyUI 操作，它只保存节点
            new_node_id = database.add_node(
                node_id=node_id,
                tree_id=tree_id,
                parent_ids=parent_ids,
                module_id=module_id_from_frontend,
                parameters=parameters,
                title='AddWorkflow',
                assets={}, # 没有媒体资源
                status='completed'
            )
            if not new_node_id:
                raise Exception("保存 AddWorkflow 节点到数据库失败。")

        try:
            # 尝试从 output/video 或 output 随机选择一个文件
            main_output_dir = COMFYUI_OUTPUT_PATH # /local_assets/output
            video_output_dir = os.path.join(COMFYUI_OUTPUT_PATH, 'video') # /local_assets/output/video
            audio_output_dir = os.path.join(COMFYUI_OUTPUT_PATH, 'audio') # /local_assets/output/audio

            available_files = [] # (文件名, 子文件夹)

            # 1. 查找图片 (在 /output)
            if os.path.exists(main_output_dir):
                available_files.extend([
                    (f, '') for f in os.listdir(main_output_dir)
                    if f.endswith(('.png', '.jpg', '.jpeg'))
                ])
            # 2. 查找视频 (在 /output/video)
            if os.path.exists(video_output_dir):
                available_files.extend([
                    (f, 'video') for f in os.listdir(video_output_dir)
                    if f.endswith(('.mp4', '.mov', '.avi'))
                ])
            # 3. 查找音频 (在 /output/audio)
            if os.path.exists(audio_output_dir):
                available_files.extend([
                    (f, 'audio') for f in os.listdir(audio_output_dir)
                    if f.endswith(('.mp3', '.wav', '.flac'))
                ])

            if not available_files:
                raise FileNotFoundError("在 local_assets/output 目录中找不到任何示例文件 (.png, .mp4, ,mp3)。请先添加文件。")

            # 随机选择一个文件
            fake_filename, subfolder = random.choice(available_files)
            print(f"    - 使用本地模拟文件: {fake_filename} (来自 subfolder: '{subfolder}')")

            # 构建假的 asset URL
            asset_url = f"/view?filename={urllib.parse.quote_plus(fake_filename)}&subfolder={urllib.parse.quote_plus(subfolder)}&type=output"
            outputs = {
            "input": {"images": [], "videos": [], "audio": []},
            "output": {"images": [], "videos": [], "audio": []}
            }

            if subfolder == 'video':
                outputs["output"]["videos"].append(asset_url)
            elif subfolder == 'audio':
                outputs["output"]["audio"].append(asset_url)
            else: 
                outputs["output"]["images"].append(asset_url)

            # 像真实生成一样，将节点添加到数据库
            database.update_node(
                node_id=node_id,
                payload={
                        "title": node_title,
                        "module_id": module_id_from_frontend,
                        "assets": outputs,
                        "parameters": parameters,
                        "status":'completed'
                    }
            )
            if not new_node_id:
                raise Exception("模拟节点执行成功但保存到数据库失败。")

            # 返回更新后的树
            updated_tree = database.get_tree_as_json(tree_id)
            return jsonify(updated_tree), 201

        except Exception as e:
            print(f"本地模拟生成失败: {e}")
            return jsonify({"error": str(e)}), 500


    print(">>> 处于服务器模式：开始 ComfyUI 生成。")
    """API: 创建一个新节点，即执行一次生成操作。"""
    data = request.get_json()
    print(json.dumps(data, indent=2, ensure_ascii=False))
    print("-------------------------------")
    tree_id = data.get('tree_id')
    node_id = data.get('node_id',[]) # 本节点号
    node_title=data.get('title')
    parent_ids = data.get('parent_ids', [])
    module_id_from_frontend = data.get('module_id')
    parameters = data.get('parameters', {})

    # --- 【新增】开始：处理随机 Seed ---
    # 检查 'seed' 是否存在并且其值是否为 None (来自前端的 null)
    REQUIRES_SEED_MODULES = [
        'TextGenerateImage', 
        'ImageGenerateImage_Basic', 
        'ImageGenerateImage_Canny',
        'ImageGenerateVideo', 
        'ImageHDREstoration',
        'PartialRepainting',
        'Put_It_Here',
        'TextGenerateVideo',
        'CameraControl',
        'FLFrameToVideo'  # 根据实际需要补充工作流ID
    ]

    # 定义需要 audio_seed 的工作流列表
    REQUIRES_AUDIO_SEED_MODULES = [
        'TextToAudio'
    ]

    # 处理 seed
    if module_id_from_frontend in REQUIRES_SEED_MODULES:
        # 若参数中没有 seed，新增并赋值
        if 'seed' not in parameters:
            parameters['seed'] = random.randint(0, 999999999999999)
            print(f"    - 工作流 {module_id_from_frontend} 需 seed，已自动生成: {parameters['seed']}")
        # 若参数中有 seed 但为 None，替换为随机值
        elif parameters['seed'] is None:
            parameters['seed'] = random.randint(0, 999999999999999)
            print(f"    - 工作流 {module_id_from_frontend} 检测到空 seed，已生成: {parameters['seed']}")

    # 处理 audio_seed
    if module_id_from_frontend in REQUIRES_AUDIO_SEED_MODULES:
        # 若参数中没有 audio_seed，新增并赋值
        if 'audio_seed' not in parameters:
            parameters['audio_seed'] = random.randint(0, 4294967295)
            print(f"    - 工作流 {module_id_from_frontend} 需 audio_seed，已自动生成: {parameters['audio_seed']}")
        # 若参数中有 audio_seed 但为 None，替换为随机值
        elif parameters['audio_seed'] is None:
            parameters['audio_seed'] = random.randint(0, 4294967295)
            print(f"    - 工作流 {module_id_from_frontend} 检测到空 audio_seed，已生成: {parameters['audio_seed']}")
    # --- 【修改结束】---
    
    
    workflow = None
    final_module_id = module_id_from_frontend # 最终使用的模块ID
    image_filenames = {} # 用于存储需要注入的文件名 { "node_title": "filename.png" }

    try:
        # --- 根据输入情况决定加载哪个工作流和处理输入 ---
        if final_module_id == 'AddText':
            print(">>> 检测到 AddText 模块，仅保存文本节点到数据库。")
            # "AddText" 模块没有 ComfyUI 操作，它只保存节点
            new_node_id = database.add_node(
                node_id=node_id,
                tree_id=tree_id,
                parent_ids=parent_ids,
                module_id=final_module_id,
                parameters=parameters,
                title='AddText',
                assets={}, # 没有媒体资源
                status='completed'
            )
            if not new_node_id:
                raise Exception("保存 AddText 节点到数据库失败。")

            # 返回更新后的树
            updated_tree = database.get_tree_as_json(tree_id)
            return jsonify(updated_tree), 201

        if final_module_id == 'AddWorkflow':
            print(">>> 检测到 AddWorkflow 模块，仅保存文本节点到数据库。")
            # "AddWorkflow" 模块没有 ComfyUI 操作，它只保存节点
            new_node_id = database.add_node(
                node_id=node_id,
                tree_id=tree_id,
                parent_ids=parent_ids,
                module_id=final_module_id,
                parameters=parameters,
                title='AddWorkflow',
                assets={}, # 没有媒体资源
                status='completed'
            )
            if not new_node_id:
                raise Exception("保存 AddWorkflow 节点到数据库失败。")

            # 返回更新后的树
            updated_tree = database.get_tree_as_json(tree_id)
            return jsonify(updated_tree), 201
        # 情况3: Mask 输入 (最高优先级判断)
        # if 'mask_filename' in parameters:
        #     print(">>> 检测到 Mask 输入，加载 Inpainting 工作流...")
        #     final_module_id = 'PartialRepainting' # 强制使用 Inpainting 模块
        #     workflow = load_workflow(final_module_id)
        #     if workflow is None: raise ValueError(f"未找到 Inpainting 工作流 '{final_module_id}.json'")
        #     if len(parent_ids) != 1: raise ValueError("Mask 输入模式需要且仅需要一个父节点提供原图。")
            
        #     # 处理原图输入
        #     original_image_filename = _get_image_info_from_parent(parent_ids[0])
        #     image_filenames["LoadImage"] = original_image_filename
            
        #     # 处理 Mask 输入 (直接使用文件名)
        #     mask_filename = parameters.get('mask_filename')
        #     if not mask_filename: raise ValueError("Mask 文件名在参数中缺失。")
        #     # 确认 Mask 文件存在于 input 目录 (可选的安全检查)
        #     if not os.path.exists(os.path.join(COMFYUI_INPUT_PATH, mask_filename)):
        #         raise FileNotFoundError(f"上传的 Mask 文件 '{mask_filename}' 在 input 目录中未找到。")
        #     image_filenames["LoadImage(Mask)"] = mask_filename
        #     print(f"    - 原图: {original_image_filename}, Mask图: {mask_filename}")

        # 情况2: 两个父节点 -> 图像合并
        count = get_input_image_count_from_db(node_id)
        if count == 2:
            if(module_id_from_frontend == 'FLFrameToVideo'):
                final_module_id = module_id_from_frontend 
                workflow = load_workflow(final_module_id)
                if workflow is None: raise ValueError(f"未找到 FLFrameToVideo 工作流 '{final_module_id}.json'")
                image1_filename = get_input_image_filenames_from_db(node_id)[0]
                image2_filename = get_input_image_filenames_from_db(node_id)[1]
                image_filenames["LoadStartImage"] = image1_filename
                image_filenames["LoadLastImage"] = image2_filename 
            else:
                print(">>> 检测到两个输入,执行ImageMerging工作流...")
                image1_filename = get_input_image_filenames_from_db(node_id)[0]
                image2_filename = get_input_image_filenames_from_db(node_id)[1]
                image_filenames["LoadImage"] = image1_filename
                image_filenames["LoadImage(Move)"] = image2_filename 
                merge_workflow = load_workflow('ImageMerging')
                for node_title, filename in image_filenames.items():
                    target_node_id = find_node_id_by_title(merge_workflow, node_title)
                    if target_node_id:
                        merge_workflow[target_node_id]["inputs"]["image"] = filename
                        print(f"    - 已将文件名 '{filename}' 注入到节点 '{node_title}' (ID: {target_node_id})。")
                queued_prompt = queue_comfyui_prompt(merge_workflow)
                prompt_id = queued_prompt['prompt_id']
                # 使用WebSocket等待并获取输出
                merge_outputs = get_comfyui_outputs(prompt_id)

                parsed_url = urllib.parse.urlparse(batch_outputs.get("images", []))
                query_params = urllib.parse.parse_qs(parsed_url.query)
                merge_filename_merge = query_params.get('filename', [None])[0]
                # 信息注入
                image_filenames["LoadImage"] = merge_filename_merge
                final_module_id = module_id_from_frontend
                workflow = load_workflow(final_module_id)            

        # 情况1: 一个父节点 -> 标准图生图/图生视频
        elif count == 1:
            print(f">>> 检测到一个输入,加载工作流: {module_id_from_frontend}")
            final_module_id = module_id_from_frontend
            workflow = load_workflow(final_module_id)
            if workflow is None: raise ValueError(f"未找到工作流 '{final_module_id}.json'")

            # 处理单个父节点的图像输入 (仅当模块需要时才处理)
            if final_module_id in ['ImageGenerateImage_Basic', 'ImageGenerateImage_Canny','ImageGenerateVideo','CameraControl','ImageCanny','ImageHDRestoration','PartialRepainting','Put_It_Here','RemoveBackground']: # 根据你的模块ID调整
                image_filename = get_input_image_filenames_from_db(node_id)[0]
                image_filenames["LoadImage"] = image_filename
                print(f"    - 输入图: {image_filename}")
            else:
                 print("    - 当前模块不需要父节点图像输入。")


        # 情况0: 没有父节点 -> 文生图/文生视频 或 根节点创建
        else: # count == 0
             print(f">>> 没有输入图片，加载工作流: {module_id_from_frontend}")
             final_module_id = module_id_from_frontend
             workflow = load_workflow(final_module_id)
             if workflow is None: raise ValueError(f"未找到工作流 '{final_module_id}.json'")
             # 检查是否需要上传图片
             if final_module_id in ['ImageGenerateImage_Basic', 'ImageGenerateVideo']:
                  raise ValueError(f"模块 {final_module_id} 需要输入图像，但没有提供父节点。")
             else:
                  print("    - 当前模块是文本生成类型，不需要图像输入。")


        # --- 注入图像文件名到工作流 ---
        for node_title, filename in image_filenames.items():
            target_node_id = find_node_id_by_title(workflow, node_title)
            if target_node_id:
                workflow[target_node_id]["inputs"]["image"] = filename
                print(f"    - 已将文件名 '{filename}' 注入到节点 '{node_title}' (ID: {target_node_id})。")
            else:
                print(f"警告：在工作流 '{final_module_id}.json' 中未找到标题为 '{node_title}' 的节点用于注入文件名。")


        # --- 动态修改工作流 ---
        isVideo = (final_module_id in ['TextGenerateVideo', 'ImageGenerateVideo', 'FLFrameToVideo','CameraControl'])
    
        # PROMPT
        prompt_positive_node_id = find_node_id_by_title(workflow, "CLIP Text Encode (Positive Prompt)")
        if prompt_positive_node_id:
            # 优先使用 optimized_positive_prompt（前端传递的完整 prompt），没有则用原始 prompt
            positive_prompt = parameters.get('optimized_positive_prompt', parameters.get('positive_prompt', ''))
            workflow[prompt_positive_node_id]["inputs"]["text"] = positive_prompt

        prompt_negative_node_id = find_node_id_by_title(workflow, "CLIP Text Encode (Negative Prompt)")
        if prompt_negative_node_id:
            # 同理：用 optimized_negative_prompt 执行生成
            negative_prompt = parameters.get('optimized_negative_prompt', parameters.get('negative_prompt', ''))
            workflow[prompt_negative_node_id]["inputs"]["text"] = negative_prompt

        # WIDTH HEIGHT LENGTH BATCH_SIZE SPEED CAMERA
        size_node_id = find_node_id_by_title(workflow, "Size_Setting")
        if size_node_id:
            if 'width' in parameters:
                workflow[size_node_id]["inputs"]["width"] = parameters['width']
            if 'height' in parameters:
                workflow[size_node_id]["inputs"]["height"] = parameters['height']
            if 'batch_size' in parameters and not isVideo:
                workflow[size_node_id]["inputs"]["batch_size"] = parameters['batch_size']
            if 'length' in parameters:
                workflow[size_node_id]["inputs"]["length"] = parameters['length']
            if 'speed' in parameters:
                workflow[size_node_id]["inputs"]["speed"] = parameters['speed']
            if 'camera_pose' in parameters:
                workflow[size_node_id]["inputs"]["camera_pose"] = parameters['camera_pose']
       
        # RIFE
        rife_node_id = find_node_id_by_title(workflow,"RIFE VFI")
        if rife_node_id:
            if 'multiplier' in parameters:
                workflow[rife_node_id]["inputs"]["multiplier"] = parameters['multiplier']

        # CANNY
        canny_node_id = find_node_id_by_title(workflow,"Canny")
        if canny_node_id:
            if 'low_threshold' in parameters:
                workflow[canny_node_id]["inputs"]["low_threshold"] = parameters['low_threshold']
            if 'high_threshold' in parameters:
                workflow[canny_node_id]["inputs"]["high_threshold"] = parameters['high_threshold']

        # KSAMPLE
        sampler_node_id = find_node_id_by_title(workflow, "KSampler")
        if sampler_node_id:
            if 'seed' in parameters:
                workflow[sampler_node_id]["inputs"]["seed"] = parameters['seed']
            if 'cfg' in parameters:
                workflow[sampler_node_id]["inputs"]["cfg"] = parameters['cfg']
            if 'steps' in parameters:
                workflow[sampler_node_id]["inputs"]["steps"] = parameters['steps']
            if 'denoise' in parameters:
                workflow[sampler_node_id]["inputs"]["denoise"] = parameters['denoise']

        # FLUX GUIDANCE
        guidance_node_id = find_node_id_by_title(workflow, "FluxGuidance")
        if guidance_node_id and 'guidance' in parameters:
            workflow[guidance_node_id]["inputs"]["guidance"] = parameters['guidance']

        # FPS
        fps_node_id = find_node_id_by_title(workflow, "CreateVideo")
        if fps_node_id:
            if 'fps' in parameters:
                workflow[fps_node_id]["inputs"]["fps"] = parameters['fps']
        # video seed
        sampleradv_node_id = find_node_id_by_title(workflow, "KSamplerAdvanced2")
        if sampleradv_node_id:
            if 'seed' in parameters:
                workflow[sampleradv_node_id]["inputs"]["noise_seed"] = parameters['seed']
        
        # STITICH
        stitch_node_id = find_node_id_by_title(workflow,"Image Stitch")
        if stitch_node_id:
            if 'stitch' in parameters:
                workflow[stitch_node_id]["inputs"]["stitch"] = parameters['stitch']

        # REMBG
        rembg_node_id = find_node_id_by_title(workflow,"Image Rembg (Remove Background)")
        if rembg_node_id:
            if 'model' in parameters:
                workflow[stitch_node_id]["inputs"]["model"] = parameters['model']
            if 'foreground_threshold' in parameters:
                workflow[stitch_node_id]["inputs"]["alpha_matting_foreground_threshold"] = parameters['foreground_threshold']
            if 'background_threshold' in parameters:
                workflow[stitch_node_id]["inputs"]["alpha_matting_background_threshold"] = parameters['background_threshold']
            if 'erode_size' in parameters:
                workflow[stitch_node_id]["inputs"]["alpha_matting_erode_size"] = parameters['erode_size']
        # VOICE
        voice_node_id = find_node_id_by_title(workflow,"VibeVoice Single Speaker")
        if voice_node_id:
            if 'text' in parameters:
                workflow[voice_node_id]["inputs"]["text"] = parameters['text']
            if 'voice_speed_factor' in parameters:
                workflow[voice_node_id]["inputs"]["voice_speed_factor"] = parameters['voice_speed_factor']
            if 'audio_seed' in parameters:
                workflow[voice_node_id]["inputs"]["seed"] = parameters['audio_seed']

        # --- 调用ComfyUI并等待结果 ---
        queued_prompt = queue_comfyui_prompt(workflow)
        prompt_id = queued_prompt['prompt_id']
        
        # 使用WebSocket等待并获取输出
        outputs = get_comfyui_outputs(prompt_id)
        
        batch_size = parameters.get('batch_size', 1)
        toVideos = isVideo and batch_size > 1
        
        if ( toVideos ) :
            for i in range(1, batch_size):
                print(f"\n>>> 开始第 {i+1}/{batch_size} 批次生成")
                
                workflow[sampleradv_node_id]["inputs"]["noise_seed"] = random.randint(0, 999999999999999)
                
                # --- 【调用】当前批次的ComfyUI生成 ---
                queued_prompt = queue_comfyui_prompt(workflow)
                prompt_id = queued_prompt['prompt_id']
                batch_outputs = get_comfyui_outputs(prompt_id)  # 单批生成的结果
                
                # --- 【合并】当前批次的输出到总结果 ---
                outputs["images"].extend(batch_outputs.get("images", []))
        
       

    except (ValueError, FileNotFoundError, IOError) as e:
        print(f"处理节点创建请求时出错: {e}")
        return jsonify({"error": str(e)}), 400 # 返回 400 Bad Request 更合适
    except Exception as e:
        print(f"执行 ComfyUI 工作流或数据库操作时发生未知错误: {e}")
        return jsonify({"error": "执行工作流时发生内部错误。"}), 500

    node_data = database.get_node(node_id)
    if not node_data:
        print(f"节点 {node_id} 不存在于数据库中")
        return []

    # 1. 原样获取节点已有的 assets（包括 input 所有内容，不做任何修改）
    existing_assets = node_data.get('assets', {})

    # 2. 构建新的 assets：保留原有所有内容，仅新增/更新 output 字段
    assets_with_output = {
        **existing_assets,  # 解构原有 assets（原样保留 input 及其他所有字段）
        "output": outputs   # 新增/覆盖 output 字段（生成结果）
    }


    # --- 在数据库中记录新节点 ---
    database.update_node(
        node_id=node_id,
        payload={
                "title": node_title,
                "module_id": final_module_id,
                "assets": assets_with_output,
                "parameters": parameters,
                "status":'completed'
            }

    )


    # --- 返回更新后的树结构 ---
    updated_tree = database.get_tree_as_json(tree_id)
    return jsonify(updated_tree), 201


# --- 【核心修改】视频拼接 API 接口 (使用 moviepy) ---
@app.route('/api/stitch', methods=['POST'])
def stitch_videos():
    data = request.get_json()

    # --- 【调试】---
    print("\n" + "="*50)
    print("--- [Stitch Request] 后端已收到 ---")
    print(json.dumps(data, indent=2))
    print("="*50 + "\n")
    # --- 【调试】---

    clips_data = data.get('clips') # <-- 视频/图片轨
    audio_clips_data = data.get('audio_clips', []) # <-- 【新增】获取音轨

     # --- 【调试】---
    if not audio_clips_data:
        print("!!! [Stitch Request] 警告: 'audio_clips' 键为空或不存在。!!!")
    # --- 【调试】---

    if not clips_data or len(clips_data) < 1:
        return jsonify({"error": "需要至少一个视频/图片片段"}), 400

    moviepy_clips = []
    moviepy_audio_clips = [] # <-- 【新增】
    default_image_duration = 3
    target_fps = 16 

    final_video_clip = None # <-- 【新增】
    final_audio_clip = None # <-- 【新增】

    try:
        # --- 1. 处理视频/图片轨 (与旧逻辑基本相同) ---
        print("--- 正在处理视频轨 ---")
        for clip_info in clips_data:
            relative_path = clip_info.get('path')
            clip_type = clip_info.get('type') # 'image' 或 'video'

            if not relative_path or not clip_type:
                raise ValueError(f"视频轨片段信息不完整: {clip_info}")

            # (解析路径)
            parsed_url = urllib.parse.urlparse(relative_path)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            filename = query_params.get('filename', [None])[0]
            subfolder = query_params.get('subfolder', [''])[0]
            if not filename:
                raise ValueError(f"无法从视频轨路径解析文件名: {relative_path}")

            # (构建绝对路径)
            full_path = os.path.join(COMFYUI_OUTPUT_PATH, subfolder, filename)
            if not os.path.exists(full_path):
                full_path_alt = os.path.join(COMFYUI_OUTPUT_PATH, filename)
                if not os.path.exists(full_path_alt):
                   # (尝试 video 文件夹)
                   full_path_video = os.path.join(COMFYUI_OUTPUT_PATH, 'video', filename)
                   if not os.path.exists(full_path_video):
                       raise FileNotFoundError(f"视频/图片文件未找到: {filename}")
                   else:
                       full_path = full_path_video
                else:
                    full_path = full_path_alt

            # (创建 MoviePy Clip 对象 - 不变)
            if clip_type == 'video':
                print(f"加载视频: {full_path}")
                video_clip = VideoFileClip(full_path)
                # (裁剪逻辑... 不变)
                # --- (v90 修复) 确保 duration, startTime, endTime 存在 ---
                total_duration = video_clip.duration
                start_time = clip_info.get('startTime', 0)
                end_time = clip_info.get('endTime', total_duration)

                # (v90) 确保类型为 float 且不超出范围
                try:
                    final_start = float(start_time)
                    final_end = float(end_time)
                    if final_start < 0: final_start = 0
                    if final_end > total_duration: final_end = total_duration
                    if final_start >= final_end:
                        final_start = 0
                        final_end = total_duration
                except Exception as e:
                    print(f"    - 警告: 无法解析时间 {start_time}-{end_time}。使用完整剪辑。 {e}")
                    final_start = 0
                    final_end = total_duration

                print(f"    - 裁剪视频从 {final_start}s 到 {final_end}s")
                trimmed_clip = video_clip.subclipped(final_start, final_end)
                moviepy_clips.append(trimmed_clip)
            else: # 图片
                duration = clip_info.get('duration', default_image_duration)
                if duration is None or float(duration) <= 0:
                    duration = default_image_duration

                print(f"加载图片并创建为 {duration} 秒片段: {full_path}")
                image_clip = ImageClip(full_path)
                image_clip.duration = float(duration)
                image_clip.fps = target_fps
                moviepy_clips.append(image_clip)

        if not moviepy_clips:
             raise ValueError("未能成功加载任何视频/图片片段")

        print("使用 moviepy 拼接视频轨...")
        final_video_clip = concatenate_videoclips(moviepy_clips, method="compose")

        # --- 【关键修复】开始：在添加新音轨之前，先移除所有旧音轨 ---
        print("... 视频轨拼接完成。正在移除所有原始音轨...")
        final_video_clip.audio = None
        # --- 【关键修复】结束 ---

        # --- 【新增】开始：处理音轨 ---
        if audio_clips_data:
            print("--- 正在处理音轨 ---")
            for clip_info in audio_clips_data:
                relative_path = clip_info.get('path')
                if not relative_path:
                    raise ValueError(f"音轨片段信息不完整: {clip_info}")

                # (解析路径)
                parsed_url = urllib.parse.urlparse(relative_path)
                query_params = urllib.parse.parse_qs(parsed_url.query)
                filename = query_params.get('filename', [None])[0]
                subfolder = query_params.get('subfolder', [''])[0] # (应该是 'audio')
                if not filename:
                    raise ValueError(f"无法从音轨路径解析文件名: {relative_path}")

                # (构建绝对路径 - 优先检查 subfolder)
                full_path = os.path.join(COMFYUI_OUTPUT_PATH, subfolder, filename)
                if not os.path.exists(full_path):
                    # (备用：强制尝试 'audio' 文件夹)
                    full_path_audio = os.path.join(COMFYUI_OUTPUT_PATH, 'audio', filename)
                    if not os.path.exists(full_path_audio):
                        # (备用：尝试根目录)
                        full_path_alt = os.path.join(COMFYUI_OUTPUT_PATH, filename)
                        if not os.path.exists(full_path_alt):
                            raise FileNotFoundError(f"音频文件未找到: {filename} (尝试路径: {full_path}, {full_path_audio}, {full_path_alt})")
                        else:
                            full_path = full_path_alt
                    else:
                        full_path = full_path_audio

                print(f"加载音频: {full_path}")
                audio_clip = AudioFileClip(full_path)

                # (v90 修复) 检查并应用音频剪辑的 duration
                duration = clip_info.get('duration', audio_clip.duration)
                try:
                    final_duration = float(duration)
                    if final_duration > audio_clip.duration:
                        final_duration = audio_clip.duration
                except Exception:
                    final_duration = audio_clip.duration

                print(f"    - 裁剪音频为 {final_duration}s")
                moviepy_audio_clips.append(audio_clip.subclipped(0, final_duration))

            if moviepy_audio_clips:
                print("拼接音轨...")
                final_audio_clip = concatenate_audioclips(moviepy_audio_clips)

                # (关键) 将音频设置到视频上
                print("将音轨合成到视频轨...")
                # 确保音频不超过视频时长
                if final_audio_clip.duration > final_video_clip.duration:
                    print(f"    - 警告: 音轨 ( {final_audio_clip.duration}s ) 比视频轨 ( {final_video_clip.duration}s ) 长，将进行裁剪。")
                    final_audio_clip = final_audio_clip.subclipped(0, final_video_clip.duration)

                # 将视频的(已移除的)原声替换为我们的新音轨
                final_video_clip.audio = final_audio_clip

            else:
                print("音轨数据存在，但未能加载任何音频剪辑。视频将无声。")

        else:
            print("未提供音轨数据 (A1 为空)。视频将无声。")
        # --- 【新增】结束 ---

        # --- 3. 写入输出文件 (基本不变) ---
        output_filename = f"stitched_{uuid.uuid4()}.mp4"
        output_path_absolute = os.path.join(STITCHED_OUTPUT_FOLDER, output_filename)
        print(f"写入最终合成的视频到: {output_path_absolute}")

        final_video_clip.write_videofile(
            output_path_absolute,
            codec="libx264",
            audio_codec="aac",  # <-- 现在 audio_codec 非常重要
            fps=target_fps,
            threads=4,
            preset='medium'
        )

        # --- 4. 关闭所有打开的文件句柄 ---
        for clip in moviepy_clips:
            clip.close()
        if final_video_clip:
            final_video_clip.close()

        # 【新增】关闭音轨句柄
        for clip in moviepy_audio_clips:
            clip.close()
        if final_audio_clip:
            final_audio_clip.close()
        # 【新增】结束

        # --- 5. 返回结果 URL ---
        output_url = f"/stitched/{output_filename}"
        print(f"拼接完成，访问 URL: {output_url}")
        return jsonify({"output_url": output_url}), 200

    except FileNotFoundError as e:
        print(f"文件未找到错误: {e}")
        return jsonify({"error": str(e)}), 404
    except ValueError as e:
         print(f"值错误: {e}")
         return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"Moviepy 处理过程中发生错误: {type(e).__name__} - {e}")
        # 清理 clip 对象 (v90 修复缩进)
        for clip in moviepy_clips:
            try: clip.close()
            except: pass
        for clip in moviepy_audio_clips:
            try: clip.close()
            except: pass
        if final_video_clip:
            try: final_video_clip.close()
            except: pass
        if final_audio_clip:
            try: final_audio_clip.close()
            except: pass
        return jsonify({"error": f"视频拼接失败: {e}"}), 500

# --- 【不变】用于下载/访问拼接后视频的路由 ---
@app.route('/stitched/<filename>')
def download_stitched_video(filename):
    try:
        return send_from_directory(STITCHED_OUTPUT_FOLDER, filename, as_attachment=False)
    except FileNotFoundError:
        abort(404)

@app.route('/api/database/download', methods=['GET'])
def download_database():
    """提供SQLite数据库文件的下载"""
    try:
        backend_directory = os.path.dirname(os.path.abspath(__file__))
        return send_from_directory(
            directory=backend_directory,
            path='video_tree.db',
            as_attachment=True,
            download_name='video_tree_backup.db'
        )
    except FileNotFoundError:
        return jsonify({"error": "数据库文件未找到!"}), 404
 
# --- 4. 启动应用 ---

if __name__ == '__main__':
    # 在启动应用前，确保数据库和表已创建
    database.init_db()
    
    # 初始化时可以创建一个默认的树/项目
    if not database.get_tree_as_json(1):
        tree_id = database.create_tree("我的第一个项目")
        database.add_node(tree_id, None, "Init", {"description": "项目根节点"})
        print(f"已创建默认项目，ID为: {tree_id}")

    app.run(host='0.0.0.0', port=5005, debug=True)

