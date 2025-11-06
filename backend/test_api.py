import requests
import json
import os
import uuid
import time
from PIL import Image # 用于创建测试图片
import urllib.request
import random
# --- 配置 ---
BASE_URL = "http://223.193.6.178:5005" # !!! 修改为您的 Flask 服务器地址 !!!
TEST_TREE_ID = 1
TEST_IMAGE_FILENAME = "cat.jfif"
TEST_MASK_FILENAME = "test_mask.png"

# --- 辅助函数 ---
def print_response(response):
    """打印 HTTP 响应的简要信息"""
    print(f"Status Code: {response.status_code}")
    try:
        print("Response JSON:")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    except json.JSONDecodeError:
        print("Response Text:")
        print(response.text)
    print("-" * 30)

def create_dummy_image(filename, size=(100, 50), color="blue"):
    """创建一个简单的测试图片文件"""
    try:
        if not os.path.exists(filename):
            img = Image.new('RGB', size, color=color)
            img.save(filename)
            print(f"创建测试图片: {filename}")
    except Exception as e:
        print(f"警告：创建测试图片 {filename} 失败: {e}")
        print("请确保手动放置一个同名图片文件在此脚本旁边。")

# --- 测试用例 ---

def test_get_tree():
    print(f"--- 测试: GET /api/trees/{TEST_TREE_ID} ---")
    try:
        response = requests.get(f"{BASE_URL}/api/trees/{TEST_TREE_ID}")
        print_response(response)
        assert response.status_code == 200
        data = response.json()
        assert "nodes" in data
        return data # 返回树数据供后续测试使用
    except Exception as e:
        print(f"测试失败: {e}")
        return None

def test_upload_and_create_node(filename, parent_id=None):
    """测试上传文件，并验证后端创建了 'Upload' 节点"""
    print(f"--- 测试: POST /api/assets/upload (上传 {filename} 并创建节点) ---")
    create_dummy_image(filename)
    if not os.path.exists(filename):
        print(f"测试跳过：缺少测试文件 {filename}")
        return None, None # 返回 NodeID 和 Filename 都为 None

    # 构建带查询参数的 URL
    api_url = f"{BASE_URL}/api/assets/upload?tree_id={TEST_TREE_ID}"
    if parent_id:
        api_url += f"&parent_id={parent_id}"
        print(f"  (将作为节点 {parent_id[:8]} 的子节点上传)")
    else:
        print("  (将作为新的根节点上传，或成为 Init 的子节点)")

    try:
        with open(filename, 'rb') as f:
            files = {'file': (filename, f)}
            response = requests.post(api_url, files=files) # 发送到修改后的上传接口
        print_response(response)
        assert response.status_code == 201 # 期望创建成功
        data = response.json()
        assert "nodes" in data

        # 在返回的树中查找新创建的 Upload 节点
        # 假设它是最后一个被添加的，并且 module_id 是 "Upload"
        new_upload_node = None
        if data["nodes"]:
             potential_nodes = [n for n in data["nodes"] if n.get("module_id") == "Upload"]
             if potential_nodes:
                  # 按创建时间排序找最新的
                  new_upload_node = max(potential_nodes, key=lambda n: n.get("created_at", ""))

        assert new_upload_node is not None, "响应中未找到新创建的 'Upload' 节点"
        
        # 从 assets 中提取保存的文件名 (可能带有 UUID 前缀)
        saved_filename = None
        if new_upload_node.get('assets', {}).get('images'):
            asset_url = new_upload_node['assets']['images'][0]
            parsed_url = urllib.parse.urlparse(asset_url)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            saved_filename = query_params.get('filename', [None])[0]

        assert saved_filename is not None, "'Upload' 节点的 assets 中未找到文件名"

        print(f"  成功创建 Upload 节点，ID: {new_upload_node['node_id']}, 文件名: {saved_filename}")
        return new_upload_node['node_id'], saved_filename # 返回 NodeID 和 后端保存的文件名

    except Exception as e:
        print(f"测试失败: {e}")
        return None, None

def test_create_root_node():
    """验证数据库中是否存在 module_id='Init' 的根节点"""     
    print(f"--- 测试: 验证 Init 根节点存在 ---")     
    if not tree_data or not tree_data.get("nodes"):         
        print("  测试失败：未能获取到有效的树数据。")         
        return None # 返回 None 表示未找到      
        
    nodes = tree_data["nodes"]     
    init_root = next((n for n in nodes if n.get("parent_id") is None and n.get("module_id") == "Init"), None)      
    if init_root:         
        print(f"  验证成功：找到 Init 根节点，ID: {init_root['node_id']}")         
        return init_root['node_id'] # 返回 Init 根节点的 ID
    else:         
        print(f"  验证失败：未能在节点列表中找到 parent_id=None 且 module_id='Init' 的节点。")         
        # 查找是否存在其他根节点         any_root = next((n for n in nodes if n.get("parent_id") is None), None)         
        if any_root:              
            print(f"  警告：找到了一个根节点 (ID: {any_root['node_id']}, Module: {any_root.get('module_id')})，但它不是 'Init' 类型。")         
            return None

