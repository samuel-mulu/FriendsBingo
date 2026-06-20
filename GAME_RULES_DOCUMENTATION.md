# Friends Bingo - Game Rules Documentation

## Seed Rollout Status (June 2026)

This section reflects the current seed configuration in `src/game-rules/game-rule.seed-data.ts`.

### Active product rules (35)

These rules are active (`isActive: true`) and have evaluable pattern JSON. Admin and Flutter should display the **name** field, not the internal **key**.

The seed contains exactly 35 product rules. Product #9 (`MIX_08`) and #25 (`TWO_ROWS_ONE_SQUARE_ALT`aaa) share the display name "2 Rows + 1 Square" with identical pattern JSON.

| Key (internal) | Display name |
|----------------|--------------|
| `FULL_HOUSE` | Full House |
| `MIX_01` | 2 Col + 2 Row + 1 Diag |
| `MIX_02` | 4 Squares |
| `MIX_03` | 3 Col + 1 Diag |
| `MIX_04` | Big T + 2 Squares |
| `MIX_05` | 5 Lines |
| `MIX_06` | 3 Lines Without Free |
| `MIX_07` | Big L + 1 Diag |
| `MIX_08` | 2 Rows + 1 Square |
| `MIX_09` | 1 Col + 1 Row + 1 Diag |
| `MIX_10` | 7 Lines |
| `MIX_11` | 3 Squares |
| `MIX_12` | 3 Lines Touching Free |
| `BIG_H` | Big H |
| `MIX_13` | 2 Col + 2 Row |
| `HALF_HOUSE_10_DIRECTIONS` | Half House |
| `THREE_LINES` | 3 Lines |
| `THREE_ROWS_ONE_DIAGONAL` | 3 Rows + 1 Diag |
| `TWO_DIAGONALS_ONE_ROW` | 2 Diags + 1 Row |
| `THREE_PARALLEL_LINES` | 3 Parallel Lines |
| `FOUR_LINES_WITHOUT_DIAGONAL` | 4 Lines Without Diag |
| `HALF_HOUSE_4_DIRECTIONS` | Half House 4 Directions |
| `MIX_14` | 1 Line With Free + 2 Without |
| `BIG_CROSS_ONE_DIAGONAL` | Big Cross + 1 Diag |
| `TWO_ROWS_ONE_SQUARE_ALT` | 2 Rows + 1 Square |
| `SIX_LINES` | 6 Lines |
| `THREE_COLUMNS` | 3 Columns |
| `FOUR_PARALLEL_LINES` | 4 Parallel Lines |
| `FOUR_ANGLES_TWO_SQUARES` | 4 Angles + 2 Squares |
| `FOUR_LINES` | 4 Lines |
| `THREE_ROWS` | 3 Rows |
| `TWO_ROWS_ONE_COLUMN` | 2 Rows + 1 Col |
| `TWO_DIAGONALS` | 2 Diagonals |
| `ONE_COLUMN_ONE_ROW_ONE_SQUARE` | 1 Col + 1 Row + 1 Square |
| `BIG_T_ONE_DIAGONAL` | Big T + 1 Diag |

Legacy rules removed from seed are deleted on `npm run seed:game-rules` when unreferenced, or deactivated as `Legacy - {name}` when referenced by existing game slots.

### Held inactive rules

None in the final 35-rule seed.

### Unsupported placeholder rules

Removed from seed. Any remaining DB rows are cleaned up by the seed script.

### Legacy / duplicate inactive rules

Removed from seed (`MANUAL`, `HALF_HOUSE`, `FIVE_LINES`, `SEVEN_LINES`, placeholders, etc.). Referenced legacy rows are deactivated by the seed cleanup script.

> **Note:** The "All Available Game Rules" table below is partially stale. Refer to the Seed Rollout Status section above for current active/inactive flags.

---

## Overview

This document provides comprehensive details about all bingo game rules, cartela structure, cell marking system, and how each game rule is evaluated.

---

## Cartela Structure

### Basic Cartela Format

Each cartela is a 5x5 bingo grid with columns labeled **B, I, N, G, O**:

```
     B    I    N    G    O
    [ ]  [ ]  [ ]  [ ]  [ ]  <- Row 1
    [ ]  [ ]  [ ]  [ ]  [ ]  <- Row 2
    [ ]  [ ] FREE  [ ]  [ ]  <- Row 3 (Middle cell is always FREE)
    [ ]  [ ]  [ ]  [ ]  [ ]  <- Row 4
    [ ]  [ ]  [ ]  [ ]  [ ]  <- Row 5
```

