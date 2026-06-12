// Truncated icosahedron (12 pentagons + 20 hexagons) as GeoJSON polygons for D3

type Vec3 = [number, number, number];

const PHI = (1 + Math.sqrt(5)) / 2;

const norm3 = (v: Vec3): Vec3 => {
  const l = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0],
];
const dot3 = (a: Vec3, b: Vec3) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const toLonLat = (v: Vec3): [number, number] => [
  Math.atan2(v[1], v[0]) * (180 / Math.PI),
  Math.asin(Math.max(-1, Math.min(1, v[2]))) * (180 / Math.PI),
];

// 12 icosahedron vertices (unnormalized for edge-length detection)
const icoRaw: Vec3[] = [
  [0, 1, PHI], [0, 1, -PHI], [0, -1, PHI], [0, -1, -PHI],
  [1, PHI, 0], [1, -PHI, 0], [-1, PHI, 0], [-1, -PHI, 0],
  [PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, 1], [-PHI, 0, -1],
];
const icoV = icoRaw.map(norm3);

// Adjacent pairs: dist² = 4 in unnormalized coordinates
const adj: number[][] = Array.from({ length: 12 }, () => []);
const edges: [number, number][] = [];
for (let i = 0; i < 12; i++) {
  for (let j = i + 1; j < 12; j++) {
    const a = icoRaw[i], b = icoRaw[j];
    if (Math.abs((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2 - 4) < 0.01) {
      edges.push([i, j]);
      adj[i].push(j);
      adj[j].push(i);
    }
  }
}

// 20 triangular faces
const icoFaces: [number, number, number][] = [];
for (let i = 0; i < 12; i++)
  for (const j of adj[i]) {
    if (j <= i) continue;
    for (const k of adj[j]) {
      if (k <= j || !adj[i].includes(k)) continue;
      icoFaces.push([i, j, k]);
    }
  }

// 60 TI vertices: ev[i][j] = index of vertex near i on edge (i,j)
const tiVerts: Vec3[] = [];
const ev: number[][] = Array.from({ length: 12 }, () => new Array(12).fill(-1));
for (const [i, j] of edges) {
  const vi = icoV[i], vj = icoV[j];
  ev[i][j] = tiVerts.length;
  tiVerts.push(norm3([(2*vi[0]+vj[0])/3, (2*vi[1]+vj[1])/3, (2*vi[2]+vj[2])/3]));
  ev[j][i] = tiVerts.length;
  tiVerts.push(norm3([(vi[0]+2*vj[0])/3, (vi[1]+2*vj[1])/3, (vi[2]+2*vj[2])/3]));
}

// Sort vertex indices CCW around an axis vector
const sortCCW = (axis: Vec3, idxs: number[]) => {
  const tmp: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm3(cross3(axis, tmp));
  const v = norm3(cross3(axis, u));
  return [...idxs].sort((a, b) =>
    Math.atan2(dot3(tiVerts[a], v), dot3(tiVerts[a], u)) -
    Math.atan2(dot3(tiVerts[b], v), dot3(tiVerts[b], u))
  );
};

// Ensure triangle is CCW when viewed from outside the sphere
const orientFace = (i: number, j: number, k: number): [number, number, number] => {
  const vi = icoV[i], vj = icoV[j], vk = icoV[k];
  const e1: Vec3 = [vj[0]-vi[0], vj[1]-vi[1], vj[2]-vi[2]];
  const e2: Vec3 = [vk[0]-vi[0], vk[1]-vi[1], vk[2]-vi[2]];
  const c: Vec3 = [(vi[0]+vj[0]+vk[0])/3, (vi[1]+vj[1]+vk[1])/3, (vi[2]+vj[2]+vk[2])/3];
  return dot3(cross3(e1, e2), c) > 0 ? [i, j, k] : [i, k, j];
};

const toRing = (idxs: number[]): [number, number][][] => {
  const ring = idxs.map(i => toLonLat(tiVerts[i]));
  ring.push(ring[0]);
  return [ring];
};

// 12 pentagon polygons (indices 0-11 in BALL_FACES)
export const BALL_PENTAGONS = Array.from({ length: 12 }, (_, i) => ({
  type: 'Polygon' as const,
  coordinates: toRing(sortCCW(icoV[i], adj[i].map(j => ev[i][j]))),
}));

// 20 hexagon polygons (indices 12-31 in BALL_FACES)
export const BALL_HEXAGONS = icoFaces.map(([ri, rj, rk]) => {
  const [i, j, k] = orientFace(ri, rj, rk);
  return {
    type: 'Polygon' as const,
    coordinates: toRing([ev[i][j], ev[j][i], ev[j][k], ev[k][j], ev[k][i], ev[i][k]]),
  };
});

export const BALL_FACES = [...BALL_PENTAGONS, ...BALL_HEXAGONS];
