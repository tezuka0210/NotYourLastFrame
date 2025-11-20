import os
import glob


# 指向你真实的 backend/workflows 文件夹的绝对路径
# 例如: "/home/username/zzy/video_tree/backend/workflows"
WORKFLOW_DIR = "/home/zhengzy/video_tree/backend/workflows" 

def get_all_workflow_names():
    """
    扫描文件夹，返回所有 json 文件名列表
    """
    # 容错处理：如果路径不对，返回空列表
    if not os.path.exists(WORKFLOW_DIR):
        print(f"⚠️ 警告: 路径不存在 -> {WORKFLOW_DIR}")
        return []

    # 找 .json 文件
    files = glob.glob(os.path.join(WORKFLOW_DIR, "*.json"))

    # 只取文件名，不要全路径
    file_names = [os.path.basename(f) for f in files]
    return file_names

# 测试一下 (你可以直接运行这个文件 python agents/utils.py 看看能不能读到)
if __name__ == "__main__":
    print(get_all_workflow_names())