### Data Structure

Cartelas are stored in the database with the following structure:

```typescript
interface Cartela {
  id: string;      // UUID
  number: number;  // Unique cartela number (e.g., 1, 2, 3...)
  b: number[];     // Column B values (5 numbers: 1-15)
  i: number[];     // Column I values (5 numbers: 16-30)
  n: (number | "FREE")[];  // Column N values (4 numbers + FREE: 31-45)
  g: number[];     // Column G values (5 numbers: 46-60)
  o: number[];     // Column O values (5 numbers: 61-75)
}
```

### Example Cartela (JSON format)

```json
{
  "1": {
    "B": [7, 13, 10, 9, 4],
    "I": [22, 20, 26, 18, 21],
    "N": [37, 43, "FREE", 41, 42],
    "G": [56, 51, 57, 60, 53],
    "O": [74, 64, 65, 72, 62]
  }
}
```

### Number Ranges by Column

| Column | Number Range | Count |
|--------|-------------|-------|
| B | 1-15 | 5 numbers |
| I | 16-30 | 5 numbers |
| N | 31-45 | 4 numbers + 1 FREE |
| G | 46-60 | 5 numbers |
| O | 61-75 | 5 numbers |

---

## Cell Marking System

### How Cells Are Marked

A cell is considered **marked** when:

1. **The cell's number has been called** - When a number is drawn during the game, any cartela containing that number can mark that cell
2. **The cell is FREE** - The center cell (N3) is always automatically marked

### Marking Logic

```typescript
function isMarkedCellValue(
  value: unknown,
  calledNumbersSet: Set<number>
): boolean {
  // FREE space is always marked
  if (value === null || value === undefined) return true;
  
  if (typeof value === 'string') {
    const trimmedValue = value.trim().toUpperCase();
    if (trimmedValue === 'FREE' || trimmedValue === '') return true;
    
    // Check if the numeric value was called
    const numericValue = Number(trimmedValue);
    return Number.isFinite(numericValue) && calledNumbersSet.has(numericValue);
  }
  
  if (typeof value === 'number') {
    return calledNumbersSet.has(value);
  }
  
  return false;
}
```

### Marked Cells Storage

When a player plays a cartela in a game session, their `GameCartela` record stores:

```typescript
interface GameCartela {
  id: string;
  gameSessionId: string;
  userId: string;
  cartelaId: string;
  status: 'REGISTERED' | 'WINNER' | 'BLOCKED' | 'CANCELLED';
  markedCells: Json?;  // Optional: Can store custom player markings
  isWinner: boolean;
  blockedAt: DateTime?;
}
```

---

## Game Rules Overview

### Rule Definition Structure

```typescript
interface GameRule {
  id: string;          // UUID
  key: string;         // Unique identifier (e.g., 'HALF_HOUSE', 'FULL_HOUSE')
  name: string;        // Display name (e.g., 'Half House', 'Full House')
  description: string?; // Optional description
  isActive: boolean;   // Whether this rule is available
  sortOrder: number;   // Display order
  patterns: Json?;     // Optional pattern definitions
}
```

### All Available Game Rules