# 【核心重构】测试创建第一个内容节点 (现在必须有父节点)
def test_create_first_content_node(parent_id, is_image_based=True):
    """测试创建第一个实际内容节点（必须有父节点提供输入或作为起点）"""
    print(f"--- 测试: POST /api/nodes (创建第一个内容节点，父节点: {parent_id[:8]}) ---")
    if not parent_id:
        print("测试跳过：此测试现在需要一个有效的父节点ID")
        return None

    module_id = "ImageGenerateImage_Basic" if is_image_based else "TextGenerateImage"
    prompt = f"Insert the exact cat from the input image — same fur color, markings, size, and proportions — into a bright, modern living room: mid-afternoon natural light spills through sheer white curtains onto a low linen-upholstered sofa and light-walnut coffee table; the cat is caught mid-leap, front paws stretched toward a dangling feather toy suspended from a floor-to-ceiling cat tree in the left foreground; soft cream carpet shows subtle paw indentations, while background shelves and wall art fall into gentle bokeh; keep original lighting direction and temperature, 35 mm lens, f/2.8, 1/1000 s freeze motion, 8 K clarity, lively yet cozy indoor atmosphere."

    payload = {
        "tree_id": TEST_TREE_ID,
        "parent_ids": [parent_id], # 父节点ID
        "module_id": module_id,
        "parameters": {
            "positive_prompt": prompt,
            "steps": 15,
            "seed": random.randint(0,999999999999)
        }
    }
    # 注意：不再需要 image_input 参数了！后端会从 parent_id 获取

    try:
        print(f"  正在提交生成请求 (模块: {module_id})...")
        response = requests.post(f"{BASE_URL}/api/nodes", json=payload)
        print_response(response)
        assert response.status_code == 201
        data = response.json()
        assert "nodes" in data

        # 查找新节点
        new_node = None
        if data["nodes"]:
             potential_nodes = [n for n in data["nodes"] if n.get("parameters", {}).get("positive_prompt") == prompt]
             if potential_nodes: new_node = max(potential_nodes, key=lambda n: n.get("created_at", ""))
             else: new_node = data["nodes"][-1] # 备选

        assert new_node is not None, "响应中未找到符合条件的新节点"
        print(f"  成功创建第一个内容节点，ID: {new_node['node_id']}")
        return new_node['node_id']
    except Exception as e:
        print(f"测试失败: {e}")
        return None


def test_create_single_parent_node1(parent_id):
    print(f"--- 测试: POST /api/nodes (单父节点: {parent_id}) ---")
    if not parent_id:
        print("测试跳过：缺少有效的父节点ID")
        return None
        
    payload = {
        "tree_id": TEST_TREE_ID,
        "parent_ids": [parent_id], # 包含一个父节点ID
        "module_id": "TextGenerateImage", # 假设使用图生图
        "parameters": {
            "positive_prompt": f"Generate a pure-white short-haired cat in mid-play on a sun-lit oak floor: alabaster fur with subtle silver shadows, pink nose and paw pads, golden-amber eyes wide with curiosity; captured mid-pounce, tail curved, front paws extended toward a small rolling jingle bell; soft morning side-light from a nearby window creates gentle rim highlights on whiskers and individual fur strands; background shows a softly blurred cream-colored sofa and green indoor plant to establish indoor scale; 50 mm lens, f/2.8, 1/1000 s freeze motion, 8 K clarity, clean and lively atmosphere.",
            "steps": 15,
            "seed": random.randint(0,999999999999)
        }
    }
    try:
        print("  正在提交生成请求...")
        response = requests.post(f"{BASE_URL}/api/nodes", json=payload)
        print_response(response)
        assert response.status_code == 201
        data = response.json()
        new_node = data["nodes"][-1] if data["nodes"] else None
        if new_node:
            print(f"  成功创建单父节点，ID: {new_node['node_id']}")
            # 可以在这里加更严格的检查，比如 new_node['parent_id'] == parent_id (如果后端get_tree返回了这个简化字段)
            return new_node['node_id']
        else:
             print("  错误：响应中未找到新节点")
             return None
    except Exception as e:
        print(f"测试失败: {e}")
        return None


