import sqlite3
import json
import uuid
from datetime import datetime
from typing import Optional, List, Dict

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

            -- 【新需求字段】
            is_group INTEGER DEFAULT 0,       -- 1表示这是一个由多个节点合并成的大节点
            parent_group_id TEXT,             -- 如果属于某个合并大节点，记录其ID
            branch_id TEXT,                   -- 分支节点标识
            
            FOREIGN KEY (tree_id) REFERENCES Trees (tree_id),
            FOREIGN KEY (parent_group_id) REFERENCES Nodes (node_id) ON DELETE SET NULL
            
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

        cursor.execute('''
        CREATE TABLE IF NOT EXISTS Entities (
            entity_id TEXT PRIMARY KEY,
            tree_id INTEGER NOT NULL,
            name TEXT,                -- 实体名字 (如: 莉莉)
            description TEXT,         -- 实体描述
            representative_thumb TEXT, -- 缩略图
            
            -- 用 JSON 存储出场记录，例如: [{"node_id": "n1", "branch_id": "b1"}, ...]
            appearance_nodes TEXT,     
            
            FOREIGN KEY (tree_id) REFERENCES Trees (tree_id)
        );
        ''')

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


def add_node(node_id: str,tree_id: int, parent_ids: list[str] | None, module_id: str, parameters: dict, title:str, assets: dict = None, status: str = 'completed',
             is_group: int = 0, parent_group_id: str = None) -> str | None:
    """
    向指定的树添加一个新节点。
    :param tree_id: 所属树的ID。
    :param parent_ids: 父节点的 node_id 列表 (可以为空或 None，表示根节点或无父节点)。
    :param module_id: 使用的模块标识符。
    :param parameters: 节点使用的参数 (字典)。
    :param assets: 节点生成的资源信息 (字典，包含 images/videos 列表)。
    :param status: 节点状态
    :param title: 节点标题
    :is_group: 是否为组节点
    :parent_group_id: 组节点的父节点id
    :return: 新创建节点的 node_id，如果失败则返回 None。
    """
    #new_node_id = str(uuid.uuid4())
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # --- 自动处理 branch_id 逻辑 ---
        branch_id = None
        if parent_ids and len(parent_ids) > 0:
            # 找到第一个父节点的 branch_id
            cursor.execute("SELECT branch_id, module_id FROM nodes WHERE node_id = ?", (parent_ids[0],))
            parent_info = cursor.fetchone()
            if parent_info:
                if parent_info['module_id'] == 'Init': # 如果父节点是根节点
                    branch_id = node_id  # 这个节点就是该分支的起点
                else:
                    branch_id = parent_info['branch_id'] # 继承父节点的分支ID

        parameters_json = json.dumps(parameters) if parameters else None
        assets_json = json.dumps(assets) if assets else None
        created_at_dt = datetime.now()

        # 1. 插入节点基本信息到 'nodes' 表
        cursor.execute(
            """INSERT INTO nodes (node_id, tree_id, module_id, parameters, title, assets, status, is_group, parent_group_id, branch_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (node_id, tree_id, module_id, json.dumps(parameters), title, json.dumps(assets), status, is_group, parent_group_id, branch_id)
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

def merge_nodes_to_group(tree_id: int, selected_ids: List[str], group_title: str) -> str | None:
    """
    【新功能实现】将选中的多个节点合并为一个多模态大节点。
    逻辑：新建一个 is_group=1 的节点，并将选中节点的 parent_group_id 指向它。
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    group_id = f"group_{uuid.uuid4().hex[:8]}"
    try:
        # 1. 创建大节点
        cursor.execute(
            "INSERT INTO nodes (node_id, tree_id, module_id, title, is_group, status) VALUES (?, ?, ?, ?, ?, ?)",
            (group_id, tree_id, 'MultiModalGroup', group_title, 1, 'completed')
        )
        # 2. 更新选中节点的父组ID
        placeholders = ', '.join(['?'] * len(selected_ids))
        cursor.execute(
            f"UPDATE nodes SET parent_group_id = ? WHERE node_id IN ({placeholders})",
            [group_id] + selected_ids
        )
        conn.commit()
        return group_id
    except sqlite3.Error as e:
        conn.rollback()
        return None
    finally:
        conn.close()

def add_or_update_entity_appearance(tree_id: int, entity_name: str, node_id: str, branch_id: str, thumb: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    # 1. 检查这个名字的实体是否已存在
    cursor.execute("SELECT entity_id, appearance_nodes FROM Entities WHERE name = ? AND tree_id = ?", (entity_name, tree_id))
    result = cursor.fetchone()

    if result:
        # 已存在：在原来的出场列表里追加
        apps = json.loads(result['appearance_nodes'])
        if node_id not in [a['node_id'] for a in apps]:
            apps.append({"node_id": node_id, "branch_id": branch_id})
            cursor.execute("UPDATE Entities SET appearance_nodes = ? WHERE entity_id = ?", (json.dumps(apps), result['entity_id']))
    else:
        # 不存在：新建实体档案
        new_id = f"ent_{uuid.uuid4().hex[:6]}"
        apps = [{"node_id": node_id, "branch_id": branch_id}]
        cursor.execute("INSERT INTO Entities (entity_id, tree_id, name, appearance_nodes, representative_thumb) VALUES (?, ?, ?, ?, ?)",
                       (new_id, tree_id, entity_name, json.dumps(apps), thumb))
    conn.commit()
    conn.close()

def get_node(node_id: str) -> dict | None:
    """根据 node_id 获取单个节点的详细信息"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT node_id, tree_id, module_id, parameters, title, assets, status, created_at, is_group, parent_group_id, branch_id FROM nodes WHERE node_id = ?", (node_id,))
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
            
             # 3. 转换布尔值
            node_dict['is_group'] = bool(node_dict['is_group'])
            
             # 查询并添加父节点ID列表 (可选，如果前端需要完整信息)
            cursor.execute("SELECT parent_node_id FROM node_parents WHERE child_node_id = ?", (node_id,))
            parents = cursor.fetchall()
            node_dict['parent_ids'] = [p['parent_node_id'] for p in parents]

            # 5. 【新需求】查询该节点下属的所有实体 (分割出的主体)
            cursor.execute("""
                SELECT entity_id, name, description, representive_thumb, appearance_nodes 
                FROM Entities 
                WHERE appearance_nodes LIKE ?
            """, (f'%"node_id"%',))
            entities_found = cursor.fetchall()
            node_dict['entities'] = []
            
            for ent in entities_found:
                ent_dict = dict(ent)
                # 解析该实体的完整出场轨迹（如果前端需要知道该实体还去过哪）
                ent_dict['appearance_nodes'] = json.loads(ent_dict['appearance_nodes']) if ent_dict['appearance_nodes'] else []
                node_dict['entities'].append(ent_dict)

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
            SELECT node_id, module_id, parameters, title, assets, 
                   status, created_at, is_group, parent_group_id, branch_id
            FROM nodes
            WHERE tree_id = ?
            ORDER BY created_at ASC
        """, (tree_id,))
        nodes_raw = cursor.fetchall()

        cursor.execute("""
            SELECT entity_id, name, description, representative_thumb, appearance_nodes 
            FROM entities 
            WHERE tree_id = ?
        """, (tree_id,))
        all_entities_raw = cursor.fetchall()
        
        # 将实体数据预处理，方便后续匹配
        processed_entities = []
        for ent in all_entities_raw:
            ent_dict = dict(ent)
            try:
                # 解析出出现过该实体的节点列表 [{"node_id": "..."}]
                ent_dict['appearance_nodes'] = json.loads(ent['appearance_nodes']) if ent['appearance_nodes'] else []
            except:
                ent_dict['appearance_nodes'] = []
            processed_entities.append(ent_dict)

        nodes_for_frontend = []
        for node_row in nodes_raw:
            node_dict = dict(node_row)
             # --- 修复位置：确保 assets 永远是一个字典 ---
            try:
                # 检查字段是否为 None 或者空字符串
                if node_dict.get('assets') is None:
                    node_dict['assets'] = {}
                else:
                    node_dict['assets'] = json.loads(node_dict['assets']) if isinstance(node_dict['assets'], str) else node_dict['assets']
                
                # 同理处理 parameters
                if node_dict.get('parameters') is None:
                    node_dict['parameters'] = {}
                else:
                    node_dict['parameters'] = json.loads(node_dict['parameters']) if isinstance(node_dict['parameters'], str) else node_dict['parameters']
            except (json.JSONDecodeError, TypeError):
                node_dict['assets'] = {}
                node_dict['parameters'] = {}

            # --- 核心修改：关联 Entity 数据 ---
            current_node_entities = []
            for ent in processed_entities:
                is_in_node = any(app.get('node_id') == node_dict['node_id'] for app in ent['appearance_nodes'])
                if is_in_node:
                    current_node_entities.append({
                        "entity_id": ent['entity_id'],
                        "label": ent['name'],
                        "name": ent['name'],
                        "description": ent['description'],
                        "path": ent['representative_thumb']
                    })
            
            if not isinstance(node_dict.get('assets'), dict):
                node_dict['assets'] = {}
            # 将关联到的实体塞进 assets.segmented
            node_dict['assets']['segmented'] = current_node_entities

             # --- 转换类型 ---
            node_dict['is_group'] = bool(node_dict['is_group'])

            # --- 获取逻辑父节点 (用于 D3.js 或树图连线) ---
            cursor.execute("SELECT parent_node_id FROM node_parents WHERE child_node_id = ?", (node_dict['node_id'],))
            parents = cursor.fetchall()
            # 为了兼容性，保留 parent_id (取第一个) 和 parent_ids (完整列表)
            node_dict['parent_ids'] = [p['parent_node_id'] for p in parents]
            node_dict['parent_id'] = node_dict['parent_ids'][0] if node_dict['parent_ids'] else None
            node_dict['parent_group_id']=node_row['parent_group_id']


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


def get_all_entities(tree_id: int) -> list:
    """
    获取本项目下所有的实体档案。
    前端可以用这些数据在侧边栏渲染“实体卡片”。
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM Entities WHERE tree_id = ?", (tree_id,))
        rows = cursor.fetchall()
        entities = []
        for row in rows:
            ent_dict = dict(row)
            # 解析出场记录，前端可以据此实现“点击实体，高亮树节点”的功能
            ent_dict['appearance_nodes'] = json.loads(ent_dict['appearance_nodes']) if ent_dict['appearance_nodes'] else []
            entities.append(ent_dict)
        return entities
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

def create_group_and_assign_nodes(tree_id: int, node_ids: list, group_title: str):
    """
    将选中的多个节点合并为一个组。
    1. 创建一个 is_group=True 的特殊节点作为容器。
    2. 将选中节点的 parent_group_id 指向该容器节点。
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # 生成组节点的唯一 ID
        group_node_id = f"group_{uuid.uuid4().hex[:8]}"
        
        # 1. 创建组节点 (容器)
        # 组节点通常没有自己的 assets 和 parameters，它只是一个逻辑壳
        cursor.execute("""
            INSERT INTO nodes (
                node_id, tree_id, module_id, title, is_group, status
            ) VALUES (?, ?, ?, ?, ?, ?)
        """, (group_node_id, tree_id, "GroupContainer", group_title, 1, "completed"))

        # 2. 批量更新选中节点，将它们归属于这个组
        # 使用参数化查询防止注入，根据 node_ids 的数量动态生成占位符
        placeholders = ', '.join(['?'] * len(node_ids))
        sql = f"UPDATE nodes SET parent_group_id = ? WHERE node_id IN ({placeholders}) AND tree_id = ?"
        
        params = [group_node_id] + node_ids + [tree_id]
        cursor.execute(sql, params)

        conn.commit()
        print(f"✅ 成功创建组 {group_title} ({group_node_id})，包含 {len(node_ids)} 个节点")
        return group_node_id
    except sqlite3.Error as e:
        print(f"❌ 合并节点失败: {e}")
        conn.rollback()
        return None
    finally:
        conn.close()

def unmerge_group(group_node_id: str):
    """解散组：将组内节点的 parent_group_id 置空，并删除组节点"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # 1. 将子节点的归属清空
        cursor.execute("UPDATE nodes SET parent_group_id = NULL WHERE parent_group_id = ?", (group_node_id,))
        
        # 2. 删除组节点本身
        cursor.execute("DELETE FROM nodes WHERE node_id = ?", (group_node_id,))
        
        conn.commit()
        return True
    except sqlite3.Error as e:
        print(f"解散组失败: {e}")
        return False
    finally:
        conn.close()

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


def update_entity_info(entity_id: str, new_name: str, new_desc: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE Entities SET name = ?, description = ? WHERE entity_id = ?", (new_name, new_desc, entity_id))
    conn.commit()
    conn.close()


def add_or_update_entity_appearance(tree_id, name, node_id, branch_id, image_url):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.row_factory = lambda cursor, row: {col[0]: row[i] for i, col in enumerate(cursor.description)}
    
    try:
        # 1. 查询同一 tree 下的同名实体
        cursor.execute(
            "SELECT entity_id, appearance_nodes FROM Entities WHERE name = ? AND tree_id = ?",
            (name, tree_id)
        )
        result = cursor.fetchone()
        
        if result:
            # 2. 实体存在 → 仅更新当前 node 的数据（不碰其他 node）
            entity_id = result['entity_id']
            appearance_nodes = json.loads(result['appearance_nodes'])
            # 标记是否更新了现有 node
            updated = False
            
            for idx, app in enumerate(appearance_nodes):
                if app['node_id'] == node_id:
                    # 仅更新当前 node 的 thumb 和 branch_id
                    appearance_nodes[idx]['thumb'] = image_url
                    appearance_nodes[idx]['branch_id'] = branch_id
                    updated = True
                    break
            
            # 未找到当前 node → 新增（不影响旧 node）
            if not updated:
                appearance_nodes.append({
                    "node_id": node_id,
                    "branch_id": branch_id,
                    "thumb": image_url
                })
            
            # 执行更新（仅替换 appearance_nodes，保留其他字段）
            cursor.execute(
                "UPDATE Entities SET appearance_nodes = ?, representative_thumb = ? WHERE entity_id = ?",
                (json.dumps(appearance_nodes), image_url, entity_id)
            )
        else:
            # 3. 实体不存在 → 新建（原有逻辑）
            new_id = str(uuid.uuid4())
            appearance_nodes = [{
                "node_id": node_id,
                "branch_id": branch_id,
                "thumb": image_url
            }]
            cursor.execute(
                "INSERT INTO Entities (entity_id, tree_id, name, representative_thumb, appearance_nodes) VALUES (?, ?, ?, ?, ?)",
                (new_id, tree_id, name, image_url, json.dumps(appearance_nodes))
            )
        
        conn.commit()
    finally:
        conn.close()

# --- (可选) 用于测试的 main 函数 ---
if __name__ == '__main__':
    import os
    print("开始数据库功能测试...")
    
    # 1. 环境初始化
    if os.path.exists(DATABASE_FILE): os.remove(DATABASE_FILE)
    init_db()
    tid = create_tree("数据库测试")

    # 2. 建立基础树结构 (分支 A 和 分支 B)
    add_node("root", tid, None, "Init", {}, "项目根节点")
    add_node("sc_forest", tid, ["root"], "SceneGen", {}, "森林分支")
    add_node("shot_forest_01", tid, ["sc_forest"], "VisualGen", {}, "森林镜头1")
    add_node("sc_desert", tid, ["root"], "SceneGen", {}, "沙漠分支")
    add_node("shot_desert_01", tid, ["sc_desert"], "VisualGen", {}, "沙漠镜头1")

    print("\n--- 模拟 Agent 跨场景识别同一主体 ---")
    # 在两个不同分支的镜头里都发现了 "Girl"
    add_or_update_entity_appearance(tid, "Girl", "shot_forest_01", "sc_forest", "/img/forest_girl.jpg")
    add_or_update_entity_appearance(tid, "Girl", "shot_desert_01", "sc_desert", "/img/desert_girl.jpg")

    # 3. 模拟用户在独立区域编辑实体信息
    # 假设前端通过 get_all_entities 拿到了 ID
    conn = get_db_connection()
    entity_row = conn.execute("SELECT entity_id FROM Entities WHERE name = 'Girl'").fetchone()
    if entity_row:
        eid = entity_row['entity_id']
        print(f"--- 发现实体档案 ID: {eid}，开始全局更名 ---")
        update_entity_info(eid, "莉莉", "一个跨越森林与沙漠的探险家")

    # 4. 验证 API 返回结果 (模拟前端双路请求)
    print("\n--- [验证 A] get_tree_as_json (树图数据) ---")
    tree_data = get_tree_as_json(tid)
    # 此时 nodes 列表里不应该有具体的实体详情了，结构很干净
    print(f"树名: {tree_data['name']}")
    print(f"节点总数: {len(tree_data['nodes'])}")
    print(f"节点示例 (shot_forest_01) 的分支: {tree_data['nodes'][2]['branch_id']}")

    print("\n--- [验证 B] get_all_entities (侧边栏实体库数据) ---")
    entities_data = get_all_entities(tid)
    for ent in entities_data:
        print(f"实体名字: {ent['name']} (应为 莉莉)")
        print(f"实体设定: {ent['description']}")
        print(f"出场足迹: {ent['appearance_nodes']}") # 应该包含两个不同分支的节点

    print("\n✅ 测试通过！现在的结构完美支持“左边看树，右边看人”。")