| Key | Name | Active by Default | Description |
|-----|------|-------------------|-------------|
| `MANUAL` | Manual | ✅ Yes | Admin manually approves winners without pattern validation |
| `FULL_HOUSE` | FULL-HOUSE | ❌ No | All 25 cells must be marked |
| `HALF_HOUSE` | Half House | ❌ No | At least 3 complete rows must be marked |
| `LINE` | line | ❌ No | One complete row must be marked |
| `COLUMNS` | Columns | ❌ No | One or more complete columns must be marked |
| `ROWS` | Rows | ❌ No | One or more complete rows must be marked |
| `DIAGONAL` | Diagonal | ❌ No | Either diagonal must be marked |
| `LINE_TOUCHES_FREE` | Line touches free | ❌ No | A line that includes the FREE space |
| `LINES_WITHOUT_FREE` | lines without free | ❌ No | A line that does NOT include the FREE space |
| `SQUARE` | Square | ❌ No | A square pattern must be marked |
| `RECTANGLE` | Rectangule | ❌ No | A rectangular pattern must be marked |
| `TWO_TRIANGLE` | 2 triangle | ❌ No | Two triangular patterns must be marked |
| `FOUR_BY_FOUR_TRIANGLE` | 4 by 4 triangle | ❌ No | A 4x4 triangular pattern |
| `PYRAMID` | Pyramid | ❌ No | A pyramid-shaped pattern |
| `BIG_L_SHAPE` | BIG L Shape | ❌ No | Large L-shaped pattern |
| `BIG_T` | BIG T | ❌ No | Large T-shaped pattern |
| `BIG_H` | BIG H | ❌ No | Large H-shaped pattern |
| `BIG_N` | BIG N | ❌ No | Large N-shaped pattern |
| `BIG_Y` | BIG Y | ❌ No | Large Y-shaped pattern |
| `BIG_CROSS` | BIG Cross | ❌ No | Large cross pattern |
| `RIGHT_SHAPE` | RIGHT Shape | ❌ No | Right-shaped pattern |
| `SMALL_T` | small T | ❌ No | Small T-shaped pattern |
| `SMALL_X` | small X | ❌ No | Small X-shaped pattern |
| `SMALL_O` | small O | ❌ No | Small O-shaped pattern |
| `SMALL_H` | small H | ❌ No | Small H-shaped pattern |
| `SMALL_CROSS` | small cross | ❌ No | Small cross pattern |
| `SMALL_L` | small L | ❌ No | Small L-shaped pattern |
| `MIXED_JOIN` | Mixed Join | ❌ No | Mixed/joined pattern |
| `MIX_01` to `MIX_14` | mix_01 to mix_14 | ❌ No | Various mixed patterns |

---

## Detailed Rule Evaluations

### 1. HALF_HOUSE Rule

**Win Condition:** At least 3 complete rows must be marked.

**Implementation:**

```typescript
const HALF_HOUSE_TARGET_ROWS = 3;

function evaluateHalfHouse(cartela, calledNumbers): {
  // Build 5x5 board from column data
  const boardRows = buildBoardRows(cartela);
  const calledNumbersSet = new Set(calledNumbers.map(n => n.number));
  const completedRows: number[] = [];

  // Check each row
  boardRows.forEach((row, index) => {
    const rowCompleted = row.every(value => isMarkedCellValue(value, calledNumbersSet));
    if (rowCompleted) {
      completedRows.push(index + 1); // 1-indexed row number
    }
  });

  const completedRowCount = completedRows.length;
  const isWinner = completedRowCount >= HALF_HOUSE_TARGET_ROWS;
  const progress = Math.min(completedRowCount / HALF_HOUSE_TARGET_ROWS, 1);
  
  return {
    isWinner,
    matchedPattern: completedRows.length > 0 
      ? `HALF_HOUSE:ROW_${completedRows.join(',ROW_')}` 
      : 'HALF_HOUSE:NONE',
    progress
  };
}
```

**Example Winning Pattern:**
```
     B    I    N    G    O
    [X]  [X]  [X]  [X]  [X]  <- Row 1 (COMPLETE)
    [X]  [X]  [X]  [X]  [X]  <- Row 2 (COMPLETE)
    [X]  [X] [FREE] [X]  [X]  <- Row 3 (COMPLETE)
    [ ]  [ ]  [ ]  [ ]  [ ]  <- Row 4
    [ ]  [ ]  [ ]  [ ]  [ ]  <- Row 5
```

---

### 2. FULL_HOUSE Rule

**Win Condition:** All 25 cells must be marked (every number called + FREE space).

**Logic:** All rows must be complete:
- Row 1: Complete
- Row 2: Complete
- Row 3: Complete (FREE is auto-marked)
- Row 4: Complete
- Row 5: Complete

---

### 3. LINE Rule

**Win Condition:** Any single complete row must be marked.

**Variations:**
- Could be horizontal, vertical, or diagonal depending on implementation

---

### 4. COLUMNS Rule

**Win Condition:** One or more complete columns must be marked.

**Logic:** Similar to rows evaluation but checks columns vertically:
- Column B: All 5 cells marked
- Column I: All 5 cells marked
- Column N: All 5 cells marked (including FREE)
- Column G: All 5 cells marked
- Column O: All 5 cells marked

---

### 5. ROWS Rule

**Win Condition:** One or more complete rows must be marked.

**Similar to:** LINE rule but may allow multiple rows.

---

### 6. DIAGONAL Rule