def test_create_single_parent_node2(parent_id):
    print(f"--- 测试: POST /api/nodes (单父节点: {parent_id}) ---")
    if not parent_id:
        print("测试跳过：缺少有效的父节点ID")
        return None
        
    payload = {
        "tree_id": TEST_TREE_ID,
        "parent_ids": [parent_id], # 包含一个父节点ID
        "module_id": "TextGenerateImage", # 假设使用图生图
        "parameters": {
            "positive_prompt": f"Generate a bright golden-yellow short-haired dog in a lively outdoor park setting: warm mid-morning sunlight catches the dog mid-bound, all four paws off the ground, ears flying, tail a happy blur; coat a rich, even honey-gold with subtle cream highlights along the chest and tail tip, dark amber eyes focused forward; background shows soft green grass and distant leafy trees in gentle bokeh; 50 mm lens, f/2.8, 1/1600 s freeze motion, 8 K clarity, joyful and energetic atmosphere.",
            "steps": 15,
            "seed": random.randint(0,999999999999)
        }
    }
    try:
        print("  正在提交生成请求...")
        response = requests.post(f"{BASE_URL}/api/nodes", json=payload)
        print_response(response)
        assert response.status_code == 201
        data = response.json()
        new_node = data["nodes"][-1] if data["nodes"] else None
        if new_node:
            print(f"  成功创建单父节点，ID: {new_node['node_id']}")
            # 可以在这里加更严格的检查，比如 new_node['parent_id'] == parent_id (如果后端get_tree返回了这个简化字段)
            return new_node['node_id']
        else:
             print("  错误：响应中未找到新节点")
             return None
    except Exception as e:
        print(f"测试失败: {e}")
        return None


def test_create_merge_node(parent1_id, parent2_id):
    print(f"--- 测试: POST /api/nodes (双父节点合并: {parent1_id[:8]} + {parent2_id[:8]}) ---")
    if not parent1_id or not parent2_id:
        print("测试跳过：需要两个有效的父节点ID")
        return None
        
    payload = {
        "tree_id": TEST_TREE_ID,
        "parent_ids": [parent1_id, parent2_id], # 包含两个父节点ID
        "module_id": "ImageMerging", # 前端可能会传这个，但后端会强制使用
        "parameters": {}
    }
    try:
        print("  正在提交生成请求...")
        response = requests.post(f"{BASE_URL}/api/nodes", json=payload)
        print_response(response)
        assert response.status_code == 201
        data = response.json()
        new_node = data["nodes"][-1] if data["nodes"] else None
        if new_node:
             print(f"  成功创建合并节点，ID: {new_node['node_id']}")
             # 验证多父关系需要查询数据库或修改API以返回parent_ids列表
             return new_node['node_id']
        else:
             print("  错误：响应中未找到新节点")
             return None
    except Exception as e:
        print(f"测试失败: {e}")
        return None

def test_create_mask_node(parent_id, mask_filename):
    print(f"--- 测试: POST /api/nodes (Mask 输入: 父={parent_id[:8]}, Mask={mask_filename}) ---")
    if not parent_id or not mask_filename:
        print("测试跳过：需要父节点ID和Mask文件名")
        return None

    payload = {
        "tree_id": TEST_TREE_ID,
        "parent_ids": [parent_id], # Mask模式只需要一个父节点
        "module_id": "PartialRepainting", # 前端指定或后端强制
        "parameters": {
            "positive_prompt": f"Inpainting on {parent_id[:8]}",
            "mask_filename": mask_filename, # 关键参数
            "steps": 5
            # Inpainting 工作流可能需要的其他参数...
        }
    }
    try:
        print("  正在提交生成请求...")
        response = requests.post(f"{BASE_URL}/api/nodes", json=payload)
        print_response(response)
        assert response.status_code == 201
        data = response.json()
        new_node = data["nodes"][-1] if data["nodes"] else None
        if new_node:
             print(f"  成功创建 Mask 节点，ID: {new_node['node_id']}")
             return new_node['node_id']
        else:
             print("  错误：响应中未找到新节点")
             return None
    except Exception as e:
        print(f"测试失败: {e}")
        return None

def test_delete_node(node_id):
    print(f"--- 测试: DELETE /api/nodes/{node_id} ---")
    if not node_id:
        print("测试跳过：需要有效的节点ID")
        return False
    try:
        response = requests.delete(f"{BASE_URL}/api/nodes/{node_id}")
        print_response(response)
        assert response.status_code == 200
        print(f"  节点 {node_id} 删除成功 (理论上)")
        return True
    except Exception as e:
        print(f"测试失败: {e}")
        return False

