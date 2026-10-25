"""@model registry for the custom Thai builders (see build.py)."""
import inspect, os
MODELS = {}


def model(name, **meta):
    """register a builder: meta = catalog fields (cat, tags, phys, mass, tint, friction, far, collider, anchor, title)
    + bake options (bake = atlas px, low = low-poly triangle target, tex = shipped texture px, tris = hard cap)."""
    def deco(fn):
        meta['_file'] = os.path.basename(inspect.getsourcefile(fn))
        MODELS[name] = (fn, meta)
        return fn
    return deco
