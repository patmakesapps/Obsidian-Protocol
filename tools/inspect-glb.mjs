/**
 * Dumps the structure of a .glb without loading a renderer: node/bone counts,
 * skins, animation clip names, materials and texture sizes. Run it on any new
 * character drop to find out what you actually got.
 *
 *   node tools/inspect-glb.mjs public/models/player.glb
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/inspect-glb.mjs <file.glb>');
  process.exit(1);
}

const buf = readFileSync(path);
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546c67) {
  console.error('not a binary glTF (missing glTF magic)');
  process.exit(1);
}

const version = buf.readUInt32LE(4);
const totalLength = buf.readUInt32LE(8);

let offset = 12;
let json = null;
let binLength = 0;
while (offset < buf.length) {
  const chunkLength = buf.readUInt32LE(offset);
  const chunkType = buf.readUInt32LE(offset + 4);
  const data = buf.subarray(offset + 8, offset + 8 + chunkLength);
  if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
  else if (chunkType === 0x004e4942) binLength = chunkLength;
  offset += 8 + chunkLength + ((4 - (chunkLength % 4)) % 4);
}

const g = json;
const line = (k, v) => console.log(`${k.padEnd(24)} ${v}`);

console.log(`\n=== ${path} ===`);
line('glTF version', version);
line('file size', `${(totalLength / 1024 / 1024).toFixed(2)} MB`);
line('binary chunk', `${(binLength / 1024 / 1024).toFixed(2)} MB`);
line('generator', g.asset?.generator ?? 'unknown');

console.log('');
line('scenes', g.scenes?.length ?? 0);
line('nodes', g.nodes?.length ?? 0);
line('meshes', g.meshes?.length ?? 0);
line('materials', g.materials?.length ?? 0);
line('textures', g.textures?.length ?? 0);
line('skins (rigs)', g.skins?.length ?? 0);
line('animations', g.animations?.length ?? 0);

if (g.skins?.length) {
  console.log('\n--- rig ---');
  g.skins.forEach((skin, i) => {
    line(`skin[${i}] name`, skin.name ?? '(unnamed)');
    line(`skin[${i}] joints`, skin.joints.length);
    const names = skin.joints.slice(0, 24).map((j) => g.nodes[j]?.name ?? `node${j}`);
    console.log(`  bones: ${names.join(', ')}${skin.joints.length > 24 ? ', …' : ''}`);
  });
} else {
  console.log('\n--- rig ---\n  NONE — this is a static mesh, not a rigged character.');
}

if (g.animations?.length) {
  console.log('\n--- animations ---');
  g.animations.forEach((anim, i) => {
    line(`clip[${i}]`, `${anim.name ?? '(unnamed)'}  (${anim.channels.length} channels)`);
  });
} else {
  console.log('\n--- animations ---\n  NONE — no clips embedded.');
}

if (g.meshes?.length) {
  console.log('\n--- meshes ---');
  let tris = 0;
  g.meshes.forEach((mesh, i) => {
    mesh.primitives.forEach((p) => {
      const idxCount = p.indices != null ? g.accessors[p.indices].count : 0;
      tris += idxCount / 3;
      const hasSkin = p.attributes.JOINTS_0 != null;
      console.log(
        `  mesh[${i}] ${(mesh.name ?? '').padEnd(22)} tris ${String(Math.round(idxCount / 3)).padStart(7)}  skinned:${hasSkin}`,
      );
    });
  });
  line('total triangles', Math.round(tris).toLocaleString());
}

if (g.images?.length) {
  console.log('\n--- textures ---');
  g.images.forEach((img, i) => {
    const bv = img.bufferView != null ? g.bufferViews[img.bufferView] : null;
    const kb = bv ? (bv.byteLength / 1024).toFixed(0) : '?';
    console.log(`  image[${i}] ${(img.name ?? img.mimeType ?? '').padEnd(24)} ${kb} KB`);
  });
}

// Bounding box from the POSITION accessor min/max — tells us the model's scale.
const positions = [];
for (const mesh of g.meshes ?? []) {
  for (const p of mesh.primitives) {
    const acc = g.accessors[p.attributes.POSITION];
    if (acc?.min && acc?.max) positions.push([acc.min, acc.max]);
  }
}
if (positions.length) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [lo, hi] of positions) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], lo[i]);
      max[i] = Math.max(max[i], hi[i]);
    }
  }
  console.log('\n--- bounds (model space) ---');
  line('min', min.map((v) => v.toFixed(3)).join(', '));
  line('max', max.map((v) => v.toFixed(3)).join(', '));
  line('size (w,h,d)', max.map((v, i) => (v - min[i]).toFixed(3)).join(', '));
  line('height', `${(max[1] - min[1]).toFixed(3)} units`);
}
console.log('');
