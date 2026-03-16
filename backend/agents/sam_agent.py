import torch
import os
import uuid
import re
import numpy as np
from PIL import Image
from sam3.sam3.model_builder import build_sam3_image_model
from sam3.sam3.model.sam3_image_processor import Sam3Processor

class SAMAgent:
    def __init__(self):
        # 1. 只有在第一次初始化时加载模型
        print("⏳ 正在加载 SAM 3 模型到显存...")
        self.model = build_sam3_image_model()
        self.processor = Sam3Processor(self.model)
        print("✅ SAM 3 模型加载完成")

    def segment_by_text(self, image_path, text_prompt, output_dir):
        """根据文本提示词分割实体并保存抠图（合并所有有效mask为一个输出）"""
        # 加载并转换图片
        image = Image.open(image_path)
        if image.mode != "RGB":
            image = image.convert("RGB")
        image_np = np.array(image)  # 备用：用于后续合并mask的尺寸对齐
        H, W = image_np.shape[:2]   # 获取原图高宽

        # 设置推理状态
        inference_state = self.processor.set_image(image)
        
        # 运行推理
        output = self.processor.set_text_prompt(
            state=inference_state, 
            prompt=text_prompt
        )
        
        masks, boxes, scores = output["masks"], output["boxes"], output["scores"]
        
        # 处理结果并保存抠图
        results = []
        valid_masks = []  # 存储所有有效（score≥0.5）的mask
        valid_boxes = []  # 存储所有有效mask对应的box
        
        # 第一步：筛选所有有效mask和box
        if len(masks) > 0:
            for i, mask in enumerate(masks):
                if scores[i] < 0.5: 
                    continue
                
                # 处理mask格式（和原逻辑一致）
                mask_np = mask.cpu().numpy().squeeze()
                if mask_np.ndim != 2:
                    print(f"⚠️ 警告：Mask 维度异常 {mask_np.shape}，尝试进一步处理")
                    if mask_np.ndim == 3 and mask_np.shape[0] == 1:
                        mask_np = mask_np[0]
                
                # 确保mask尺寸和原图一致（防止维度不匹配）
                if mask_np.shape != (H, W):
                    from PIL import Image as PILImage
                    mask_pil = PILImage.fromarray((mask_np * 255).astype('uint8')).resize((W, H))
                    mask_np = np.array(mask_pil) / 255.0
                
                valid_masks.append(mask_np)
                valid_boxes.append(boxes[i].cpu().numpy().squeeze())
        
        # 第二步：合并所有有效mask为一个
        if len(valid_masks) > 0:
            # 初始化合并mask（全0）
            merged_mask = np.zeros((H, W), dtype=np.float32)
            # 逻辑或：只要任意一个mask在该位置为1，合并后为1
            for mask in valid_masks:
                merged_mask = np.logical_or(merged_mask, mask).astype(np.float32)
            
            # 合并所有box：取最小的left/top，最大的right/bottom（覆盖所有有效区域）
            boxes_np = np.array(valid_boxes)
            merged_box = [
                np.min(boxes_np[:, 0]),  # left
                np.min(boxes_np[:, 1]),  # top
                np.max(boxes_np[:, 2]),  # right
                np.max(boxes_np[:, 3])   # bottom
            ]
            
            # 计算合并后mask的平均置信度（也可以取最高score）
            avg_score = np.mean([s.cpu().numpy() for s in scores if s >= 0.5])
            
            # 第三步：基于合并后的mask生成抠图
            # 转PIL格式（0/255）
            merged_mask_img = Image.fromarray((merged_mask * 255).astype('uint8'), mode='L')
            # 创建带透明度的图
            entity_img = image.copy()
            entity_img.putalpha(merged_mask_img)
            # 裁剪到合并后的box区域
            left, top, right, bottom = merged_box
            entity_crop = entity_img.crop((left, top, right, bottom))
            
            # 保存文件
            os.makedirs(output_dir, exist_ok=True)  # 确保输出目录存在
            clean_label = re.sub(r'[^a-zA-Z0-9]', '_', text_prompt.lower())
            filename = f"{clean_label}_merged_{uuid.uuid4().hex[:6]}.png"
            save_path = os.path.join(output_dir, filename)
            entity_crop.save(save_path)
            
            # 记录结果
            results.append({
                "path": save_path,
                "score": float(avg_score),  # 合并后的分数（也可以用max(scores)）
                "label": text_prompt,
                "mask_count": len(valid_masks)  # 记录合并了多少个mask
            })
        
        return results