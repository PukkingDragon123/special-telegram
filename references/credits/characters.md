# Credits — characters module (public/assets/gen/characters/)

Real-photo fabric textures (albedo, resized to 512 px), all **CC0** from Poly Haven (https://polyhaven.com):

| file | source | author | licence |
|---|---|---|---|
| fab/crepe_satin.jpg | https://polyhaven.com/a/crepe_satin | Poly Haven | CC0 |
| fab/denim_fabric_03.jpg | https://polyhaven.com/a/denim_fabric_03 | Poly Haven | CC0 |
| fab/denim_fabric_06.jpg | https://polyhaven.com/a/denim_fabric_06 | Poly Haven | CC0 |
| fab/floral_jacquard.jpg | https://polyhaven.com/a/floral_jacquard | Poly Haven | CC0 |
| fab/gingham_check.jpg | https://polyhaven.com/a/gingham_check | Poly Haven | CC0 |
| fab/hessian_230.jpg | https://polyhaven.com/a/hessian_230 | Poly Haven | CC0 |
| fab/jersey_melange.jpg | https://polyhaven.com/a/jersey_melange | Poly Haven | CC0 |
| fab/ribbed_corduroy.jpg | https://polyhaven.com/a/ribbed_corduroy | Poly Haven | CC0 |
| fab/rough_linen.jpg | https://polyhaven.com/a/rough_linen | Poly Haven | CC0 |
| fab/stretch_poplin.jpg | https://polyhaven.com/a/stretch_poplin | Poly Haven | CC0 |
| fab/tatami_mat.jpg | https://polyhaven.com/a/tatami_mat | Poly Haven | CC0 |
| fab/terry_cloth.jpg | https://polyhaven.com/a/terry_cloth | Poly Haven | CC0 |
| fab/waffle_pique_cotton.jpg | https://polyhaven.com/a/waffle_pique_cotton | Poly Haven | CC0 |

Also used at runtime from the shared library (already credited by the PBR research agent): textures/pbr/cotton_jersey,
denim, canvas_tarp, leather_black, rubber_black, velvet_red. Faces / clothing prints / hair photos come from
public/assets/textures/{faces,clothing,hair} (research agent, see its credits).

| fab/check_red.jpg, check_blue.jpg, check_green.jpg | https://polyhaven.com/a/fabric_pattern_07 (colourways) | Poly Haven | CC0 |
| fab/windowpane_blue.jpg, windowpane_red.jpg, windowpane_green.jpg | https://polyhaven.com/a/fabric_pattern_05 (colourways) | Poly Haven | CC0 |
| fab/herringbone.jpg | https://polyhaven.com/a/poly_wool_herringbone | Poly Haven | CC0 |
| fab/rib_knit.jpg | https://ambientcg.com/a/Fabric026 | ambientCG (Lennart Demes) | CC0 |
| fab/twill_beige.jpg | https://ambientcg.com/a/Fabric062 | ambientCG (Lennart Demes) | CC0 |
| fab/grid_red.jpg | https://ambientcg.com/a/Fabric067 | ambientCG (Lennart Demes) | CC0 |
| fab/stripe_check.jpg | https://ambientcg.com/a/Fabric078 | ambientCG (Lennart Demes) | CC0 |
| fab/quilted.jpg | https://ambientcg.com/a/Fabric047 | ambientCG (Lennart Demes) | CC0 |

## Sculpted rigged bodies + animation library

| file | source | author | licence |
|---|---|---|---|
| body_m.glb, body_f.glb (+ .json metrics) | "Universal Base Characters [Standard]" — Superhero_Male_FullBody / Superhero_Female_FullBody (Godot-UE skeleton), https://quaternius.itch.io/universal-base-characters | Quaternius | CC0 |
| anims.glb | "Universal Animation Library [Standard]" — UAL1_Standard.glb (43 clips), https://quaternius.itch.io/universal-animation-library | Quaternius | CC0 |

Processing (headless Blender 4.2, `scripts/characters/build_chars.py`): seam-weld, muscle softening (less
"superhero"), eye sockets filled (static photo faces are painted on), eyes/brows/hair meshes removed, decimated to
4.6k / 1.5k tris, atlas-layout UVs, plane-cut clothing shells (tops/sleeves/bottoms/shoe) and skirt cones with
transferred weights, measured torso/neck/head tables for the procedural hair/accessory fitter. Clips are kept
unmodified and retargeted at load time (rest-pose delta per bone).

Clothing photo textures used through `PHOTO_USE` in atlas.ts (stripes, Hawaiian prints, ผ้าขาวม้า checks, denim,
suiting, satin/velvet, school twill, police khaki, vest/rider polys, ditsy blouses, apron, terry, sneaker leather) and
hair photos come from public/assets/textures/clothing|hair — sources/licences are listed in those manifests and in
references/credits/R3-people.md (research agent).
