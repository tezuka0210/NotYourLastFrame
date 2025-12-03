import sqlite3
import json
import uuid
from datetime import datetime
from typing import Optional

# --- 配置 ---
# 数据库文件的名称，它将与 app.py 存储在同一个 backend/ 目录下
#DATABASE_FILE = 'video_tree_Camel_figurines.db'
DATABASE_FILE = 'video_tree.db'
# --- 核心函数 ---

def get_db_connection():
    """获取数据库连接，并设置返回结果为字典形式"""
    conn = sqlite3.connect(DATABASE_FILE)
    # 这行代码让查询结果可以通过列名访问，像字典一样，非常方便
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    """
    初始化数据库。如果数据库文件或表不存在，则创建它们。
    这个函数应该在 app.py 启动时被调用一次。
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # 创建 Trees 表，用于存储每一个项目（每一棵树）
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS Trees (
            tree_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        ''')

        # 创建 Nodes 表，用于存储树上的每一个节点
        # 删去 parent_id TEXT,
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS Nodes (
            node_id TEXT PRIMARY KEY,
            tree_id INTEGER NOT NULL,
            
            module_id TEXT NOT NULL,
            parameters TEXT,  -- 将作为JSON字符串存储
            title TEXT NOT NULL,
            assets TEXT,      -- 将作为JSON字符串存储
            media TEXT,       -- 将作为JSON字符串存储
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            FOREIGN KEY (tree_id) REFERENCES Trees (tree_id)
        );
        ''')
        # 3. 创建 'node_parents' 表 (存储父子关系，支持多父节点)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS node_parents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_node_id TEXT NOT NULL,
                parent_node_id TEXT NOT NULL,
                FOREIGN KEY (child_node_id) REFERENCES nodes (node_id) ON DELETE CASCADE,
                FOREIGN KEY (parent_node_id) REFERENCES nodes (node_id) ON DELETE CASCADE,
                UNIQUE(child_node_id, parent_node_id)
            )
        ''')         # 为外键添加索引以提高查询性能         
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_child_node ON node_parents (child_node_id)")         
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_parent_node ON node_parents (parent_node_id)")

        conn.commit()
        #conn.close()
        print("数据库已成功初始化。检查/创建了trees, nodes, nodes_parents 表")
    except sqlite3.Error as e:         
        print(f"数据库初始化失败: {e}")     
    finally:         
        conn.close()


def create_tree(name: str) -> int:
    """创建一个新的项目树，并返回其 tree_id"""     
    conn = get_db_connection()     
    cursor = conn.cursor()     
    try:         
        cursor.execute("INSERT INTO trees (name) VALUES (?)", (name,))         
        conn.commit()         
        print(f"创建新项目树: '{name}', ID: {cursor.lastrowid}")         
        return cursor.lastrowid     
    except sqlite3.Error as e:         
        print(f"创建项目树失败: {e}")         
        return -1 # 或者抛出异常
    finally:         
        conn.close()


def add_node(node_id: str,tree_id: int, parent_ids: list[str] | None, module_id: str, parameters: dict, title:str, assets: dict = None, status: str = 'completed') -> str | None:
    """
    向指定的树添加一个新节点。
    :param tree_id: 所属树的ID。
    :param parent_ids: 父节点的 node_id 列表 (可以为空或 None，表示根节点或无父节点)。
    :param module_id: 使用的模块标识符。
    :param parameters: 节点使用的参数 (字典)。
    :param assets: 节点生成的资源信息 (字典，包含 images/videos 列表)。
    :param status: 节点状态
    :param title: 节点标题
    :return: 新创建节点的 node_id，如果失败则返回 None。
    """
    #new_node_id = str(uuid.uuid4())
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        parameters_json = json.dumps(parameters) if parameters else None
        assets_json = json.dumps(assets) if assets else None
        created_at_dt = datetime.now()

        # 1. 插入节点基本信息到 'nodes' 表
        cursor.execute(
            """INSERT INTO nodes (node_id, tree_id, module_id, parameters, title, assets, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (node_id, tree_id, module_id, parameters_json, title, assets_json, status, created_at_dt)
        )

        # 2. 如果有父节点，插入关系到 'node_parents' 表
        if parent_ids:
            parent_data = [(node_id, parent_id) for parent_id in parent_ids if parent_id] # 确保 parent_id 有效
            if parent_data:
                cursor.executemany(
                    "INSERT INTO node_parents (child_node_id, parent_node_id) VALUES (?, ?)",
                    parent_data
                )

        conn.commit()
        print(f"    - 成功添加节点 {node_id} (父节点: {parent_ids}) 到数据库。")
        return node_id
    except sqlite3.Error as e:
        conn.rollback() # 出错时回滚
        print(f"添加节点失败: {e}")
        return None
    finally:
        conn.close()