**Win Condition:** Either diagonal must be completely marked.

**Two Diagonals:**

**Diagonal 1 (Top-Left to Bottom-Right):**
```
     B    I    N    G    O
    [X]  [ ]  [ ]  [ ]  [ ]
    [ ]  [X]  [ ]  [ ]  [ ]
    [ ]  [ ] [FREE] [ ]  [ ]
    [ ]  [ ]  [ ]  [X]  [ ]
    [ ]  [ ]  [ ]  [ ]  [X]
```
Cells: B1, I2, N3(FREE), G4, O5

**Diagonal 2 (Top-Right to Bottom-Left):**
```
     B    I    N    G    O
    [ ]  [ ]  [ ]  [ ]  [X]
    [ ]  [ ]  [ ]  [X]  [ ]
    [ ]  [ ] [FREE] [ ]  [ ]
    [ ]  [X]  [ ]  [ ]  [ ]
    [X]  [ ]  [ ]  [ ]  [ ]
```
Cells: O1, G2, N3(FREE), I4, B5

---

### 7. LINE_TOUCHES_FREE Rule

**Win Condition:** A complete line (row, column, or diagonal) that includes the FREE space in the center.

**Qualifying Lines:**
- Row 3 (middle row)
- Column N (middle column)
- Either diagonal (both pass through center)

---

### 8. LINES_WITHOUT_FREE Rule

**Win Condition:** A complete line that does NOT include the FREE space.

**Qualifying Lines:**
- Rows 1, 2, 4, 5
- Columns B, I, G, O

---

### 9. SQUARE Rule

**Win Condition:** A square pattern must be marked.

**Possible Squares:**
- 2x2 square
- 3x3 square
- 4x4 square
- Full 5x5 square (same as FULL_HOUSE)

---

### 10. RECTANGLE Rule

**Win Condition:** A rectangular pattern must be marked.

**Examples:**
- 2x3 rectangle
- 3x4 rectangle
- Any rectangular block of marked cells

---

### 11. TWO_TRIANGLE Rule

**Win Condition:** Two triangular patterns must be marked.

**Possible Triangles:**
- Top triangle: Top 3 rows forming a triangle
- Bottom triangle: Bottom 3 rows forming a triangle
- Left triangle: Left 3 columns forming a triangle
- Right triangle: Right 3 columns forming a triangle

---

### 12. FOUR_BY_FOUR_TRIANGLE Rule

**Win Condition:** A 4x4 triangular pattern.

---

### 13. PYRAMID Rule

**Win Condition:** A pyramid-shaped pattern.

**Pattern Shape:**
```
     B    I    N    G    O
    [ ]  [ ]  [X]  [ ]  [ ]
    [ ]  [X]  [X]  [X]  [ ]
    [X]  [X] [FREE] [X]  [X]
    [X]  [X]  [X]  [X]  [X]
    [X]  [X]  [X]  [X]  [X]
```

---

### 14-19. Shape Rules (BIG_L_SHAPE, BIG_T, BIG_H, BIG_N, BIG_Y, BIG_CROSS)

**Win Condition:** Large letter-shaped patterns must be marked.

**Example - BIG T:**
```
     B    I    N    G    O
    [X]  [X]  [X]  [X]  [X]  <- Top bar
    [ ]  [ ]  [X]  [ ]  [ ]  <- Stem
    [ ]  [ ]  [X]  [ ]  [ ]
    [ ]  [ ]  [X]  [ ]  [ ]
    [ ]  [ ]  [X]  [ ]  [ ]
```

---

### 20-25. Small Shape Rules (SMALL_T, SMALL_X, SMALL_O, SMALL_H, SMALL_CROSS, SMALL_L)

**Win Condition:** Smaller versions of the letter patterns.

**Example - SMALL_T (3x3 area):**
```
     B    I    N    G    O
    [ ]  [ ]  [ ]  [ ]  [ ]
    [ ]  [X]  [X]  [X]  [ ]
    [ ]  [ ]  [X]  [ ]  [ ]
    [ ]  [ ]  [X]  [ ]  [ ]
    [ ]  [ ]  [ ]  [ ]  [ ]
```

---

### 26. MIXED_JOIN Rule

**Win Condition:** A mixed or joined pattern combining multiple elements.

---

### 27-40. MIX_01 to MIX_14 Rules

**Win Condition:** Various predefined mixed patterns.

