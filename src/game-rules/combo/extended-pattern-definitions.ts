import { BoardCoord } from '../patterns/pattern.types';

/** Big N (vertical) and Big Z (horizontal) — 2 orientations. */
export const BIG_N_OR_Z_VARIANTS: BoardCoord[][] = [
  // N: B column + main-diagonal mid + O column
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ],
  // Z: top row + anti-diagonal mid + bottom row
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 3],
    [2, 2],
    [3, 1],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [4, 4],
  ],
];

/** Big M / W upright and two sideways orientations — 4 total. */
export const BIG_M_OR_W_VARIANTS: BoardCoord[][] = [
  // M (peaks up): B + O + top V through FREE
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [1, 1],
    [2, 2],
    [1, 3],
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ],
  // W (peaks down): B + O + bottom V through FREE
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [3, 1],
    [2, 2],
    [3, 3],
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ],
  // Sideways pointing right: top + bottom + right zig
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 3],
    [2, 2],
    [3, 3],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [4, 4],
  ],
  // Sideways pointing left: top + bottom + left zig
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 1],
    [2, 2],
    [3, 1],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [4, 4],
  ],
];

const CORNER_CELLS: BoardCoord[] = [
  [0, 0],
  [0, 4],
  [4, 0],
  [4, 4],
];

export function buildCornerVariants(): BoardCoord[][] {
  return CORNER_CELLS.map((cell) => [cell]);
}

/** All 2x3 and 3x2 rectangles on a 5x5 board (24). */
export function buildRectangle2x3Or3x2Variants(): BoardCoord[][] {
  const variants: BoardCoord[][] = [];

  // 2 rows x 3 cols
  for (let row = 0; row <= 3; row += 1) {
    for (let col = 0; col <= 2; col += 1) {
      const cells: BoardCoord[] = [];
      for (let r = row; r < row + 2; r += 1) {
        for (let c = col; c < col + 3; c += 1) {
          cells.push([r, c]);
        }
      }
      variants.push(cells);
    }
  }

  // 3 rows x 2 cols
  for (let row = 0; row <= 2; row += 1) {
    for (let col = 0; col <= 3; col += 1) {
      const cells: BoardCoord[] = [];
      for (let r = row; r < row + 3; r += 1) {
        for (let c = col; c < col + 2; c += 1) {
          cells.push([r, c]);
        }
      }
      variants.push(cells);
    }
  }

  return variants;
}

/**
 * Small T: 5 cells (bar of 3 + stem of 2 beyond the junction).
 * Four orientations, all in-bounds placements.
 */
export function buildSmallTVariants(): BoardCoord[][] {
  const variants: BoardCoord[][] = [];

  // Bar on top, stem down
  for (let row = 0; row <= 2; row += 1) {
    for (let col = 0; col <= 2; col += 1) {
      variants.push([
        [row, col],
        [row, col + 1],
        [row, col + 2],
        [row + 1, col + 1],
        [row + 2, col + 1],
      ]);
    }
  }

  // Bar on bottom, stem up
  for (let row = 2; row <= 4; row += 1) {
    for (let col = 0; col <= 2; col += 1) {
      variants.push([
        [row, col],
        [row, col + 1],
        [row, col + 2],
        [row - 1, col + 1],
        [row - 2, col + 1],
      ]);
    }
  }

  // Bar on left, stem right
  for (let row = 0; row <= 2; row += 1) {
    for (let col = 0; col <= 2; col += 1) {
      variants.push([
        [row, col],
        [row + 1, col],
        [row + 2, col],
        [row + 1, col + 1],
        [row + 1, col + 2],
      ]);
    }
  }

  // Bar on right, stem left
  for (let row = 0; row <= 2; row += 1) {
    for (let col = 2; col <= 4; col += 1) {
      variants.push([
        [row, col],
        [row + 1, col],
        [row + 2, col],
        [row + 1, col - 1],
        [row + 1, col - 2],
      ]);
    }
  }

  return variants;
}

/**
 * 6-cell right triangles inside every 3x3 window (4 orientations each).
 */
export function buildTriangle6Variants(): BoardCoord[][] {
  const localShapes: BoardCoord[][] = [
    // top-left filled
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
    // top-right filled
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [1, 2],
      [2, 2],
    ],
    // bottom-left filled
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
      [2, 2],
    ],
    // bottom-right filled
    [
      [0, 2],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ],
  ];

  const variants: BoardCoord[][] = [];
  for (let row = 0; row <= 2; row += 1) {
    for (let col = 0; col <= 2; col += 1) {
      for (const shape of localShapes) {
        variants.push(
          shape.map(([r, c]) => [r + row, c + col] as BoardCoord),
        );
      }
    }
  }

  return variants;
}

/**
 * 10-cell (4+3+2+1) triangles inside every 4x4 window (4 orientations each).
 */
export function buildTriangle4x4Variants(): BoardCoord[][] {
  const localShapes: BoardCoord[][] = [
    // top-left heavy
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [3, 0],
    ],
    // top-right heavy
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 2],
      [2, 3],
      [3, 3],
    ],
    // bottom-left heavy
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
      [2, 2],
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
    ],
    // bottom-right heavy
    [
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [2, 3],
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
    ],
  ];

  const variants: BoardCoord[][] = [];
  for (let row = 0; row <= 1; row += 1) {
    for (let col = 0; col <= 1; col += 1) {
      for (const shape of localShapes) {
        variants.push(
          shape.map(([r, c]) => [r + row, c + col] as BoardCoord),
        );
      }
    }
  }

  return variants;
}

export const RECTANGLE_2X3_OR_3X2_VARIANTS = buildRectangle2x3Or3x2Variants();
export const SMALL_T_VARIANTS = buildSmallTVariants();
export const TRIANGLE_6_VARIANTS = buildTriangle6Variants();
export const TRIANGLE_4X4_VARIANTS = buildTriangle4x4Variants();
export const CORNER_VARIANTS = buildCornerVariants();
