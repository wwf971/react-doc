// A QR code of a short text, as a matrix of dark and light modules: what an authenticator app
// scans when a person turns on MFA (the otpauth:// uri of the secret). Written here because the
// page has no QR library and the secret must not leave the browser to be drawn elsewhere.
//
// byte mode, error correction level L, versions 1 to 12 (up to 367 bytes): enough for an otpauth
// uri. the mask is the one with the lowest penalty, as the standard asks.
//
//   qrCodeBuild(text)  -> { size, moduleList: boolean[][] } | undefined (the text is too long)
//   qrCodeSvgBuild(text, { margin })  -> the svg markup of the code, or ''

// per version (index 0 unused): the error correction codewords of a block, and the blocks as
// [count, data codewords] pairs. level L
const VERSION_TABLE = [
  null,
  { ec: 7, blockList: [[1, 19]] },
  { ec: 10, blockList: [[1, 34]] },
  { ec: 15, blockList: [[1, 55]] },
  { ec: 20, blockList: [[1, 80]] },
  { ec: 26, blockList: [[1, 108]] },
  { ec: 18, blockList: [[2, 68]] },
  { ec: 20, blockList: [[2, 78]] },
  { ec: 24, blockList: [[2, 97]] },
  { ec: 30, blockList: [[2, 116]] },
  { ec: 18, blockList: [[2, 68], [2, 69]] },
  { ec: 20, blockList: [[4, 81]] },
  { ec: 24, blockList: [[2, 92], [2, 93]] },
];

const ALIGNMENT_TABLE = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58]];

const dataCapacityGet = (version) => VERSION_TABLE[version].blockList.reduce((sum, [count, size]) => sum + count * size, 0);

export function qrCodeBuild(text) {
  const byteList = [...new TextEncoder().encode(String(text ?? ''))];
  let version = 0;
  for (let candidate = 1; candidate < VERSION_TABLE.length; candidate++) {
    const lengthBits = candidate < 10 ? 8 : 16;
    if (4 + lengthBits + byteList.length * 8 <= dataCapacityGet(candidate) * 8) {
      version = candidate;
      break;
    }
  }
  if (!version) return undefined;
  const codewordList = codewordListBuild(byteList, version);
  const size = version * 4 + 17;
  const moduleList = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunctionList = Array.from({ length: size }, () => new Array(size).fill(false));
  functionPatternDraw(moduleList, isFunctionList, version);
  codewordDraw(moduleList, isFunctionList, codewordList);
  // the mask with the lowest penalty
  let maskBest = 0;
  let penaltyBest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    maskApply(moduleList, isFunctionList, mask);
    formatDraw(moduleList, isFunctionList, mask);
    const penalty = penaltyGet(moduleList);
    if (penalty < penaltyBest) {
      penaltyBest = penalty;
      maskBest = mask;
    }
    maskApply(moduleList, isFunctionList, mask);
  }
  maskApply(moduleList, isFunctionList, maskBest);
  formatDraw(moduleList, isFunctionList, maskBest);
  return { size, moduleList };
}