def get_node(node_id: str) -> dict | None:
    """根据 node_id 获取单个节点的详细信息"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT node_id, tree_id, module_id, parameters, title, assets, status, created_at FROM nodes WHERE node_id = ?", (node_id,))
        node_row = cursor.fetchone()

        if node_row:
            node_dict = dict(node_row)
            try:
                node_dict['parameters'] = json.loads(node_dict['parameters']) if node_dict['parameters'] else {}
            except json.JSONDecodeError:
                print(f"警告：解析节点 {node_id} 的 parameters JSON 失败。")
                node_dict['parameters'] = {} # 返回空字典

            try:
                node_dict['assets'] = json.loads(node_dict['assets']) if node_dict['assets'] else {}
            except json.JSONDecodeError:
                print(f"警告：解析节点 {node_id} 的 assets JSON 失败。")
                node_dict['assets'] = {} # 返回空字典
            
             # 查询并添加父节点ID列表 (可选，如果前端需要完整信息)
            cursor.execute("SELECT parent_node_id FROM node_parents WHERE child_node_id = ?", (node_id,))
            parents = cursor.fetchall()
            node_dict['parent_ids'] = [p['parent_node_id'] for p in parents]

            return node_dict
        else:
            return None
    except sqlite3.Error as e:
        print(f"获取节点 {node_id} 失败: {e}")
        return None
    finally:
        conn.close()

def get_tree_as_json(tree_id: int) -> dict | None:
    """
    获取指定树的所有节点信息，并构造成前端需要的 JSON 格式。
    为了兼容 D3 的 stratify，此函数会为每个节点查找父节点，
    并只返回第一个找到的父节点作为 'parent_id'。
    注意：这只是为了可视化，数据库中存储了完整的父子关系。
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # 检查树是否存在
        cursor.execute("SELECT name FROM trees WHERE tree_id = ?", (tree_id,))
        tree_info = cursor.fetchone()
        if not tree_info:
            print(f"未找到 tree_id={tree_id} 的项目树。")
            return None # 或者可以返回一个空结构

        # 获取该树的所有节点
        cursor.execute("""
            SELECT node_id, module_id, parameters, title, assets, status, created_at
            FROM nodes
            WHERE tree_id = ?
            ORDER BY created_at ASC
        """, (tree_id,))
        nodes_raw = cursor.fetchall()

        nodes_for_frontend = []
        for node_row in nodes_raw:
            node_dict = dict(node_row)
            try:
                node_dict['parameters'] = json.loads(node_dict['parameters']) if node_dict['parameters'] else {}
            except json.JSONDecodeError:
                print(f"警告：解析节点 {node_dict['node_id']} 的 parameters JSON 失败。")
                node_dict['parameters'] = {}

            try:
                node_dict['assets'] = json.loads(node_dict['assets']) if node_dict['assets'] else {}
            except json.JSONDecodeError:
                print(f"警告：解析节点 {node_dict['node_id']} 的 assets JSON 失败。")
                node_dict['assets'] = {}
            
            # 查询该节点的父节点
            cursor.execute("SELECT parent_node_id FROM node_parents WHERE child_node_id = ?", (node_dict['node_id'],))
            parents = cursor.fetchall()
            
            # 2. (关键) 将所有父节点 ID 收集到一个列表中
            parent_ids_list = [p['parent_node_id'] for p in parents] #
            # 3. (关键) 如果列表为空，则为 None；否则使用完整列表
            if parent_ids_list:
                node_dict['parent_id'] = parent_ids_list
            else:
                node_dict['parent_id'] = None # 根节点
            # (旧的 v72 错误代码 已被替换)
            nodes_for_frontend.append(node_dict)

        return {
            "tree_id": tree_id,
            "name": tree_info['name'],
            "nodes": nodes_for_frontend
        }
    except sqlite3.Error as e:
        print(f"获取树 {tree_id} 失败: {e}")
        return None
    finally:
        conn.close()

def update_node(node_id: str, payload: dict):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # 提取需要更新的字段
        module_id = payload.get('module_id')
        title = payload.get('title')  # 独立提取title，不依赖module_id
        parameters_json = json.dumps(payload.get('parameters', {}))
        assets_json = json.dumps(payload.get('assets', {}))
        status = payload.get('status')
        
        # 基础更新字段：parameters和assets是必传的，始终更新
        update_fields = ["parameters = ?", "assets = ?"]
        update_values = [parameters_json, assets_json]
        
        # 如果有module_id，加入更新字段
        if module_id is not None:
            update_fields.append("module_id = ?")
            update_values.append(module_id)
        
        # 如果有title，加入更新字段（独立判断，与module_id无关）
        if title is not None:
            update_fields.append("title = ?")
            update_values.append(title)
        if status is not None:
            update_fields.append("status = ?")
            update_values.append(status)
        # 拼接SQL语句
        sql = f"UPDATE nodes SET {', '.join(update_fields)} WHERE node_id = ?"
        update_values.append(node_id)  # 最后添加WHERE条件的node_id
        
        # 执行更新
        cursor.execute(sql, tuple(update_values))
        conn.commit()
        print(f"节点 {node_id} 已成功更新。")
    except sqlite3.Error as e:
        conn.rollback()
        print(f"更新节点 {node_id} 失败: {e}")
    finally:
        conn.close()