These are custom complex patterns that combine different shapes and lines.

---

### 41. MANUAL Rule

**Win Condition:** Admin manually approves the winner.

**Special Behavior:**
- No automatic pattern validation
- Player claims bingo
- Admin reviews and manually approves/rejects
- Used when pattern checking is not automated

---

## Game Session Flow

### Status Lifecycle

```
NEXT -> READY -> PLAYING -> CHECKING -> FINISHED
              -> CANCELLED
```

| Status | Description |
|--------|-------------|
| `NEXT` | Slot is queued, waiting to be ready |
| `READY` | Players can register cartelas |
| `PLAYING` | Numbers are being called, game in progress |
| `CHECKING` | Bingo claimed, waiting for admin approval |
| `FINISHED` | Winner confirmed, game ended |
| `CANCELLED` | Game was cancelled |

### Game Cartela Status

| Status | Description |
|--------|-------------|
| `REGISTERED` | Cartela is active in the game |
| `WINNER` | Cartela won the game |
| `BLOCKED` | Cartela made false claim, cannot claim again |
| `CANCELLED` | Cartela registration was cancelled |

### Bingo Claim Status

| Status | Description |
|--------|-------------|
| `PENDING` | Claim submitted, waiting for admin review |
| `VALID` | Claim approved, player won |
| `INVALID` | Claim rejected, cartela blocked |

---

## Evaluation Process

### How Rules Are Checked

1. **Player Claims Bingo** - Player clicks "Bingo" on their cartela
2. **Claim Created** - System creates a `BingoClaim` with status `PENDING`
3. **Session Paused** - Game status changes to `CHECKING`, auto-calling stops
4. **Admin Review** - Admin views the claim and the cartela
5. **Rule Evaluation** - Depending on the game rule:
   - `MANUAL`: Admin manually decides
   - Other rules: System can validate pattern automatically
6. **Decision**:
   - **Approve**: Cartela becomes `WINNER`, session `FINISHED`, prize awarded
   - **Reject**: Cartela becomes `BLOCKED`, session returns to `PLAYING`

### Rule Evaluator Interface

```typescript
interface GameRuleEvaluator {
  supports(gameType: string): boolean;
  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberRecord[],
    gameType: string,
  ): GameRuleEvaluationResult;
}

interface GameRuleEvaluationResult {
  isWinner: boolean;      // True if winning pattern achieved
  matchedPattern: string;  // Description of matched pattern
  progress: number;       // 0.0 to 1.0 progress toward winning
}
```

---

## Building Board Rows

The evaluator converts column-based cartela data into row-based board for easier pattern checking:

```typescript
function buildBoardRows(cartela: EvaluatorCartela): unknown[][] {
  const columns = [
    normalizeColumn(cartela.b),  // [B1, B2, B3, B4, B5]
    normalizeColumn(cartela.i),  // [I1, I2, I3, I4, I5]
    normalizeColumn(cartela.n),  // [N1, N2, FREE, N4, N5]
    normalizeColumn(cartela.g),  // [G1, G2, G3, G4, G5]
    normalizeColumn(cartela.o),  // [O1, O2, O3, O4, O5]
  ];

  // Transpose columns to rows
  return Array.from({ length: 5 }, (_, rowIndex) =>
    columns.map((column) => column[rowIndex] ?? null),
  );
}
```

**Result:** 5 rows × 5 columns board array for pattern checking.

---

## Summary

### Key Concepts

1. **Cartela**: A 5×5 bingo card with columns B-I-N-G-O
2. **Called Numbers**: Numbers drawn during gameplay
3. **Marked Cell**: A cell is marked if its number was called or it's FREE
4. **Game Rule**: Defines the winning pattern required
5. **Bingo Claim**: Player's declaration that they've achieved the pattern
6. **Admin Approval**: Manual verification of winning claims

### Reusable Components

- **Board Builder**: Converts column data to row-based board
- **Mark Checker**: Determines if a cell value is marked
- **Rule Evaluators**: Pluggable pattern checkers for each game type
- **Progress Tracking**: Shows how close player is to winning

### Extending Game Rules

To add a new game rule:

1. Add rule key and name to `game-rule.seed-data.ts`
2. Create an evaluator class implementing `GameRuleEvaluator`
3. Implement the `supports()` method to match the rule key
4. Implement the `evaluate()` method to check the winning pattern
5. Register the evaluator in the game rules module
