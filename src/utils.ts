import {} from '@cordisjs/plugin-logger'
// src/utils.ts

export function randomSample(population: string[], sampleSize: number): string[] {
  if (sampleSize > population.length) {
    return population;
  }
  const shuffled = [...population];
  let i = population.length;
  let temp, index;
  while (i--) {
    index = Math.floor((i + 1) * Math.random());
    temp = shuffled[index];
    shuffled[index] = shuffled[i];
    shuffled[i] = temp;
  }
  return shuffled.slice(0, sampleSize);
}

export const generateDmParams = () => {
  const dm_rand = 'ABCDEFGHIJK'.split('');
  const dm_img_str = randomSample(dm_rand, 2).join('');
  const dm_cover_img_str = randomSample(dm_rand, 2).join('');
  
  return {
    dm_img_list: '[]',
    dm_img_str: dm_img_str,
    dm_cover_img_str: dm_cover_img_str,
    dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
  };
};

const magicStr = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
const s = [0, 1, 2, 9, 7, 5, 6, 4, 8, 3, 10, 11];
const BASE = 58n;
const MAX = (1n << 51n);
const LEN = 12;
const XOR = 23442827791579n;
const MASK = 2251799813685247n;

const table: Record<string, bigint> = {};
for (let i = 0; i < magicStr.length; i++) {
    table[magicStr[i]] = BigInt(i);
}

export function aidToBvid(aid: number | string): string {
  const aidBigInt = BigInt(aid);
  const r = Array.from('BV1         ');
  let it = LEN - 1;
  let tmp = (aidBigInt | MAX) ^ XOR;
  while (tmp !== 0n) {
    r[s[it]] = magicStr[Number(tmp % BASE)];
    tmp /= BASE;
    it--;
  }
  return r.join('');
}

export function bvidToAid(bvid: string): string {
  let r = 0n;
  for (let i = 3; i < LEN; i++) {
    r = r * BASE + table[bvid[s[i]]];
  }
  const result = (r & MASK) ^ XOR;
  return result.toString();
}