def find_global_context(start_node_id):
    """
    从当前节点开始，沿着父节点链一直向上找，
    直到找到包含 'global_context' 字段的节点。
    """
    current_id = start_node_id

    while current_id:
        # 1. 获取当前节点信息
        node = get_node(current_id) # 假设你有这个函数
        if not node:
            break

        # 2. 检查是否有全局意图
        params = node.get('parameters', {})
        if params and 'global_context' in params:
            return params['global_context']

        # 3. 如果是 ROOT 或 Init 节点还找不到，就返回空
        if node.get('module_id') == 'Init':
            return None

        # 4. 继续向上找父节点
        # (注意：如果有多父节点，通常取第一个主父节点)
        parent_ids = node.get('parent_ids')
        if not parent_ids:
            break
        current_id = parent_ids[0] # 继续回溯

    return None # 这一枝上没找到



def delete_node_and_descendants(node_id: str):
    """递归删除指定节点及其所有后代节点"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 使用一个集合来跟踪已访问/待删除的节点，避免无限循环（虽然 DAG 不应有循环）
    nodes_to_delete = {node_id}
    queue = [node_id]

    # 1. 广度优先搜索 (BFS) 找到所有后代节点
    visited = {node_id} # 用于BFS
    while queue:
        current_node_id = queue.pop(0)
        # 查找当前节点的所有直接子节点
        cursor.execute("SELECT child_node_id FROM node_parents WHERE parent_node_id = ?", (current_node_id,))
        children = cursor.fetchall()
        for child_row in children:
            child_id = child_row['child_node_id']
            if child_id not in visited:
                nodes_to_delete.add(child_id)
                queue.append(child_id)
                visited.add(child_id) # 标记已访问

    # 2. 执行删除
    try:
        if nodes_to_delete:
            # 构建 (?, ?, ...) 占位符字符串
            placeholders = ', '.join('?' * len(nodes_to_delete))
            
            # 删除 'nodes' 表中的所有目标节点
            # 'ON DELETE CASCADE' 会自动处理 'node_parents' 表中的相关记录
            cursor.execute(f"DELETE FROM nodes WHERE node_id IN ({placeholders})", list(nodes_to_delete))
            
            conn.commit()
            print(f"成功删除节点 {node_id} 及其 {len(nodes_to_delete)-1} 个后代节点。")
        else:
             print(f"节点 {node_id} 不存在或没有后代可删除。")

    except sqlite3.Error as e:
        conn.rollback()
        print(f"删除节点 {node_id} 及其后代失败: {e}")
    finally:
        conn.close()


# --- (可选) 用于测试的 main 函数 ---
if __name__ == '__main__':
    print("正在初始化数据库...")
    init_db()

    # 简单测试
    print("\n简单测试:")
    tree_id = create_tree("测试项目")
    if tree_id > 0:
        root_node_id = add_node(tree_id, None, "Init", {"desc": "根"}, {"images": ["/view?filename=root.png"]})
        if root_node_id:
            child1_id = add_node(tree_id, [root_node_id], "ImageGen", {"prompt": "猫"}, {"images": ["/view?filename=cat.png"]})
            child2_id = add_node(tree_id, [root_node_id], "VideoGen", {"prompt": "狗"}, {"videos": ["/view?filename=dog.mp4"]})
            
            if child1_id and child2_id:
               grandchild_id = add_node(tree_id, [child1_id, child2_id], "Merge", {"mode": "overlay"}, {"images": ["/view?filename=merged.png"]})
               print("\n添加节点结构完成。")

            print("\n获取树结构:")
            tree_json = get_tree_as_json(tree_id)
            if tree_json:
                print(json.dumps(tree_json, indent=2, ensure_ascii=False))

            # print("\n测试删除 child1 及其后代:")
            # if child1_id:
            #     delete_node_and_descendants(child1_id)
            #     print("\n删除后树结构:")
            #     tree_json_after_delete = get_tree_as_json(tree_id)
            #     if tree_json_after_delete:
            #         print(json.dumps(tree_json_after_delete, indent=2, ensure_ascii=False))

    print("\n测试完成。")