#!/usr/bin/env python3
"""Per-pixel class probabilities (background, hair, body-skin, face-skin, clothes, others)
with MediaPipe's selfie_multiclass_256x256 segmenter.  R3-people helper.
Usage (module): seg = Segmenter(model_path); probs = seg(rgb_float01)  -> HxWx6 float32
"""
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

CLASSES = ["background", "hair", "body_skin", "face_skin", "clothes", "others"]


class Segmenter:
    def __init__(self, model):
        opts = vision.ImageSegmenterOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model),
            output_confidence_masks=True, output_category_mask=False)
        self.seg = vision.ImageSegmenter.create_from_options(opts)

    def __call__(self, rgb):
        u8 = np.ascontiguousarray(np.clip(rgb * 255, 0, 255).astype(np.uint8))
        r = self.seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=u8))
        return np.stack([np.squeeze(m.numpy_view()).astype(np.float32) for m in r.confidence_masks], -1)
