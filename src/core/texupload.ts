import * as THREE from 'three';

/* ============================================================================================
 * Time-sliced upload of one BIG image texture (the 4096² world atlases: 64 MB each). three.js uploads an image in a
 * single texSubImage2D call — a long freeze. Here the GL texture is allocated once (texStorage2D), the image goes up
 * in horizontal strips (one strip per frame, each strip cut off the main thread by createImageBitmap), the mip
 * chain is generated at the end, and the finished GL texture is handed to three.js (its texture properties point at
 * it, version in sync) so three binds it without uploading again. The texture keeps `image` = the full bitmap, so a
 * context restore still re-uploads it the normal way. Anything unexpected → falls back to renderer.initTexture.
 * ========================================================================================== */

const noSlice = typeof location !== 'undefined' && new URLSearchParams(location.search).has('noslice');

export async function uploadSliced(R: THREE.WebGLRenderer, tex: THREE.Texture, bmp: ImageBitmap, nextFrame: () => Promise<void>, strip = 512): Promise<void> {
  const gl = R.getContext() as WebGL2RenderingContext;
  const w = bmp.width, h = bmp.height;
  if (noSlice || !(gl instanceof WebGL2RenderingContext) || !w || !h || typeof createImageBitmap !== 'function'
    || tex.format !== THREE.RGBAFormat || tex.type !== THREE.UnsignedByteType || h <= strip) { R.initTexture(tex); return; }
  const props: any = (R as any).properties.get(tex);
  if (props.__webglTexture) { R.initTexture(tex); return; }   // three already owns one
  const state: any = (R as any).state;
  const srgb = tex.colorSpace === THREE.SRGBColorSpace;
  const mips = tex.generateMipmaps && tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter;
  const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
  const glTex = gl.createTexture();
  if (!glTex) { R.initTexture(tex); return; }
  const bind = () => { state.activeTexture(gl.TEXTURE0); state.bindTexture(gl.TEXTURE_2D, glTex); };
  try {
    bind();
    gl.texStorage2D(gl.TEXTURE_2D, levels, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, w, h);
    for (let y = 0; y < h; y += strip) {
      const sh = Math.min(strip, h - y);
      const part = await createImageBitmap(bmp, 0, y, w, sh, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as any);
      bind();
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, w, sh, gl.RGBA, gl.UNSIGNED_BYTE, part);
      part.close();
      state.unbindTexture();
      await nextFrame();
    }
    bind();
    const wrap = (m: THREE.Wrapping) => (m === THREE.RepeatWrapping ? gl.REPEAT : m === THREE.MirroredRepeatWrapping ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(tex.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(tex.wrapT));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, tex.magFilter === THREE.NearestFilter ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    const an: any = gl.getExtension('EXT_texture_filter_anisotropic');
    if (an && tex.anisotropy > 1) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(tex.anisotropy, R.capabilities.getMaxAnisotropy()));
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    state.unbindTexture();
  } catch (e) {
    console.warn('[tex] sliced upload failed, uploading in one go', e);
    try { state.unbindTexture(); gl.deleteTexture(glTex); } catch { /* lost context */ }
    R.initTexture(tex);
    return;
  }
  // hand it to three: same bookkeeping its own upload leaves behind (bound as-is from now on)
  props.__webglTexture = glTex;
  props.__version = tex.version;
  // three's anisotropy cache (setTextureParameters is skipped for this texture)
  props.__currentAnisotropy = tex.anisotropy;
  // free the GL texture when three would have (dispose of the Texture)
  const onDispose = () => {
    tex.removeEventListener('dispose', onDispose);
    if (props.__webglTexture === glTex) { try { gl.deleteTexture(glTex); } catch { /* lost */ } props.__webglTexture = undefined; }
  };
  tex.addEventListener('dispose', onDispose);
}
