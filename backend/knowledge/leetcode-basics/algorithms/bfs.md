---
title: BFS (Breadth-First Search)
category: Graph Traversal
tags: [bfs, graph, queue, shortest-path, topological-sort]
difficulty: null
pack_id: leetcode-basics
---

# BFS (Breadth-First Search)

## Core Idea

- Traverse a graph or tree level by level
- Uses a queue (FIFO) data structure
- Guarantees finding the path with fewest edges (shortest path in unweighted graphs)

## Key Properties

1. **Queue management** - store nodes to visit in a queue
2. **Visited marking** - prevent revisiting and infinite loops
3. **Level-order traversal** - process all nodes at one level before the next

## Use Cases

### 1. Unweighted Shortest Path

- Maze shortest path
- Word ladder shortest transformation
- Shortest relationship chain in social networks

### 2. Level-Order Traversal

- Binary tree level-order traversal
- Graph layered traversal
- Island problems (connected components)

### 3. Topological Sort

- Course scheduling
- Task scheduling
- Dependency resolution

## Code Templates

### Basic BFS

```python
from collections import deque

def bfs(graph, start):
    visited = set([start])
    queue = deque([start])

    while queue:
        level_size = len(queue)
        for _ in range(level_size):
            node = queue.popleft()

            process_node(node)

            for neighbor in graph[node]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
```

### BFS with Distance Tracking

```python
def bfs_with_distance(graph, start):
    from collections import deque

    n = len(graph)
    visited = [False] * n
    distance = [-1] * n

    queue = deque([start])
    visited[start] = True
    distance[start] = 0

    while queue:
        node = queue.popleft()

        for neighbor in graph[node]:
            if not visited[neighbor]:
                visited[neighbor] = True
                distance[neighbor] = distance[node] + 1
                queue.append(neighbor)

    return distance
```

### Multi-Source BFS

```python
def multi_source_bfs(grid, sources):
    from collections import deque

    rows, cols = len(grid), len(grid[0])
    visited = [[False] * cols for _ in range(rows)]
    distance = [[-1] * cols for _ in range(rows)]
    queue = deque()

    for r, c in sources:
        queue.append((r, c))
        visited[r][c] = True
        distance[r][c] = 0

    directions = [(0, 1), (0, -1), (1, 0), (-1, 0)]

    while queue:
        r, c = queue.popleft()

        for dr, dc in directions:
            nr, nc = r + dr, c + dc

            if (0 <= nr < rows and 0 <= nc < cols and
                not visited[nr][nc] and grid[nr][nc] != obstacle):
                visited[nr][nc] = True
                distance[nr][nc] = distance[r][c] + 1
                queue.append((nr, nc))

    return distance
```

## Complexity

- **Time**: O(V + E) - visit all vertices and edges once
- **Space**: O(V) - queue and visited array

## Practice Problems

### Basic

1. LC 200 - Number of Islands
2. LC 542 - 01 Matrix
3. LC 733 - Flood Fill

### Shortest Path

4. LC 127 - Word Ladder
5. LC 279 - Perfect Squares
6. LC 752 - Open the Lock

### Level-Order

7. LC 102 - Binary Tree Level Order Traversal
8. LC 107 - Binary Tree Level Order Traversal II
9. LC 199 - Binary Tree Right Side View

### Topological Sort

10. LC 207 - Course Schedule
11. LC 210 - Course Schedule II

## Interview Tips

1. **Clarify graph representation**: adjacency list vs adjacency matrix
2. **Handle visited**: prevent revisiting to avoid infinite loops
3. **Track distance**: record step count when shortest path is needed
4. **Level processing**: record level_size when per-level processing is needed
5. **Multi-source BFS**: start from multiple sources simultaneously for nearest distance

## Related Topics

- Graph Theory Overview - parent topic
- DFS - depth-first alternative
- Dijkstra - weighted shortest path
