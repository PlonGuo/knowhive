---
title: Greedy Algorithm
category: Algorithm Strategy
tags: [greedy, sorting, interval]
difficulty: null
pack_id: leetcode-basics
---

# Greedy Algorithm

## Core Idea

- At each step, choose the locally optimal option
- Hope that local optima lead to a global optimum
- No backtracking once a choice is made

## Key Properties

1. **Greedy choice property** - local optimum leads to global optimum
2. **Optimal substructure** - optimal solution contains optimal sub-solutions
3. **No aftereffect** - current choice does not affect future choices

## Use Cases

### 1. Interval Scheduling

- Meeting rooms, course scheduling
- Interval merging, interval covering
- Examples: LC 253, LC 435, LC 56

### 2. Assignment Problems

- Resource allocation, task scheduling
- Fractional knapsack
- Examples: LC 455, LC 135

### 3. Graph Problems

- Minimum spanning tree (Prim, Kruskal)
- Shortest path (Dijkstra)
- Huffman coding

### 4. String Problems

- Minimum lexicographic order
- Character rearrangement
- Examples: LC 767, LC 621

## Code Templates

### Interval Scheduling

```python
def greedy_interval(intervals):
    intervals.sort(key=lambda x: x[1])  # sort by end time

    count = 0
    last_end = -float('inf')

    for start, end in intervals:
        if start >= last_end:  # no overlap
            count += 1
            last_end = end

    return count
```

### Assignment Problem

```python
def greedy_assignment(A, B):
    A.sort()
    B.sort()

    i, j = 0, 0
    count = 0

    while i < len(A) and j < len(B):
        if A[i] <= B[j]:  # can assign
            count += 1
            i += 1
            j += 1
        else:
            j += 1  # try a larger B

    return count
```

## Complexity

- **Time**: typically O(n log n) dominated by sorting
- **Space**: O(1) or O(n) if a sorted copy is needed

## Practice Problems

### Interval Problems

1. LC 253 - Meeting Rooms II (minimum meeting rooms, greedy + heap)
2. LC 435 - Non-overlapping Intervals (remove minimum intervals)
3. LC 56 - Merge Intervals
4. LC 452 - Minimum Number of Arrows to Burst Balloons

### Assignment Problems

5. LC 455 - Assign Cookies
6. LC 135 - Candy
7. LC 406 - Queue Reconstruction by Height

### String Problems

8. LC 621 - Task Scheduler
9. LC 767 - Reorganize String
10. LC 763 - Partition Labels

## Correctness Proof Techniques

1. **Exchange argument** - swap two elements in an optimal solution, show it doesn't worsen
2. **Induction** - prove for base case, then show k implies k+1
3. **Contradiction** - assume greedy is not optimal, derive a contradiction

## Greedy vs Dynamic Programming

- **Greedy**: local optimum leads to global optimum (not always guaranteed)
- **DP**: considers all possibilities, guarantees optimality
- Greedy is faster but only works when the greedy choice property holds

## Related Topics

- Dynamic Programming - alternative optimization approach
- Heap / Priority Queue - often combined with greedy
- Sorting - prerequisite for many greedy algorithms