def test_stitch_videos(clips_data):
     print(f"--- 测试: POST /api/stitch ---")
     if not clips_data or len(clips_data) < 1:
         print("测试跳过：需要至少一个片段数据")
         return None
     
     payload = {"clips": clips_data}
     try:
         print(f"  正在提交拼接请求: {clips_data}")
         response = requests.post(f"{BASE_URL}/api/stitch", json=payload)
         print_response(response)
         assert response.status_code == 200
         data = response.json()
         assert "output_url" in data
         print(f"  拼接成功，输出URL: {data['output_url']}")
         # 可以尝试访问这个URL
         output_url = BASE_URL + data['output_url']
         print(f"  尝试访问: {output_url}")
         get_response = requests.get(output_url, stream=True) # stream=True 用于视频
         print(f"  访问状态码: {get_response.status_code}")
         assert get_response.status_code == 200 or get_response.status_code == 206 # 200或206都可能
         get_response.close() # 关闭连接
         return data['output_url']
     except Exception as e:
        print(f"测试失败: {e}")
        return None

# --- 主执行流程 ---
if __name__ == "__main__":
    print(f"开始测试 Flask API: {BASE_URL}")

    # 1. 获取初始树状态
    initial_tree = test_get_tree()
    initial_node_count = len(initial_tree["nodes"]) if initial_tree and initial_tree.get("nodes") else 0
    root_node_id = None
    if initial_node_count > 0:
        root_node = next((n for n in initial_tree["nodes"] if n.get("parent_id") is None), None)
        if root_node:
            root_node_id = root_node["node_id"]
            print(f"  发现根节点: {root_node_id}")

    # 3. 如果没有根节点，创建一个 (可以选择使用上传的图片)
    if not root_node_id:
        print("\n=== 没有根节点，尝试创建 ===")
        # 可以选择是否在这里使用 uploaded_image_name
        root_node_id = test_create_root_node(initial_tree) 
        # 创建根节点后，可能需要再次获取树来确认
        if root_node_id:
             current_tree = test_get_tree()
             current_node_count = len(current_tree["nodes"]) if current_tree else initial_node_count
             print(f"  当前节点数: {current_node_count}")
        else:
             print("!!! 根节点创建失败，后续测试可能受影响 !!!")
             # exit() # 可以选择在这里退出

    # 2. 上传测试图片
    image_upload_node_id, saved_image_filename = test_upload_and_create_node(TEST_IMAGE_FILENAME, parent_id=root_node_id)

    # 4. 创建单父节点
    print("\n=== 测试单父节点创建 ===")
    child1_id = test_create_single_parent_node1(root_node_id)

    # 5. 创建另一个单父节点 (用于合并测试)
    print("\n=== 测试另一个单父节点创建 ===")
    child2_id = test_create_single_parent_node2(root_node_id) # 假设也以root为父

    # 6. 创建双父节点 (合并)
    print("\n=== 测试双父节点（合并）创建 ===")
    merge_node_id = test_create_merge_node(child1_id, child2_id)

    # 7. 创建 Mask 节点
    # print("\n=== 测试 Mask 节点创建 ===")
    # mask_node_id = test_create_mask_node(child1_id, uploaded_mask_name) # 假设基于 child1

    # 8. 测试新图片上传作为输入的节点创建 (创建为根节点的子节点)
    print("\n=== 测试创建第一个内容节点 (基于上传图片) ===")
    first_content_node_id = test_create_first_content_node(
        parent_id=image_upload_node_id, # 使用 Upload 节点作为父节点
        is_image_based=True
    )
    if not first_content_node_id: print("!!! 第一个内容节点创建失败，后续测试可能受影响 !!!")


    # 10. 测试删除节点
    # print("\n=== 测试节点删除 ===")
    # node_to_delete = mask_node_id # 选择一个叶子节点删除，避免影响过多结构
    # if node_to_delete:
    #     deleted = test_delete_node(node_to_delete)
    #     if deleted:
    #         # 验证删除
    #         print("  验证删除后树的状态...")
    #         final_tree_after_delete = test_get_tree()
    #         if final_tree_after_delete:
    #             node_exists = any(n['node_id'] == node_to_delete for n in final_tree_after_delete.get("nodes", []))
    #             if not node_exists:
    #                 print(f"  验证成功：节点 {node_to_delete} 已不在树中。")
    #             else:
    #                 print(f"  !!! 验证失败：节点 {node_to_delete} 仍然存在。")

    print("\n--- 测试完成 ---")