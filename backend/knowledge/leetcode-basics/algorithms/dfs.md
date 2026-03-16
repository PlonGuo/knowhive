---
title: DFS (Depth-First Search)
category: Graph Traversal
tags: [dfs, graph, recursion, backtracking, stack]
difficulty: null
pack_id: leetcode-basics
---

# DFS (Depth-First Search)

## Core Idea

- Traverse a graph or tree by going as deep as possible first
- Uses a stack (recursion or explicit stack)
- Explore one path to its end, then backtrack

## Key Properties

1. **Recursion or stack** - two ways to implement depth-first traversal
2. **Visited marking** - prevent revisiting nodes
3. **Backtracking** - return to previous level when exploration fails

## Use Cases

### 1. Path Exploration

- All paths in a maze
- All simple paths in a graph
- Combination/permutation problems

### 2. Connectivity Detection

- Connected components in a graph
- Island problems
- Strongly connected components

### 3. Backtracking Problems

- N-Queens
- Sudoku solving
- Parentheses generation

### 4. Topological Sort

- Topological ordering of DAGs
- Course scheduling dependencies

## Code Templates

### Recursive DFS

```python
def dfs_recursive(node, visited, graph):
    visited.add(node)

    process_node(node)

    for neighbor in graph[node]:
        if neighbor not in visited:
            dfs_recursive(neighbor, visited, graph)
```

### Iterative DFS (Explicit Stack)

```python
def dfs_iterative(start, graph):
    stack = [start]
    visited = set([start])

    while stack:
        node = stack.pop()

        process_node(node)

        for neighbor in reversed(graph[node]):
            if neighbor not in visited:
                visited.add(neighbor)
                stack.append(neighbor)
```

### DFS with Path Recording

```python
def dfs_with_path(start, target, graph):
    def dfs(node, path, visited):
        if node == target:
            result.append(path.copy())
            return

        visited.add(node)

        for neighbor in graph[node]:
            if neighbor not in visited:
                path.append(neighbor)
                dfs(neighbor, path, visited)
                path.pop()  # backtrack

        visited.remove(node)  # backtrack

    result = []
    dfs(start, [start], set())
    return result
```

### Grid DFS (Island Problems)

```python
def dfs_grid(grid, r, c):
    rows, cols = len(grid), len(grid[0])

    if r < 0 or r >= rows or c < 0 or c >= cols:
        return

    if grid[r][c] != '1':
        return

    grid[r][c] = '2'  # mark visited

    dfs_grid(grid, r + 1, c)
    dfs_grid(grid, r - 1, c)
    dfs_grid(grid, r, c + 1)
    dfs_grid(grid, r, c - 1)
```

## Complexity

- **Time**: O(V + E) - visit all vertices and edges once
- **Space**:
  - Recursive: O(V) - call stack depth
  - Iterative: O(V) - stack space

## Practice Problems

### Basic

1. LC 200 - Number of Islands
2. LC 695 - Max Area of Island
3. LC 733 - Flood Fill

### Path Problems

4. LC 79 - Word Search
5. LC 212 - Word Search II
6. LC 980 - Unique Paths III

### Backtracking

7. LC 46 - Permutations
8. LC 78 - Subsets
9. LC 39 - Combination Sum

### Tree DFS

10. LC 104 - Maximum Depth of Binary Tree
11. LC 110 - Balanced Binary Tree
12. LC 124 - Binary Tree Maximum Path Sum

### Graph DFS

13. LC 207 - Course Schedule
14. LC 399 - Evaluate Division
15. LC 684 - Redundant Connection

## Interview Tips

1. **Recursive vs iterative**: recursion is concise but may cause stack overflow; iteration offers better control
2. **Visited handling**: choose set, list, or in-place modification based on the problem
3. **Backtracking timing**: undo state changes after recursion returns
4. **Pruning**: terminate impossible branches early to reduce search space
5. **Memoization**: cache results for overlapping subproblems to avoid redundant computation

## Related Topics

- Graph Theory Overview - parent topic
- BFS - breadth-first alternative
- Backtracking - subset of DFS applications