export function qrCodeSvgBuild(text, { margin = 2 } = {}) {
  const code = qrCodeBuild(text);
  if (!code) return '';
  const total = code.size + margin * 2;
  let path = '';
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) if (code.moduleList[y][x]) path += `M${x + margin},${y + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// ---------- the codewords: the data, then the error correction of every block, interleaved ----------

function codewordListBuild(byteList, version) {
  const capacity = dataCapacityGet(version);
  const bitList = [];
  const bitsPush = (value, length) => {
    for (let index = length - 1; index >= 0; index--) bitList.push((value >>> index) & 1);
  };
  bitsPush(0b0100, 4);
  bitsPush(byteList.length, version < 10 ? 8 : 16);
  for (const byte of byteList) bitsPush(byte, 8);
  bitsPush(0, Math.min(4, capacity * 8 - bitList.length));
  while (bitList.length % 8 !== 0) bitList.push(0);
  const dataList = [];
  for (let index = 0; index < bitList.length; index += 8) dataList.push(bitList.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
  for (let pad = 0xec; dataList.length < capacity; pad ^= 0xec ^ 0x11) dataList.push(pad);
  const { ec, blockList } = VERSION_TABLE[version];
  const divisor = reedSolomonDivisorBuild(ec);
  const blockDataList = [];
  let offset = 0;
  for (const [count, blockSize] of blockList) {
    for (let index = 0; index < count; index++) {
      const data = dataList.slice(offset, offset + blockSize);
      offset += blockSize;
      blockDataList.push({ data, ecList: reedSolomonRemainderGet(data, divisor) });
    }
  }
  const result = [];
  const dataLengthMax = Math.max(...blockDataList.map((block) => block.data.length));
  for (let index = 0; index < dataLengthMax; index++) for (const block of blockDataList) if (index < block.data.length) result.push(block.data[index]);
  for (let index = 0; index < ec; index++) for (const block of blockDataList) result.push(block.ecList[index]);
  return result;
}

function reedSolomonMultiply(x, y) {
  let z = 0;
  for (let index = 7; index >= 0; index--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> index) & 1) * x;
  }
  return z;
}

function reedSolomonDivisorBuild(degree) {
  const result = new Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let index = 0; index < degree; index++) {
    for (let position = 0; position < result.length; position++) {
      result[position] = reedSolomonMultiply(result[position], root);
      if (position + 1 < result.length) result[position] ^= result[position + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainderGet(data, divisor) {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= reedSolomonMultiply(coefficient, factor);
    });
  }
  return result;
}

// ---------- the matrix ----------

function functionPatternDraw(moduleList, isFunctionList, version) {
  const size = moduleList.length;
  const set = (x, y, isDark) => {
    moduleList[y][x] = isDark;
    isFunctionList[y][x] = true;
  };
  // the timing patterns
  for (let index = 0; index < size; index++) {
    set(6, index, index % 2 === 0);
    set(index, 6, index % 2 === 0);
  }
  // the three finder patterns, with their separators
  for (const [centerX, centerY] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = centerX + dx;
        const y = centerY + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  // the alignment patterns, but where a finder pattern is
  const positionList = ALIGNMENT_TABLE[version];
  const last = positionList.length - 1;
  positionList.forEach((centerY, indexY) => {
    positionList.forEach((centerX, indexX) => {
      if ((indexX === 0 && indexY === 0) || (indexX === 0 && indexY === last) || (indexX === last && indexY === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  // the format bits are reserved now and drawn with the mask; the dark module beside them
  formatDraw(moduleList, isFunctionList, 0);
  // the version, twice, from version 7
  if (version >= 7) {
    let remainder = version;
    for (let index = 0; index < 12; index++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let index = 0; index < 18; index++) {
      const isDark = ((bits >>> index) & 1) !== 0;
      const a = size - 11 + (index % 3);
      const b = Math.floor(index / 3);
      set(a, b, isDark);
      set(b, a, isDark);
    }
  }
}

// the 15 format bits (level L and the mask), twice
function formatDraw(moduleList, isFunctionList, mask) {
  const size = moduleList.length;
  const data = (1 << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bitGet = (index) => ((bits >>> index) & 1) !== 0;
  const set = (x, y, isDark) => {
    moduleList[y][x] = isDark;
    isFunctionList[y][x] = true;
  };
  for (let index = 0; index <= 5; index++) set(8, index, bitGet(index));
  set(8, 7, bitGet(6));
  set(8, 8, bitGet(7));
  set(7, 8, bitGet(8));
  for (let index = 9; index < 15; index++) set(14 - index, 8, bitGet(index));
  for (let index = 0; index < 8; index++) set(size - 1 - index, 8, bitGet(index));
  for (let index = 8; index < 15; index++) set(8, size - 15 + index, bitGet(index));
  set(8, size - 8, true);
}

// the codewords laid in the zigzag of the standard, over the modules that are no function pattern
function codewordDraw(moduleList, isFunctionList, codewordList) {
  const size = moduleList.length;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        const isUpward = ((right + 1) & 2) === 0;
        const y = isUpward ? size - 1 - vertical : vertical;
        if (isFunctionList[y][x] || bitIndex >= codewordList.length * 8) continue;
        moduleList[y][x] = ((codewordList[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
        bitIndex += 1;
      }
    }
  }
}

function maskApply(moduleList, isFunctionList, mask) {
  const size = moduleList.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunctionList[y][x]) continue;
      let isInverted;
      switch (mask) {
        case 0: isInverted = (x + y) % 2 === 0; break;
        case 1: isInverted = y % 2 === 0; break;
        case 2: isInverted = x % 3 === 0; break;
        case 3: isInverted = (x + y) % 3 === 0; break;
        case 4: isInverted = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: isInverted = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: isInverted = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: isInverted = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (isInverted) moduleList[y][x] = !moduleList[y][x];
    }
  }
}

// the four penalties of the standard: runs, blocks, finder-like patterns, the balance of dark and light
function penaltyGet(moduleList) {
  const size = moduleList.length;
  let penalty = 0;
  const lineScan = (cellGet) => {
    for (let outer = 0; outer < size; outer++) {
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      const historyPush = (length) => {
        history.pop();
        history.unshift(history.length === 6 && history.every((one) => one === 0) ? length + size : length);
      };
      const finderCount = (runLengthNow) => {
        const unit = history[1];
        const isCore = unit > 0 && history[2] === unit && history[3] === unit * 3 && history[4] === unit && history[5] === unit;
        return (isCore && history[0] >= unit * 4 && history[6] >= unit ? 1 : 0) + (isCore && history[6] >= unit * 4 && history[0] >= unit ? 1 : 0) + 0 * runLengthNow;
      };
      for (let inner = 0; inner < size; inner++) {
        const color = cellGet(outer, inner);
        if (color === runColor) {
          runLength += 1;
          if (runLength === 5) penalty += 3;
          else if (runLength > 5) penalty += 1;
        } else {
          historyPush(runLength);
          if (!runColor) penalty += finderCount(runLength) * 40;
          runColor = color;
          runLength = 1;
        }
      }
      // the line ends: the light border counts as a run
      if (runColor) {
        historyPush(runLength);
        runLength = 0;
      }
      runLength += size;
      historyPush(runLength);
      penalty += finderCount(runLength) * 40;
    }
  };
  lineScan((y, x) => moduleList[y][x]);
  lineScan((x, y) => moduleList[y][x]);
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = moduleList[y][x];
      if (color === moduleList[y][x + 1] && color === moduleList[y + 1][x] && color === moduleList[y + 1][x + 1]) penalty += 3;
    }
  }
  let dark = 0;
  for (const row of moduleList) for (const cell of row) if (cell) dark += 1;
  const total = size * size;
  penalty += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return penalty;
}
