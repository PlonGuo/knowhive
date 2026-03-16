---
title: Difference Array
category: Array Techniques
tags: [difference-array, array, prefix-sum, interval]
difficulty: null
pack_id: leetcode-basics
---

# Difference Array

## Core Idea

- The difference array `diff` stores the difference between adjacent elements of the original array
- Formula: `diff[i] = arr[i] - arr[i-1]` (for i >= 1), `diff[0] = arr[0]`
- Key property: range updates on the original array become two point updates on the difference array

## Key Operations

### Build Difference Array

```python
def build_diff(arr):
    n = len(arr)
    diff = [0] * n
    diff[0] = arr[0]
    for i in range(1, n):
        diff[i] = arr[i] - arr[i-1]
    return diff
```

### Restore Original Array

```python
def restore_arr(diff):
    n = len(diff)
    arr = [0] * n
    arr[0] = diff[0]
    for i in range(1, n):
        arr[i] = arr[i-1] + diff[i]
    return arr
```

### Range Update

```python
def range_update(diff, l, r, val):
    """Add val to all elements in range [l, r] of the original array"""
    diff[l] += val
    if r + 1 < len(diff):
        diff[r + 1] -= val
```

## Use Cases

### 1. Range Increment/Decrement

- Multiple range add/subtract operations
- Query final value at each position
- Examples: LC 732, LC 1094, LC 1109

### 2. Overlap Counting

- Count how many times each position is covered
- Find maximum overlap count
- Examples: meeting room scheduling, flight bookings

### 3. Offline Queries

- Perform all updates first
- Query results afterward
- Not suitable for interleaved queries

## Code Templates

### Standard Difference Array

```python
class DifferenceArray:
    def __init__(self, n):
        self.diff = [0] * (n + 1)  # extra position for boundary

    def range_add(self, l, r, val):
        """Add val to range [l, r]"""
        self.diff[l] += val
        self.diff[r + 1] -= val

    def get_result(self):
        """Get final array"""
        n = len(self.diff) - 1
        arr = [0] * n
        arr[0] = self.diff[0]

        for i in range(1, n):
            arr[i] = arr[i-1] + self.diff[i]

        return arr
```

### Sparse Difference Array (for large coordinate ranges)

```python
from collections import defaultdict

class SparseDifferenceArray:
    def __init__(self):
        self.diff = defaultdict(int)  # only store change points

    def range_add(self, l, r, val):
        """Add val to range [l, r] (sparse version)"""
        self.diff[l] += val
        self.diff[r + 1] -= val

    def get_max_overlap(self):
        """Get maximum overlap count (e.g., LC 732)"""
        sorted_points = sorted(self.diff.keys())
        max_overlap = 0
        curr = 0

        for point in sorted_points:
            curr += self.diff[point]
            max_overlap = max(max_overlap, curr)

        return max_overlap
```

## Complexity

### Standard Difference Array

- **Range update**: O(1) - modify two endpoints
- **Final query**: O(n) - restore entire array
- **Space**: O(n)

### Sparse Difference Array

- **Range update**: O(1) - modify two endpoints
- **Max overlap query**: O(k log k) - k distinct endpoints, requires sorting
- **Space**: O(k) - only stores change points

## Difference Array vs Segment Tree

| Feature | Difference Array | Segment Tree |
|---------|-----------------|--------------|
| Range update | O(1) | O(log n) |
| Point query | O(n) | O(log n) |
| Range query | O(n) | O(log n) |
| Space | O(n) | O(4n) |
| Best for | Offline queries | Online queries |

## Practice Problems

### Basic Applications

1. LC 732 - My Calendar III (maximum K-booking)
2. LC 1094 - Car Pooling
3. LC 1109 - Corporate Flight Bookings

### Related Problems

4. LC 253 - Meeting Rooms II (similar concept)
5. LC 56 - Merge Intervals
6. LC 435 - Non-overlapping Intervals

## Tips

1. **Identify the pattern**: problem involves multiple range updates with final position queries
2. **Boundary handling**: half-open `[l, r)` vs closed `[l, r]` intervals; diff array needs position `r+1`
3. **Sparse coordinates**: use dictionary when coordinate range is large but point count is small

## Related Topics

- Prefix Sum - inverse operation for fast range queries
- Segment Tree - handles online range queries
- Interval Problems - common application domain
