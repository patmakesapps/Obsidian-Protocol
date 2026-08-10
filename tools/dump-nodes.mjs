/**
 * Dumps a GLB's node hierarchy with transforms, plus the skinned mesh's
 * vertex bounds. This is what tells you where a character's origin actually
 * is — bounding-box guesswork is how models end up floating.
 *
 *   node tools/dump-nodes.mjs public/models/player.glb
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const buf = readFileSync(path);

let offset = 12;
let g = null;
while (offset < buf.length) {
  const len = buf.readUInt32LE(offset);
  const type = buf.readUInt32LE(offset + 4);
  if (type === 0x4e4f534a) g = JSON.parse(new TextDecoder().decode(buf.subarray(offset + 8, offset + 8 + len)));
  offset += 8 + len + ((4 - (len % 4)) % 4);
}

const fmt = (a, d = 3) => (a ? `[${a.map((v) => v.toFixed(d)).join(', ')}]` : null);

console.log(`\n=== ${path} ===`);
console.log(`scene root nodes: ${JSON.stringify(g.scenes[0].nodes)}`);

function walk(idx, depth = 0) {
  const n = g.nodes[idx];
  const pad = '  '.repeat(depth);
  const bits = [];
  if (n.translation) bits.push(`T${fmt(n.translation)}`);
  if (n.rotation) bits.push(`R${fmt(n.rotation)}`);
  if (n.scale) bits.push(`S${fmt(n.scale)}`);
  if (n.mesh !== undefined) bits.push(`mesh=${n.mesh}`);
  if (n.skin !== undefined) bits.push(`skin=${n.skin}`);
  console.log(`${pad}[${idx}] ${n.name ?? '(unnamed)'} ${bits.join(' ')}`);
  // Only descend a couple of levels into the bone tree — it's long and the
  // interesting transforms are all near the top.
  if (depth < 2) for (const c of n.children ?? []) walk(c, depth + 1);
  else if (n.children?.length) console.log(`${pad}  ...${n.children.length} children`);
}
for (const root of g.scenes[0].nodes) walk(root);

console.log('\n--- mesh vertex bounds (model space) ---');
for (const [mi, mesh] of g.meshes.entries()) {
  for (const p of mesh.primitives) {
    const acc = g.accessors[p.attributes.POSITION];
    console.log(`mesh[${mi}] ${mesh.name ?? ''}`);
    console.log(`  min ${fmt(acc.min)}`);
    console.log(`  max ${fmt(acc.max)}`);
    console.log(`  size ${fmt(acc.max.map((v, i) => v - acc.min[i]))}`);
  }
}

if (g.skins) {
  console.log('\n--- skin ---');
  for (const [si, skin] of g.skins.entries()) {
    console.log(`skin[${si}] skeleton root node = ${skin.skeleton ?? '(none)'}`);
    const root = skin.skeleton != null ? g.nodes[skin.skeleton] : null;
    if (root) console.log(`  '${root.name}' T${fmt(root.translation ?? [0, 0, 0])}`);
    const hips = skin.joints.find((j) => (g.nodes[j].name ?? '').includes('Hips'));
    if (hips != null) console.log(`  Hips node[${hips}] T${fmt(g.nodes[hips].translation ?? [0, 0, 0])}`);
  }
}
console.log('');
